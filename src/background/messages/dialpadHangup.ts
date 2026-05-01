import type { PlasmoMessaging } from "@plasmohq/messaging"
import { Storage } from "@plasmohq/storage"

const MIDDLEWARE_URL = process.env.PLASMO_PUBLIC_MIDDLEWARE_URL
const ROUTE_PATH = "/dialpad-hangup"

// Wraps the middleware's POST /dialpad-hangup. Body is just
// { consultantFirstName } — the worker holds the active call_id in KV
// (written when the matching Dialpad `calling` event landed), so the
// extension never needs to track or forward a call_id.
//
// The 409 status (`No active call`) is a soft error, surfaced by the
// CallButton as inline UX rather than a crash; we forward `status` so
// the caller can branch on it.
const handler: PlasmoMessaging.MessageHandler = async (req, res) => {
  if (!MIDDLEWARE_URL) {
    res.send({
      ok: false,
      error:
        "Middleware URL not configured at build time. Rebuild with .env.{development,production} set."
    })
    return
  }

  const { secret } = req.body ?? {}

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
      body: JSON.stringify({ consultantFirstName })
    })

    if (!resp.ok) {
      let body: any = null
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
  } catch (err: any) {
    res.send({ ok: false, error: err?.message ?? "Network error" })
  }
}

export default handler
