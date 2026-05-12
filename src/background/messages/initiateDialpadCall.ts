import type { PlasmoMessaging } from "@plasmohq/messaging"

import {
  authFetch,
  buildMiddlewareUrl,
  NotAuthenticatedError
} from "~background/auth-runtime"

const ROUTE_PATH = "/dialpad-call"

const handler: PlasmoMessaging.MessageHandler = async (req, res) => {
  const { phoneNumber, callerAliasId } = req.body ?? {}

  if (typeof phoneNumber !== "string" || !phoneNumber.trim()) {
    res.send({ ok: false, error: "Missing phoneNumber" })
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
            : undefined
      }) // consultantFirstName dropped per JWT contract
    })

    if (!resp.ok) {
      // Middleware error envelope: { ok: false, error, reason?, retryAfterSec? }.
      // Forward reason/retryAfterSec verbatim so the CallButton can render a
      // countdown for 429s (duplicate / rate_limit). For non-JSON responses
      // (network / proxy quirks), synthesize a fallback from the status line.
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
