import type { PlasmoMessaging } from "@plasmohq/messaging"

import { authFetch, NotAuthenticatedError } from "~background/auth-runtime"

const MUSIC_URL = process.env.PLASMO_PUBLIC_MUSIC_URL
const ROUTE_PATH = "/music/volume"

// Volume nudge. The wire body is { direction: "up" | "down" }: the worker AND
// the dashboard both deserialize a bare direction and own the +/-10
// percent-point magnitude server-side — the extension does NOT compute or send
// a signed delta. The bar passes the direction in as `dir`; we validate it to
// the two-value union (so a typo can't reach the worker) and forward it as
// { direction }. The bar shows NO volume readout.
const handler: PlasmoMessaging.MessageHandler = async (req, res) => {
  if (!MUSIC_URL) {
    res.send({
      ok: false,
      error:
        "Music worker URL not configured at build time. Rebuild with .env.{development,production} set (PLASMO_PUBLIC_MUSIC_URL)."
    })
    return
  }

  const { dir } = req.body ?? {}

  if (dir !== "up" && dir !== "down") {
    res.send({ ok: false, error: "Invalid volume direction" })
    return
  }

  const url = `${MUSIC_URL.replace(/\/+$/, "")}${ROUTE_PATH}`

  try {
    const resp = await authFetch(url, {
      method: "POST",
      body: JSON.stringify({ direction: dir })
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
