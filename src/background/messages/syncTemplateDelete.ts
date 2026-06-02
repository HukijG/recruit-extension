import type { PlasmoMessaging } from "@plasmohq/messaging"

import {
  authFetch,
  buildMiddlewareUrl,
  NotAuthenticatedError
} from "~background/auth-runtime"

// DELETE /sms-templates/{id} — fire-and-forget cloud delete. Triggered by
// ~lib/templates.deleteTemplate after the local removal commits. 404 from
// the worker (template never made it to cloud, or was already removed
// there) is treated as success — local already reflects the desired state.

const ROUTE_PATH = "/sms-templates"

const handler: PlasmoMessaging.MessageHandler = async (req, res) => {
  const id = req.body?.id as string | undefined
  if (typeof id !== "string" || id.length === 0) {
    res.send({ ok: false, error: "Missing id" })
    return
  }
  try {
    const resp = await authFetch(
      buildMiddlewareUrl(`${ROUTE_PATH}/${encodeURIComponent(id)}`),
      { method: "DELETE" }
    )
    if (!resp.ok && resp.status !== 404) {
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
