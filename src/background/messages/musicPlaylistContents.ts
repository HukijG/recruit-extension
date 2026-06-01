import type { PlasmoMessaging } from "@plasmohq/messaging"

import { parseSongs } from "~lib/musicParse"

const MIDDLEWARE_URL = process.env.PLASMO_PUBLIC_MIDDLEWARE_URL
const ROUTE_PATH = "/music/playlist-contents"

// Fetch the songs inside a playlist so the user can drill in and enqueue/play
// individual tracks. Body carries the string playlist id (Deezer ids are
// strings end-to-end); returns the same normalised MusicSongResult[] shape as
// song search via the shared parser so the results list renders identically.
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

  if (typeof id !== "string" || !id) {
    res.send({ ok: false, error: "Missing playlist id" })
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
    const data = await resp.json().catch(() => null)
    res.send({ ok: true, results: parseSongs(data) })
  } catch (err) {
    res.send({
      ok: false,
      error: err instanceof Error ? err.message : "Network error"
    })
  }
}

export default handler
