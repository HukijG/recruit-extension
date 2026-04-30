import type { PlasmoMessaging } from "@plasmohq/messaging"

import { parseLinkedInTalentUrl } from "~lib/url"

export interface ActiveTabContext {
  mode: "sync" | "candidate"
  urlId: string | null
  url: string
}

const handler: PlasmoMessaging.MessageHandler<unknown, ActiveTabContext> = async (
  _req,
  res
) => {
  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true })
    const tab = tabs[0]
    const url = tab?.url ?? ""
    const parsed = parseLinkedInTalentUrl(url)
    res.send({ mode: parsed.mode, urlId: parsed.urlId, url })
  } catch {
    res.send({ mode: "sync", urlId: null, url: "" })
  }
}

export default handler
