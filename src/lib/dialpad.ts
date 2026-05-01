// Type definitions for the middleware-routed Dialpad call flow.
//
// The actual Dialpad API calls live in the Cloudflare Worker — the extension
// only ever talks to the worker. The worker hands back aliased caller-ID
// tokens; the extension echoes those back when initiating a call, so real
// E.164 numbers never sit in the browser.
//
// We don't expose a device picker — Dialpad's `initiate_call` endpoint
// doesn't accept a `device_id` param; it rings every eligible device on the
// account and the user picks up wherever's convenient.
//
// See the Dialpad middleware handoff notes for the full contract.

export interface DialpadCallerIdOption {
  aliasId: string
  // "UK" / "US" / "OTHER" — derived from the E.164 prefix server-side. The
  // actual phone number never leaves the middleware.
  country: "UK" | "US" | "OTHER"
  // Optional human label, e.g. "Office main line", "Sales group", "My number".
  // Helps when there are multiple caller IDs in the same country.
  label?: string
  // True on the entry whose decoded number matches the user's current
  // caller_id default in Dialpad. The picker pre-selects this one.
  isDefault?: boolean
}

export interface DialpadUserContext {
  callerIds: DialpadCallerIdOption[]
}
