import type { PlasmoMessaging } from "@plasmohq/messaging"

const handler: PlasmoMessaging.MessageHandler<
  unknown,
  { profileUrl: string | null }
> = async (_req, res) => {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true })
  const tab = tabs[0]
  if (!tab?.id) {
    res.send({ profileUrl: null })
    return
  }
  try {
    const response = await chrome.tabs.sendMessage(tab.id, {
      type: "getCandidateProfileUrl"
    })
    res.send(response ?? { profileUrl: null })
  } catch {
    res.send({ profileUrl: null })
  }
}

export default handler
