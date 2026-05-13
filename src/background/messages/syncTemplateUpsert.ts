import type { PlasmoMessaging } from "@plasmohq/messaging"

import {
  authFetch,
  buildMiddlewareUrl,
  NotAuthenticatedError
} from "~background/auth-runtime"
import type { SmsTemplate } from "~lib/types"

// PUT /sms-templates/{id} — fire-and-forget cloud upsert. Local is the
// authoritative source; this writes the latest local snapshot up so that a
// fresh install / cleared storage can re-hydrate via listCloudTemplates.
// Callers (~lib/templates.saveTemplate) intentionally don't await this.

const ROUTE_PATH = "/sms-templates"

const handler: PlasmoMessaging.MessageHandler = async (req, res) => {
  const template = req.body?.template as SmsTemplate | undefined
  if (
    !template ||
    typeof template.id !== "string" ||
    template.id.length === 0
  ) {
    res.send({ ok: false, error: "Missing template or template.id" })
    return
  }
  try {
    const resp = await authFetch(
      buildMiddlewareUrl(
        `${ROUTE_PATH}/${encodeURIComponent(template.id)}`
      ),
      {
        method: "PUT",
        body: JSON.stringify(template)
      }
    )
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
    res.send({ ok: true })
  } catch (err) {
    if (err instanceof NotAuthenticatedError) {
      res.send({ ok: false, error: "not_authenticated" })
      return
    }
    res.send({ ok: false, error: (err as Error)?.message ?? "Network error" })
  }
}

export default handler
