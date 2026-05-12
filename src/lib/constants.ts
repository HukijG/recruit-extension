import { Storage } from "@plasmohq/storage"

export const localStore = new Storage({ area: "local" })

// The activity `type` value the middleware uses for cold calls. Confirm with the
// middleware-side agent and update this constant when finalized.
export const COLD_CALL_TYPE = "cold_call"

export const UNDO_DELAY_MS = 5000

export const TEMPLATES_STORAGE_KEY = "lrSmsTemplates"

// --- Auth ---
//
// Three keys keep durable session, transient error, and short-lived
// PKCE flight state separate. See the OAuth / Cloudflare Access design notes.

export const AUTH_SESSION_KEY = "auth:session"
export const AUTH_TRANSIENT_KEY = "auth:transient"
export const AUTH_FLIGHT_KEY = "auth:sign-in-flight"

export const NEEDS_RECONNECT_BROADCAST = "lr-needs-reconnect" as const
