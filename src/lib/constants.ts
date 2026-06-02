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
// UX hint only — last email we successfully exchanged tokens for. Passed
// as `login_hint` on the next authorization URL so CF Access's OTP page
// pre-fills the email field. Not auth state — survives sign-out on
// purpose; the user can edit/clear the field on the CF page if they
// want to sign in as someone else.
export const LAST_EMAIL_KEY = "auth:lastEmail"

export const NEEDS_RECONNECT_BROADCAST = "lr-needs-reconnect" as const
