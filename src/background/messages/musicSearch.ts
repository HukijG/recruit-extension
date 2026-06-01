import type { PlasmoMessaging } from "@plasmohq/messaging"

import type { MusicSongResult } from "~lib/types"

const MIDDLEWARE_URL = process.env.PLASMO_PUBLIC_MIDDLEWARE_URL
const ROUTE_PATH = "/music/search"

// Song search (submit-only; the bar never debounces keystroke-by-keystroke).
// Returns a normalised MusicSongResult[]. Deezer ids are numeric (frozen
// contract); rows that don't parse to the expected shape are dropped rather
// than passed through untyped, so the results list always gets clean data.
function parseSongs(raw: unknown): MusicSongResult[] {
  const list = Array.isArray(raw)
    ? raw
    : raw && typeof raw === "object" && Array.isArray((raw as { results?: unknown }).results)
      ? (raw as { results: unknown[] }).results
      : []
  const out: MusicSongResult[] = []
  for (const item of list) {
    if (!item || typeof item !== "object") continue
    const r = item as Record<string, unknown>
    if (
      typeof r.id === "number" &&
      typeof r.title === "string" &&
      typeof r.artists === "string" &&
      typeof r.album === "string" &&
      typeof r.artUrl === "string" &&
      typeof r.durationMs === "number"
    ) {
      out.push({
        id: r.id,
        title: r.title,
        artists: r.artists,
        album: r.album,
        artUrl: r.artUrl,
        durationMs: r.durationMs
      })
    }
  }
  return out
}

const handler: PlasmoMessaging.MessageHandler = async (req, res) => {
  if (!MIDDLEWARE_URL) {
    res.send({
      ok: false,
      error:
        "Middleware URL not configured at build time. Rebuild with .env.{development,production} set."
    })
    return
  }

  const { query, secret } = req.body ?? {}

  if (typeof query !== "string" || !query.trim()) {
    res.send({ ok: false, error: "Missing search query" })
    return
  }

  const url = `${MIDDLEWARE_URL.replace(/\/+$/, "")}${ROUTE_PATH}`
  const headers: Record<string, string> = { "Content-Type": "application/json" }
  if (secret) headers["X-Extension-Token"] = secret

  try {
    const resp = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({ query: query.trim() })
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
