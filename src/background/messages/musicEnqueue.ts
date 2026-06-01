import type { PlasmoMessaging } from "@plasmohq/messaging"

const MIDDLEWARE_URL = process.env.PLASMO_PUBLIC_MIDDLEWARE_URL
const ROUTE_PATH = "/music/enqueue"

// Add a song to the queue. Mirrors the dashboard's { id } payload; the id is a
// numeric Deezer id (frozen contract) and is guarded so a non-number can't
// reach the worker. Fire-and-forget — the queue change surfaces through the
// now-playing WS stream, not this response.
const handler: PlasmoMessaging.MessageHandler = async (req, res) => {
  if (!MIDDLEWARE_URL) {
    res.send({
      ok: false,
      error:
        "Middleware URL not configured at build time. Rebuild with .env.{development,production} set."
    })
    return
  }

  const { id, secret } = req.body ?? {}

  if (typeof id !== "number") {
    res.send({ ok: false, error: "Missing song id" })
    return
  }

  const url = `${MIDDLEWARE_URL.replace(/\/+$/, "")}${ROUTE_PATH}`
  const headers: Record<string, string> = { "Content-Type": "application/json" }
  if (secret) headers["X-Extension-Token"] = secret

  try {
    const resp = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({ id })
    })
    if (!resp.ok) {
      res.send({ ok: false, error: `${resp.status} ${resp.statusText}` })
      return
    }
    res.send({ ok: true })
  } catch (err) {
    res.send({
      ok: false,
      error: err instanceof Error ? err.message : "Network error"
    })
  }
}

export default handler
