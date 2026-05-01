import type { PlasmoMessaging } from "@plasmohq/messaging"
import { Storage } from "@plasmohq/storage"

import type { DialpadUserContext } from "~lib/dialpad"

const MIDDLEWARE_URL = process.env.PLASMO_PUBLIC_MIDDLEWARE_URL
const ROUTE_PATH = "/dialpad-user-context"

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
  if (!MIDDLEWARE_URL) {
    res.send({
      ok: false,
      error:
        "Middleware URL not configured at build time. Rebuild with .env.{development,production} set."
    })
    return
  }

  const localStore = new Storage({ area: "local" })
  const consultantFirstName =
    (await localStore.get<string>("consultantFirstName")) ?? ""

  const cacheKey = `dialpadUserContext:${consultantFirstName || "_unknown"}`
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

  const { secret } = req.body ?? {}
  const url = `${MIDDLEWARE_URL.replace(/\/+$/, "")}${ROUTE_PATH}`
  const headers: Record<string, string> = { "Content-Type": "application/json" }
  if (secret) headers["X-Extension-Token"] = secret

  try {
    const resp = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({ consultantFirstName })
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
    await localStore.set(cacheKey, { data, fetchedAt })
    res.send({ ok: true, data, cachedAt: fetchedAt, fromCache: false })
  } catch (err: any) {
    res.send({ ok: false, error: err?.message ?? "Network error" })
  }
}

export default handler
