import type { PlasmoMessaging } from "@plasmohq/messaging"

import {
  authFetch,
  buildMiddlewareUrl,
  NotAuthenticatedError
} from "~background/auth-runtime"

const ROUTE_PATH = "/dialpad-sms"

const handler: PlasmoMessaging.MessageHandler = async (req, res) => {
  const { phoneNumber, callerAliasId, text } = req.body ?? {}

  if (typeof phoneNumber !== "string" || !phoneNumber.trim()) {
    res.send({ ok: false, error: "Missing phoneNumber" })
    return
  }
  if (typeof text !== "string" || !text.trim()) {
    res.send({ ok: false, error: "Missing text" })
    return
  }

  try {
    const resp = await authFetch(buildMiddlewareUrl(ROUTE_PATH), {
      method: "POST",
      body: JSON.stringify({
        phoneNumber: phoneNumber.trim(),
        callerAliasId:
          typeof callerAliasId === "string" && callerAliasId.trim()
            ? callerAliasId.trim()
            : undefined,
        text
      }) // consultantFirstName dropped per JWT contract
    })

    if (!resp.ok) {
      // Same envelope as /dialpad-call. /dialpad-sms doesn't emit 429 today
      // but the middleware spec leaves room for it once production
      // candidate-mode lights up; threading reason/retryAfterSec through now
      // means the popover handles a future 429 without a second pass.
      let body: { error?: unknown; reason?: unknown; retryAfterSec?: unknown } | null =
        null
      try {
        body = await resp.json()
      } catch {}
      if (body && typeof body === "object" && typeof body.error === "string") {
        res.send({
          ok: false,
          error: body.error,
          reason: body.reason,
          retryAfterSec:
            typeof body.retryAfterSec === "number"
              ? body.retryAfterSec
              : undefined,
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
