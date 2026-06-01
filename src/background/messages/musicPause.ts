import type { PlasmoMessaging } from "@plasmohq/messaging"

const MUSIC_URL = process.env.PLASMO_PUBLIC_MUSIC_URL
const ROUTE_PATH = "/music/pause"

// Pause transport control. Mirrors markNumberInvalid: middleware-URL guard,
// one POST, the extension secret carried ONLY as the X-Extension-Token header
// (never in the URL or body). Fire-and-forget — the bar's truth comes from
// the now-playing WS stream, not this response, so there's no optimistic
// toggle. We still surface { ok } so the caller can log a failed control.
const handler: PlasmoMessaging.MessageHandler = async (req, res) => {
  if (!MUSIC_URL) {
    res.send({
      ok: false,
      error:
        "Music worker URL not configured at build time. Rebuild with .env.{development,production} set (PLASMO_PUBLIC_MUSIC_URL)."
    })
    return
  }

  const { secret } = req.body ?? {}

  const url = `${MUSIC_URL.replace(/\/+$/, "")}${ROUTE_PATH}`
  const headers: Record<string, string> = { "Content-Type": "application/json" }
  if (secret) headers["X-Extension-Token"] = secret

  try {
    const resp = await fetch(url, { method: "POST", headers })
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
