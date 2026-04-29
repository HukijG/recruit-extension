import type { PlasmoMessaging } from "@plasmohq/messaging"

const LOG_PREFIX = "[LR-Sync][Background]"

const handler: PlasmoMessaging.MessageHandler = async (_req, res) => {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true })
  const tab = tabs[0]

  if (!tab?.id) {
    console.error(LOG_PREFIX, "getSelectedCandidates: No active tab")
    res.send({ candidates: [], count: 0 })
    return
  }

  try {
    const response = await chrome.tabs.sendMessage(tab.id, {
      type: "getSelectedCandidates"
    })
    res.send(response)
  } catch (err) {
    console.error(LOG_PREFIX, "getSelectedCandidates relay failed:", err)
    res.send({ candidates: [], count: 0 })
  }
}

export default handler
