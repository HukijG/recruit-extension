import type { PlasmoMessaging } from "@plasmohq/messaging"

import {
  authFetch,
  buildMiddlewareUrl,
  NotAuthenticatedError
} from "~background/auth-runtime"
import { readSession } from "~auth/storage"
import type { DialpadUserContext } from "~lib/dialpad"
import { localStore } from "~lib/constants"

const ROUTE_PATH = "/dialpad-user-context"
const CACHE_PREFIX = "dialpadUserContext:"

// Cache the middleware response in chrome.storage.local so navigating
// between candidate pages doesn't re-hit the worker. Caller IDs change
// rarely (admins reassign company numbers, but that's not a hot path), so
// a long TTL is fine and keeps the middleware fully untouched on the
// normal flow. The aliased payload (no real phone numbers) is safe to
// cache locally — a stolen browser profile reveals only opaque tokens
// that the worker has to decode.
//
// The middleware MUST keep aliasIds valid for at least this long, otherwise
// stale-cache calls will 4xx. Bumping this value requires bumping the
// alias-token TTL on the worker in lockstep.
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000 // 1 week

interface CacheEntry {
  data: DialpadUserContext
  fetchedAt: number
}

const handler: PlasmoMessaging.MessageHandler = async (req, res) => {
  try {
    const session = await readSession()
    if (!session) {
      res.send({ ok: false, error: "Session expired — please sign in again" })
      return
    }

    const cacheKey = `${CACHE_PREFIX}${session.user.sub}`
    const force = req.body?.refresh === true

    if (!force) {
      const cached = await localStore.get<CacheEntry>(cacheKey)
      if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
        res.send({
          ok: true,
          data: cached.data,
          cachedAt: cached.fetchedAt,
          fromCache: true
        })
        return
      }
    }

    const resp = await authFetch(buildMiddlewareUrl(ROUTE_PATH), {
      method: "POST",
      body: JSON.stringify({}) // consultantFirstName dropped per JWT contract
    })

    if (!resp.ok) {
      let errorBody = ""
      try {
        errorBody = await resp.text()
      } catch {}
      const msg = `${resp.status} ${resp.statusText}${errorBody ? ": " + errorBody : ""}`
      res.send({ ok: false, error: msg })
      return
    }

    const data = (await resp.json()) as DialpadUserContext
    const fetchedAt = Date.now()
    await localStore.set(cacheKey, { data, fetchedAt } satisfies CacheEntry)
    res.send({ ok: true, data, cachedAt: fetchedAt, fromCache: false })
  } catch (err) {
    if (err instanceof NotAuthenticatedError) {
      res.send({ ok: false, error: "Session expired — please sign in again" })
      return
    }
    res.send({ ok: false, error: (err as Error)?.message ?? "Network error" })
  }
}

export default handler
