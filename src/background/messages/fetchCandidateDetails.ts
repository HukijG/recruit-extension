import type { PlasmoMessaging } from "@plasmohq/messaging"
import { Storage } from "@plasmohq/storage"

const MIDDLEWARE_URL = process.env.PLASMO_PUBLIC_MIDDLEWARE_URL

// Placeholder route — the middleware-side agent picks the final path.
// When confirmed, update this constant.
const ROUTE_PATH = "/candidate-details"

const handler: PlasmoMessaging.MessageHandler = async (req, res) => {
  if (!MIDDLEWARE_URL) {
    res.send({
      ok: false,
      error:
        "Middleware URL not configured at build time. Rebuild with .env.production set."
    })
    return
  }

  const { profileUrl, secret } = req.body ?? {}

  if (!profileUrl || typeof profileUrl !== "string") {
    res.send({ ok: false, error: "Missing profileUrl" })
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
      body: JSON.stringify({ consultantFirstName, profileUrl })
    })

    if (!resp.ok) {
      let errorBody = ""
      try {
        errorBody = await resp.text()
      } catch {}
      const msg = `${resp.status} ${resp.statusText}${errorBody ? ": " + errorBody : ""}`
      res.send({ ok: false, error: msg })
      return
    }

    const data = await resp.json()
    res.send({ ok: true, data })
  } catch (err: any) {
    res.send({ ok: false, error: err?.message ?? "Network error" })
  }
}

export default handler
