import type { PlasmoMessaging } from "@plasmohq/messaging"

const handler: PlasmoMessaging.MessageHandler = async (req, res) => {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true })
  const tab = tabs[0]

  if (!tab?.id) {
    res.send({ success: false, totalRowsLoaded: 0 })
    return
  }

  try {
    const response = await chrome.tabs.sendMessage(tab.id, {
      type: "scrollToBottom",
      targetCount: req.body?.targetCount ?? 25
    })
    res.send(response)
  } catch {
    res.send({ success: false, totalRowsLoaded: 0 })
  }
}

export default handler
