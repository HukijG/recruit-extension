import type { PlasmoMessaging } from "@plasmohq/messaging"

const LOG_PREFIX = "[LR-Scraper][Background]"

const handler: PlasmoMessaging.MessageHandler = async (req, res) => {
  const { middlewareUrl, rfIds, jobId, secret } = req.body ?? {}

  if (!middlewareUrl || !rfIds?.length || !jobId) {
    res.send({ ok: false, error: "Missing middlewareUrl, rfIds, or jobId" })
    return
  }

  const url = `${middlewareUrl.replace(/\/+$/, "")}/candidates/add-to-job`
  console.log(LOG_PREFIX, `addToJob: POST ${url} — ${rfIds.length} candidates to job ${jobId}`)

  const headers: Record<string, string> = { "Content-Type": "application/json" }
  if (secret) headers["X-Extension-Token"] = secret

  try {
    const resp = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({ rfIds, jobId })
    })

    if (!resp.ok) {
      let errorBody = ""
      try {
        errorBody = await resp.text()
      } catch {}
      const msg = `${resp.status} ${resp.statusText}${errorBody ? ": " + errorBody : ""}`
      console.error(LOG_PREFIX, `addToJob failed:`, msg)
      res.send({ ok: false, error: msg })
      return
    }

    const data = await resp.json()
    console.log(LOG_PREFIX, `addToJob OK — added: ${data.added}, errors: ${data.errors}`)
    res.send({ ok: true, data })
  } catch (err: any) {
    const msg = err?.message ?? "Network error"
    console.error(LOG_PREFIX, `addToJob error:`, msg)
    res.send({ ok: false, error: msg })
  }
}

export default handler
