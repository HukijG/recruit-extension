import type { PlasmoMessaging } from "@plasmohq/messaging"

import type { MusicSongResult } from "~lib/types"

const MIDDLEWARE_URL = process.env.PLASMO_PUBLIC_MIDDLEWARE_URL
const ROUTE_PATH = "/music/playlist-contents"

// Fetch the songs inside a playlist so the user can drill in and enqueue/play
// individual tracks. Body carries the numeric playlist id (frozen contract);
// returns the same normalised MusicSongResult[] shape as song search so the
// results list renders identically.
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

  const { id, secret } = req.body ?? {}

  if (typeof id !== "number") {
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
