import type { PlasmoMessaging } from "@plasmohq/messaging"

const handler: PlasmoMessaging.MessageHandler = async (_req, res) => {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true })
  const tab = tabs[0]

  if (!tab?.id) {
    res.send({ candidates: [], count: 0 })
    return
  }

  try {
    const response = await chrome.tabs.sendMessage(tab.id, {
      type: "getSelectedCandidates"
    })
    res.send(response)
  } catch {
    res.send({ candidates: [], count: 0 })
  }
}

export default handler
