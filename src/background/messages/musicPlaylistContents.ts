import type { PlasmoMessaging } from "@plasmohq/messaging"

import { coerceTrackId, parseSongs } from "~lib/musicParse"

const MUSIC_URL = process.env.PLASMO_PUBLIC_MUSIC_URL
const ROUTE_PATH = "/music/playlist-contents"

// Fetch the songs inside a playlist so the user can drill in and enqueue/play
// individual tracks. Posts the frozen contract's NUMERIC { id } (same id-shape
// as the playlist-play action — coerced via coerceTrackId from the bar's
// string-carried id); returns the same normalised MusicSongResult[] shape as
// song search via the shared parser so the results list renders identically.
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
    res.send({ ok: false, error: "Missing or invalid playlist id" })
    return
  }

  // The worker serves playlist-contents as an idempotent GET reading ?id= (a
  // numeric Deezer id); POSTing here would hit its 405 and break drill-in.
  const url = `${MUSIC_URL.replace(/\/+$/, "")}${ROUTE_PATH}?id=${id}`
  const headers: Record<string, string> = {}
  if (secret) headers["X-Extension-Token"] = secret

  try {
    const resp = await fetch(url, { method: "GET", headers })
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
