// src/background/messages/auth-sign-in.ts
import type { PlasmoMessaging } from "@plasmohq/messaging"

import { handleSignIn, type SignInOutcome } from "~background/auth-runtime"

const handler: PlasmoMessaging.MessageHandler<unknown, SignInOutcome> = async (_req, res) => {
  const outcome = await handleSignIn()
  res.send(outcome)
}

export default handler
