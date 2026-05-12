// src/background/messages/auth-get-token.ts
//
// Returns a valid token, refreshing if near expiry. For content scripts
// or future callers that need to attach Authorization headers themselves.
// Background-internal callers should use `authFetch` instead.

import type { PlasmoMessaging } from "@plasmohq/messaging"

import {
  getValidToken,
  NotAuthenticatedError
} from "~background/auth-runtime"

type Resp =
  | { ok: true; accessToken: string }
  | { ok: false; error: "not_authenticated" }

const handler: PlasmoMessaging.MessageHandler<unknown, Resp> = async (_req, res) => {
  try {
    const accessToken = await getValidToken()
    res.send({ ok: true, accessToken })
  } catch (err) {
    if (err instanceof NotAuthenticatedError) {
      res.send({ ok: false, error: "not_authenticated" })
      return
    }
    throw err
  }
}

export default handler
