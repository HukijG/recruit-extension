import type { PlasmoMessaging } from "@plasmohq/messaging"

import {
  authFetch,
  buildMiddlewareUrl,
  NotAuthenticatedError
} from "~background/auth-runtime"
import type { SmsTemplate } from "~lib/types"

// GET /sms-templates — used by the one-shot hydration hook
// (useTemplateHydration) when local storage is empty. The worker scopes
// templates by JWT `sub` so no body / no path param is needed.

const ROUTE_PATH = "/sms-templates"

const handler: PlasmoMessaging.MessageHandler = async (_req, res) => {
  try {
    const resp = await authFetch(buildMiddlewareUrl(ROUTE_PATH), {
      method: "GET"
    })
    if (!resp.ok) {
      let errorBody = ""
      try {
        errorBody = await resp.text()
      } catch {}
      res.send({
        ok: false,
        error: `${resp.status} ${resp.statusText}${errorBody ? ": " + errorBody : ""}`
      })
      return
    }
    const data = (await resp.json()) as { templates?: SmsTemplate[] }
    res.send({ ok: true, templates: data.templates ?? [] })
  } catch (err) {
    if (err instanceof NotAuthenticatedError) {
      res.send({ ok: false, error: "not_authenticated" })
      return
    }
    res.send({ ok: false, error: (err as Error)?.message ?? "Network error" })
  }
}

export default handler
