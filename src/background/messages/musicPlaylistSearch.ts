import type { PlasmoMessaging } from "@plasmohq/messaging"

import { parsePlaylists } from "~lib/musicParse"

const MUSIC_URL = process.env.PLASMO_PUBLIC_MUSIC_URL
const ROUTE_PATH = "/music/playlist-search"

// Playlist search (submit-only). Returns a normalised MusicPlaylistResult[]
// via the shared, Paged-aware parser; malformed rows are dropped.
const handler: PlasmoMessaging.MessageHandler = async (req, res) => {
  if (!MUSIC_URL) {
    res.send({
      ok: false,
      error:
        "Music worker URL not configured at build time. Rebuild with .env.{development,production} set (PLASMO_PUBLIC_MUSIC_URL)."
    })
    return
  }

  const { query, secret } = req.body ?? {}

  if (typeof query !== "string" || !query.trim()) {
    res.send({ ok: false, error: "Missing search query" })
    return
  }

  // The worker serves playlist-search as an idempotent GET with the query in
  // ?q=; POSTing here would hit its 405 (method-not-allowed) and break search.
  const url = `${MUSIC_URL.replace(/\/+$/, "")}${ROUTE_PATH}?q=${encodeURIComponent(query.trim())}`
  const headers: Record<string, string> = {}
  if (secret) headers["X-Extension-Token"] = secret

  try {
    const resp = await fetch(url, { method: "GET", headers })
    if (!resp.ok) {
      res.send({ ok: false, error: `${resp.status} ${resp.statusText}` })
      return
    }
    const data = await resp.json().catch(() => null)
    res.send({ ok: true, results: parsePlaylists(data) })
  } catch (err) {
    res.send({
      ok: false,
      error: err instanceof Error ? err.message : "Network error"
    })
  }
}

export default handler
