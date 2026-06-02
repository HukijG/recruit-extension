import type { PlasmoMessaging } from "@plasmohq/messaging"

import { authFetch, NotAuthenticatedError } from "~background/auth-runtime"

const MUSIC_URL = process.env.PLASMO_PUBLIC_MUSIC_URL
const ROUTE_PATH = "/music/next"

// Skip-to-next transport control. Sibling of musicPause — same envelope: one
// authFetch POST carrying the Access OAuth token, fire-and-forget.
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
