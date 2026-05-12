import type { PlasmoMessaging } from "@plasmohq/messaging"

import {
  authFetch,
  buildMiddlewareUrl,
  NotAuthenticatedError
} from "~background/auth-runtime"

const ROUTE_PATH = "/dialpad-hangup"

// Wraps the middleware's POST /dialpad-hangup. The worker holds the active
// call_id in KV (written when the matching Dialpad `calling` event landed),
// so the extension never needs to track or forward a call_id.
//
// The 409 status (`No active call`) is a soft error, surfaced by the
// CallButton as inline UX rather than a crash; we forward `status` so
// the caller can branch on it.
//
// consultantFirstName dropped per JWT contract — the middleware identifies
// the user from the Bearer token.
const handler: PlasmoMessaging.MessageHandler = async (req, res) => {
  try {
    const resp = await authFetch(buildMiddlewareUrl(ROUTE_PATH), {
      method: "POST",
      body: JSON.stringify({})
    })

    if (!resp.ok) {
      let body: { error?: unknown } | null = null
      try {
        body = await resp.json()
      } catch {}
      if (body && typeof body === "object" && typeof body.error === "string") {
        res.send({
          ok: false,
          error: body.error,
          status: resp.status
        })
        return
      }
      res.send({
        ok: false,
        error: `${resp.status} ${resp.statusText}`,
        status: resp.status
      })
      return
    }

    const data = await resp.json().catch(() => ({}))
    res.send({ ok: true, data })
  } catch (err) {
    if (err instanceof NotAuthenticatedError) {
      res.send({ ok: false, error: "Session expired — please sign in again" })
      return
    }
    res.send({ ok: false, error: (err as Error)?.message ?? "Network error" })
  }
}

export default handler
