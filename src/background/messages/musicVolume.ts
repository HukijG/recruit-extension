import type { PlasmoMessaging } from "@plasmohq/messaging"

const MIDDLEWARE_URL = process.env.PLASMO_PUBLIC_MIDDLEWARE_URL
const ROUTE_PATH = "/music/volume"

// Volume nudge. The bar sends only a direction; the WORKER/dashboard own the
// +/-10 percent-point math (frozen contract), and the bar shows NO volume
// readout. We post { dir } and let the worker compute the new level. `dir` is
// validated to the two-value union so a typo can't reach the worker.
const handler: PlasmoMessaging.MessageHandler = async (req, res) => {
  if (!MIDDLEWARE_URL) {
    res.send({
      ok: false,
      error:
        "Middleware URL not configured at build time. Rebuild with .env.{development,production} set."
    })
    return
  }

  const { dir, secret } = req.body ?? {}

  if (dir !== "up" && dir !== "down") {
    res.send({ ok: false, error: "Invalid volume direction" })
    return
  }

  const url = `${MIDDLEWARE_URL.replace(/\/+$/, "")}${ROUTE_PATH}`
  const headers: Record<string, string> = { "Content-Type": "application/json" }
  if (secret) headers["X-Extension-Token"] = secret

  try {
    const resp = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({ dir })
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
