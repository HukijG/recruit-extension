import type { PlasmoMessaging } from "@plasmohq/messaging"

const MUSIC_URL = process.env.PLASMO_PUBLIC_MUSIC_URL
const ROUTE_PATH = "/music/volume"

// Per-press volume nudge magnitude in percent points. The frozen cross-repo
// contract puts the +/-10 delta on the EXTENSION side ("Volume buttons send
// +/-10 percent-point deltas"), so the wire body is the signed delta, not a
// bare direction — the worker applies it verbatim.
const VOLUME_STEP_PP = 10

// Volume nudge. The bar sends a direction; the handler maps it to the signed
// +/-10 percent-point delta the frozen contract specifies and posts { delta }.
// The bar shows NO volume readout. `dir` is validated to the two-value union so
// a typo can't reach the worker.
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

  const delta = dir === "up" ? VOLUME_STEP_PP : -VOLUME_STEP_PP

  const url = `${MUSIC_URL.replace(/\/+$/, "")}${ROUTE_PATH}`
  const headers: Record<string, string> = { "Content-Type": "application/json" }
  if (secret) headers["X-Extension-Token"] = secret

  try {
    const resp = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({ delta })
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
