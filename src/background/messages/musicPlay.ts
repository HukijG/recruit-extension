import type { PlasmoMessaging } from "@plasmohq/messaging"

import { authFetch, NotAuthenticatedError } from "~background/auth-runtime"
import { coerceTrackId } from "~lib/musicParse"

const MUSIC_URL = process.env.PLASMO_PUBLIC_MUSIC_URL
const ROUTE_PATH = "/music/play"

// Play a song now (jump the queue). Posts the frozen contract's NUMERIC { id }
// payload (`songs::play` deserializes `id: u64`). The bar carries the id as a
// string (stable React key / tolerant parse), so coerceTrackId narrows it back
// to a JSON number here. Sibling of musicEnqueue — fire-and-forget, truth via
// the now-playing WS stream.
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

  if (id === null) {
    res.send({ ok: false, error: "Missing or invalid song id" })
    return
  }

  const url = `${MUSIC_URL.replace(/\/+$/, "")}${ROUTE_PATH}`

  try {
    const resp = await authFetch(url, {
      method: "POST",
      body: JSON.stringify({ id })
    })
    if (!resp.ok) {
      res.send({ ok: false, error: `${resp.status} ${resp.statusText}` })
      return
    }
    res.send({ ok: true })
  } catch (err) {
    if (err instanceof NotAuthenticatedError) {
      res.send({ ok: false, error: "not_authenticated" })
      return
    }
    res.send({
      ok: false,
      error: err instanceof Error ? err.message : "Network error"
    })
  }
}

export default handler
