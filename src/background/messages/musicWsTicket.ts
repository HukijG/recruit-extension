import type { PlasmoMessaging } from "@plasmohq/messaging"

const MUSIC_URL = process.env.PLASMO_PUBLIC_MUSIC_URL
const ROUTE_PATH = "/music/ws-ticket"

// Mint a single-use ticket for the now-playing WebSocket handshake. A browser
// WebSocket can't set request headers, so the WS can't carry the normal
// X-Extension-Token. Instead the bar calls this handler over the authed HTTP
// path (same secret/header as the other /music/* control routes) to mint a
// short-lived ticket, then opens the WS with `ticket.<id>` as a subprotocol;
// the worker redeems it from Sec-WebSocket-Protocol before accepting the
// upgrade. Returns { ok: true, ticket } on success; any failure is reported as
// an error envelope so the hook can treat it like a dropped connection.
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
    const data = await resp.json().catch(() => null)
    const ticket = data && typeof data.ticket === "string" ? data.ticket : null
    if (!ticket) {
      res.send({ ok: false, error: "Ticket response missing ticket id" })
      return
    }
    res.send({ ok: true, ticket })
  } catch (err) {
    res.send({
      ok: false,
      error: err instanceof Error ? err.message : "Network error"
    })
  }
}

export default handler
