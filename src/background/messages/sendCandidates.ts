import type { PlasmoMessaging } from "@plasmohq/messaging"

const LOG_PREFIX = "[LR-Scraper][Background]"

const handler: PlasmoMessaging.MessageHandler = async (req, res) => {
  const { middlewareUrl, candidates, secret } = req.body ?? {}

  if (!middlewareUrl || !candidates?.length) {
    res.send({ ok: false, error: "Missing middlewareUrl or candidates" })
    return
  }

  const url = `${middlewareUrl.replace(/\/+$/, "")}/candidates`
  console.log(LOG_PREFIX, `sendCandidates: POST ${url} with ${candidates.length} candidates`)

  const headers: Record<string, string> = { "Content-Type": "application/json" }
  if (secret) headers["X-Extension-Token"] = secret

  try {
    const resp = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({ candidates })
    })

    if (!resp.ok) {
      let errorBody = ""
      try {
        errorBody = await resp.text()
      } catch {}
      const msg = `${resp.status} ${resp.statusText}${errorBody ? ": " + errorBody : ""}`
      console.error(LOG_PREFIX, `sendCandidates failed:`, msg)
      res.send({ ok: false, error: msg })
      return
    }

    const data = await resp.json()
    console.log(LOG_PREFIX, `sendCandidates OK — created: ${data.created}, skipped: ${data.skipped}, errors: ${data.errors}`)
    res.send({ ok: true, data })
  } catch (err: any) {
    const msg = err?.message ?? "Network error"
    console.error(LOG_PREFIX, `sendCandidates error:`, msg)
    res.send({ ok: false, error: msg })
  }
}

export default handler
