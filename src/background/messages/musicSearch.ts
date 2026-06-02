import type { PlasmoMessaging } from "@plasmohq/messaging"

import { authFetch, NotAuthenticatedError } from "~background/auth-runtime"
import { parseSongs } from "~lib/musicParse"

const MUSIC_URL = process.env.PLASMO_PUBLIC_MUSIC_URL
const ROUTE_PATH = "/music/search"

// Song search (submit-only; the bar never debounces keystroke-by-keystroke).
// Returns a normalised MusicSongResult[] via the shared, Paged-aware parser;
// rows that don't carry the required fields are dropped so the list always
// gets clean data.
const handler: PlasmoMessaging.MessageHandler = async (req, res) => {
  if (!MUSIC_URL) {
    res.send({
      ok: false,
      error:
        "Music worker URL not configured at build time. Rebuild with .env.{development,production} set (PLASMO_PUBLIC_MUSIC_URL)."
    })
    return
  }

  const { query } = req.body ?? {}

  if (typeof query !== "string" || !query.trim()) {
    res.send({ ok: false, error: "Missing search query" })
    return
  }

  // The worker serves search as an idempotent GET with the query in ?q=;
  // POSTing here would hit its 405 (method-not-allowed) and break search.
  const url = `${MUSIC_URL.replace(/\/+$/, "")}${ROUTE_PATH}?q=${encodeURIComponent(query.trim())}`

  try {
    const resp = await authFetch(url, { method: "GET" })
    if (!resp.ok) {
      res.send({ ok: false, error: `${resp.status} ${resp.statusText}` })
      return
    }
    const data = await resp.json().catch(() => null)
    res.send({ ok: true, results: parseSongs(data) })
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
