import type { PlasmoMessaging } from "@plasmohq/messaging"

const MIDDLEWARE_URL = process.env.PLASMO_PUBLIC_MIDDLEWARE_URL

const handler: PlasmoMessaging.MessageHandler = async (req, res) => {
  if (!MIDDLEWARE_URL) {
    res.send({ ok: false, error: "Middleware URL not configured at build time. Rebuild with .env.production set." })
    return
  }

  const { rfIds, jobId, secret } = req.body ?? {}

  if (!rfIds?.length || !jobId) {
    res.send({ ok: false, error: "Missing rfIds or jobId" })
    return
  }

  const url = `${MIDDLEWARE_URL.replace(/\/+$/, "")}/candidates/add-to-job`

  const headers: Record<string, string> = { "Content-Type": "application/json" }
  if (secret) headers["X-Extension-Token"] = secret

  try {
    const resp = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({ rfIds, jobId })
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
    const msg = err?.message ?? "Network error"
    res.send({ ok: false, error: msg })
  }
}

export default handler
