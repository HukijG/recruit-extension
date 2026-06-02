import type { PlasmoMessaging } from "@plasmohq/messaging"

import { authFetch, NotAuthenticatedError } from "~background/auth-runtime"

const MUSIC_URL = process.env.PLASMO_PUBLIC_MUSIC_URL
const ROUTE_PATH = "/music/pause"

// Pause transport control. One authFetch POST that carries the Cloudflare
// Access OAuth token (Authorization: Bearer) — no secret in the URL or body.
// Fire-and-forget — the bar's truth comes from the now-playing WS stream, not
// this response, so there's no optimistic toggle. We still surface { ok } so
// the caller can log a failed control.
const handler: PlasmoMessaging.MessageHandler = async (_req, res) => {
  if (!MUSIC_URL) {
    res.send({
      ok: false,
      error:
        "Music worker URL not configured at build time. Rebuild with .env.{development,production} set (PLASMO_PUBLIC_MUSIC_URL)."
    })
    return
  }

  const url = `${MUSIC_URL.replace(/\/+$/, "")}${ROUTE_PATH}`

  try {
    const resp = await authFetch(url, { method: "POST" })
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
