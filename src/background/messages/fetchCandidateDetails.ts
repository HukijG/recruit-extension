import type { PlasmoMessaging } from "@plasmohq/messaging"

import {
  authFetch,
  buildMiddlewareUrl,
  NotAuthenticatedError
} from "~background/auth-runtime"

const ROUTE_PATH = "/candidate-details"

const handler: PlasmoMessaging.MessageHandler = async (req, res) => {
  const { profileUrl } = req.body ?? {}
  if (!profileUrl || typeof profileUrl !== "string") {
    res.send({ ok: false, error: "Missing profileUrl" })
    return
  }
  try {
    const resp = await authFetch(buildMiddlewareUrl(ROUTE_PATH), {
      method: "POST",
      body: JSON.stringify({ profileUrl })
    })
    if (!resp.ok) {
      let errorBody = ""
      try { errorBody = await resp.text() } catch {}
      res.send({
        ok: false,
        error: `${resp.status} ${resp.statusText}${errorBody ? ": " + errorBody : ""}`
      })
      return
    }
    const data = await resp.json()
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
