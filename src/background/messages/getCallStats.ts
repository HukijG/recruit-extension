import type { PlasmoMessaging } from "@plasmohq/messaging"

import {
  authFetch,
  buildMiddlewareUrl,
  NotAuthenticatedError
} from "~background/auth-runtime"

const ROUTE_PATH = "/call-stats"

// Thin pass-through to the worker's daily-call-count endpoint. No caching:
// the badge's whole point is freshness, and the worker reports it's a
// single ~10ms KV read so polling is effectively free.
const handler: PlasmoMessaging.MessageHandler = async (_req, res) => {
  try {
    const resp = await authFetch(buildMiddlewareUrl(ROUTE_PATH), {
      method: "POST",
      body: JSON.stringify({})
    })
    if (!resp.ok) {
      res.send({ ok: false })
      return
    }
    const data = await resp.json()
    res.send({ ok: true, data })
  } catch (err) {
    if (err instanceof NotAuthenticatedError) {
      // Silent — the poller runs in the background and the LoginScreen
      // takes over via <RequireAuth>. We don't want a transient badge
      // flicker or toast during sign-out / needs-reconnect.
      res.send({ ok: false })
      return
    }
    res.send({ ok: false })
  }
}

export default handler
