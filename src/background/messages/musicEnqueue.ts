import type { PlasmoMessaging } from "@plasmohq/messaging"

import { coerceTrackId } from "~lib/musicParse"

const MUSIC_URL = process.env.PLASMO_PUBLIC_MUSIC_URL
const ROUTE_PATH = "/music/enqueue"

// Add a song to the queue. Posts the frozen contract's NUMERIC { id } payload
// (`songs::enqueue` deserializes `id: u64`). The bar carries the id as a string
// (stable React key / tolerant parse); coerceTrackId narrows it to a JSON
// number here. Fire-and-forget — the queue change surfaces through the
// now-playing WS stream, not this response.
const handler: PlasmoMessaging.MessageHandler = async (req, res) => {
  if (!MUSIC_URL) {
    res.send({
      ok: false,
      error:
        "Music worker URL not configured at build time. Rebuild with .env.{development,production} set (PLASMO_PUBLIC_MUSIC_URL)."
    })
    return
  }

  const id = coerceTrackId((req.body ?? {}).id)
  const { secret } = req.body ?? {}

  if (id === null) {
    res.send({ ok: false, error: "Missing or invalid song id" })
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
