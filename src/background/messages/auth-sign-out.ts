// src/background/messages/auth-sign-out.ts
import type { PlasmoMessaging } from "@plasmohq/messaging"

import { handleSignOut } from "~background/auth-runtime"

const handler: PlasmoMessaging.MessageHandler<unknown, { ok: true }> = async (_req, res) => {
  await handleSignOut()
  res.send({ ok: true })
}

export default handler
