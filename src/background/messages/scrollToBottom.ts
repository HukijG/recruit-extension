import type { PlasmoMessaging } from "@plasmohq/messaging"

const LOG_PREFIX = "[LR-Scraper][Background]"

const handler: PlasmoMessaging.MessageHandler = async (req, res) => {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true })
  const tab = tabs[0]

  if (!tab?.id) {
    console.error(LOG_PREFIX, "scrollToBottom: No active tab")
    res.send({ success: false, totalRowsLoaded: 0 })
    return
  }

  try {
    const response = await chrome.tabs.sendMessage(tab.id, {
      type: "scrollToBottom",
      targetCount: req.body?.targetCount ?? 25
    })
    res.send(response)
  } catch (err) {
    console.error(LOG_PREFIX, "scrollToBottom relay failed:", err)
    res.send({ success: false, totalRowsLoaded: 0 })
  }
}

export default handler
