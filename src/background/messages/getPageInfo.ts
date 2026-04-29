import type { PlasmoMessaging } from "@plasmohq/messaging"

const LOG_PREFIX = "[LR-Sync][Background]"

const handler: PlasmoMessaging.MessageHandler = async (_req, res) => {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true })
  const tab = tabs[0]

  if (!tab?.id || !tab.url?.startsWith("https://www.linkedin.com/talent/")) {
    res.send({ isPipelinePage: false, totalOnPage: 0, checkedCount: 0 })
    return
  }

  try {
    const response = await chrome.tabs.sendMessage(tab.id, {
      type: "getPageInfo"
    })
    res.send(response)
  } catch (err) {
    console.warn(LOG_PREFIX, "getPageInfo relay failed:", err)
    res.send({ isPipelinePage: false, totalOnPage: 0, checkedCount: 0 })
  }
}

export default handler
