import type { PlasmoMessaging } from "@plasmohq/messaging"

const MUSIC_URL = process.env.PLASMO_PUBLIC_MUSIC_URL
const ROUTE_PATH = "/music/volume"

// Volume nudge. The {delta}-vs-{dir} seam is now RESOLVED: the wire body is
// { direction: "up" | "down" }. The worker AND the dashboard both deserialize a
// bare direction and own the +/-10 percent-point magnitude server-side — the
// extension does NOT compute or send a signed delta. The bar passes the
// direction in as `dir`; we validate it to the two-value union (so a typo can't
// reach the worker) and forward it as { direction }. The bar shows NO volume
// readout.
const handler: PlasmoMessaging.MessageHandler = async (req, res) => {
  if (!MUSIC_URL) {
    res.send({
      ok: false,
      error:
        "Music worker URL not configured at build time. Rebuild with .env.{development,production} set (PLASMO_PUBLIC_MUSIC_URL)."
    })
    return
  }

  const { dir, secret } = req.body ?? {}

  if (dir !== "up" && dir !== "down") {
    res.send({ ok: false, error: "Invalid volume direction" })
    return
  }

  const url = `${MUSIC_URL.replace(/\/+$/, "")}${ROUTE_PATH}`
  const headers: Record<string, string> = { "Content-Type": "application/json" }
  if (secret) headers["X-Extension-Token"] = secret

  try {
    const resp = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({ direction: dir })
    })
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
