import type { PlasmoMessaging } from "@plasmohq/messaging"
import { Storage } from "@plasmohq/storage"

const MIDDLEWARE_URL = process.env.PLASMO_PUBLIC_MIDDLEWARE_URL
const ROUTE_PATH = "/dialpad-sms"

const handler: PlasmoMessaging.MessageHandler = async (req, res) => {
  if (!MIDDLEWARE_URL) {
    res.send({
      ok: false,
      error:
        "Middleware URL not configured at build time. Rebuild with .env.{development,production} set."
    })
    return
  }

  const { phoneNumber, callerAliasId, text, secret } = req.body ?? {}

  if (typeof phoneNumber !== "string" || !phoneNumber.trim()) {
    res.send({ ok: false, error: "Missing phoneNumber" })
    return
  }
  if (typeof text !== "string" || !text.trim()) {
    res.send({ ok: false, error: "Missing text" })
    return
  }

  const localStore = new Storage({ area: "local" })
  const consultantFirstName =
    (await localStore.get<string>("consultantFirstName")) ?? ""

  const url = `${MIDDLEWARE_URL.replace(/\/+$/, "")}${ROUTE_PATH}`
  const headers: Record<string, string> = { "Content-Type": "application/json" }
  if (secret) headers["X-Extension-Token"] = secret

  try {
    const resp = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({
        consultantFirstName,
        phoneNumber: phoneNumber.trim(),
        callerAliasId:
          typeof callerAliasId === "string" && callerAliasId.trim()
            ? callerAliasId.trim()
            : undefined,
        text
      })
    })

    if (!resp.ok) {
      // Same envelope as /dialpad-call. /dialpad-sms doesn't emit 429 today
      // but the middleware spec leaves room for it once production
      // candidate-mode lights up; threading reason/retryAfterSec through now
      // means the popover handles a future 429 without a second pass.
      let body: any = null
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
  } catch (err: any) {
    res.send({ ok: false, error: err?.message ?? "Network error" })
  }
}

export default handler
