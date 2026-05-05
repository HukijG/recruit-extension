// Type definitions for the middleware-routed Dialpad call flow.
//
// The actual Dialpad API calls live in the Cloudflare Worker — the PWA
// only ever talks to the worker. The worker hands back aliased caller-ID
// tokens; the PWA echoes those back when initiating a call, so real E.164
// numbers never sit in the browser.

export interface DialpadCallerIdOption {
  aliasId: string
  country: "UK" | "US" | "OTHER"
  label?: string
  isDefault?: boolean
}

export interface DialpadUserContext {
  callerIds: DialpadCallerIdOption[]
}
