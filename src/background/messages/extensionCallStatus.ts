// src/background/messages/extensionCallStatus.ts
//
// Background-side wrapper for POST /extension-call-status. Replaces
// the previous direct fetch from src/lib/callStream.ts, which would
// have leaked the access token to the React side. The hook in
// callStream.ts dispatches to this handler at its existing 500ms
// cadence — messaging overhead is negligible compared to the network
// fetch and keeps the token in the SW per spec.

import type { PlasmoMessaging } from "@plasmohq/messaging"

import {
  authFetch,
  buildMiddlewareUrl,
  NotAuthenticatedError
} from "~background/auth-runtime"

const ROUTE_PATH = "/extension-call-status"

type Resp =
  | { ok: true; data: { state?: "in_progress" | "ended" } }
  | { ok: false; status?: number; transient?: boolean }

const handler: PlasmoMessaging.MessageHandler<unknown, Resp> = async (_req, res) => {
  try {
    const resp = await authFetch(buildMiddlewareUrl(ROUTE_PATH), {
      method: "POST",
      body: JSON.stringify({})
    })

    // Preserve the existing callStream's status-aware behavior:
    //  - 401/403 → terminal config issue (caller stops polling); auth-runtime already retried once on 401+auth_jwt_invalid, so reaching here = real auth break OR non-jwt 401
    //  - 500/502 → transient; caller keeps the loop alive
    //  - other non-ok → treat as transient; caller logs and retries
    if (resp.status === 401 || resp.status === 403) {
      res.send({ ok: false, status: resp.status, transient: false })
      return
    }
    if (resp.status === 500 || resp.status === 502) {
      res.send({ ok: false, status: resp.status, transient: true })
      return
    }
    if (!resp.ok) {
      res.send({ ok: false, status: resp.status, transient: true })
      return
    }

    const body = (await resp.json().catch(() => null)) as { state?: "in_progress" | "ended" } | null
    res.send({ ok: true, data: body ?? {} })
  } catch (err) {
    if (err instanceof NotAuthenticatedError) {
      // Treat as terminal; caller will stop polling and the LoginScreen
      // takes over via <RequireAuth>.
      res.send({ ok: false, status: 401, transient: false })
      return
    }
    // Network blip
    res.send({ ok: false, transient: true })
  }
}

export default handler
