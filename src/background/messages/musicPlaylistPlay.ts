import type { PlasmoMessaging } from "@plasmohq/messaging"

const MUSIC_URL = process.env.PLASMO_PUBLIC_MUSIC_URL
const ROUTE_PATH = "/music/playlist-play"

// Play an entire playlist. Mirrors the dashboard's { id } payload; STRING
// Deezer playlist id, guarded. Sibling of musicPlay — fire-and-forget, truth
// via the now-playing WS stream.
const handler: PlasmoMessaging.MessageHandler = async (req, res) => {
  if (!MUSIC_URL) {
    res.send({
      ok: false,
      error:
        "Music worker URL not configured at build time. Rebuild with .env.{development,production} set (PLASMO_PUBLIC_MUSIC_URL)."
    })
    return
  }

  const { id, secret } = req.body ?? {}

  if (typeof id !== "string" || !id) {
    res.send({ ok: false, error: "Missing playlist id" })
    return
  }

  const url = `${MUSIC_URL.replace(/\/+$/, "")}${ROUTE_PATH}`
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
