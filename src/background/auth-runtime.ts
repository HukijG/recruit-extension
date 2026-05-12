// src/background/auth-runtime.ts
//
// Background-only auth runtime. WRITE helpers for the auth storage keys
// live here (read helpers live in src/auth/storage.ts). Plus:
//   - PKCE sign-in flow with chrome.identity.launchWebAuthFlow
//   - Refresh with module-level promise lock (serialized — refresh
//     tokens rotate)
//   - authFetch wrapper with 401-on-auth_jwt_invalid retry
//   - Identity-bound cache sweep on sign-out
//   - lr-needs-reconnect broadcast for instant UI snap
//
// This module is imported ONLY from background/. React code, content
// scripts, and ~lib helpers must NEVER import it — see spec's
// "Module-placement write-protection" section.

import { localStore } from "~lib/constants"
import {
  AUTH_FLIGHT_KEY,
  AUTH_SESSION_KEY,
  AUTH_TRANSIENT_KEY,
  NEEDS_RECONNECT_BROADCAST
} from "~lib/constants"
import { buildUserFromClaims } from "~auth/claims"
import {
  buildAuthorizationUrl,
  buildIssuer,
  exchangeAuthorizationCode,
  exchangeRefreshToken,
  generatePkceMaterial,
  getAuthorizationServer,
  getIdTokenClaims,
  type AS,
  type Client
} from "~auth/oauth"
import type {
  AuthFlight,
  AuthSession,
  AuthTransient,
  AuthUser
} from "~auth/storage"
import { readFlight, readSession, readTransient } from "~auth/storage"

// ---- env (resolved once; fail loudly if missing) ----

const TEAM_DOMAIN = process.env.PLASMO_PUBLIC_ACCESS_TEAM_DOMAIN
const CLIENT_ID = process.env.PLASMO_PUBLIC_ACCESS_CLIENT_ID
const AUDIENCE = process.env.PLASMO_PUBLIC_ACCESS_AUDIENCE

if (!TEAM_DOMAIN || !CLIENT_ID || !AUDIENCE) {
  // Logged at module init — surfaces immediately on SW start.
  console.error(
    "[auth-runtime] Missing required env vars. Got:",
    {
      PLASMO_PUBLIC_ACCESS_TEAM_DOMAIN: !!TEAM_DOMAIN,
      PLASMO_PUBLIC_ACCESS_CLIENT_ID: !!CLIENT_ID,
      PLASMO_PUBLIC_ACCESS_AUDIENCE: !!AUDIENCE
    }
  )
}

const CLIENT: Client = { client_id: CLIENT_ID ?? "" }
const SCOPE = "openid email profile"
const FLIGHT_TTL_MS = 10 * 60 * 1000
const REFRESH_LEEWAY_MS = 30_000

const REDIRECT_URI = `https://${chrome.runtime.id}.chromiumapp.org/oauth-callback`

// ---- error type used by background message handlers ----

export class NotAuthenticatedError extends Error {
  constructor(reason: "no_session" | "refresh_failed" = "no_session") {
    super(reason)
    this.name = "NotAuthenticatedError"
  }
}

// ---- write helpers (background-only) ----

export async function writeSession(session: AuthSession): Promise<void> {
  await localStore.set(AUTH_SESSION_KEY, session)
}

export async function writeTransient(transient: AuthTransient): Promise<void> {
  await localStore.set(AUTH_TRANSIENT_KEY, transient)
}

export async function clearTransient(): Promise<void> {
  await localStore.set(AUTH_TRANSIENT_KEY, null)
}

export async function writeFlight(flight: AuthFlight): Promise<void> {
  await localStore.set(AUTH_FLIGHT_KEY, flight)
}

export async function clearFlight(): Promise<void> {
  await localStore.set(AUTH_FLIGHT_KEY, null)
}

// ---- discovery (memoized) ----

async function getAS(): Promise<AS> {
  return getAuthorizationServer(buildIssuer(TEAM_DOMAIN!, CLIENT_ID!))
}

// ---- identity-bound caches (registered prefixes) ----

const IDENTITY_BOUND_PREFIXES = ["dialpadUserContext:"] as const

export async function sweepIdentityBoundCaches(): Promise<void> {
  // @types/chrome's `get` overloads with `null` keys resolve ambiguously
  // through the callback variant; cast to the Promise form explicitly so
  // we get a usable record back without changing runtime behavior.
  const all = (await (
    chrome.storage.local.get(null) as unknown as Promise<Record<string, unknown>>
  )) ?? {}
  const keys = Object.keys(all).filter((k) =>
    IDENTITY_BOUND_PREFIXES.some((p) => k.startsWith(p))
  )
  if (keys.length) await chrome.storage.local.remove(keys)
}

// ---- sign-in flow ----

export type SignInOutcome =
  | { ok: true }
  | { ok: false; error: "auth_cancelled" | "auth_failed" }

export async function handleSignIn(): Promise<SignInOutcome> {
  if (!TEAM_DOMAIN || !CLIENT_ID || !AUDIENCE) {
    await writeTransient({ error: "auth_failed" })
    return { ok: false, error: "auth_failed" }
  }

  await clearTransient()

  let pkce
  try {
    pkce = await generatePkceMaterial()
  } catch {
    await writeTransient({ error: "auth_failed" })
    return { ok: false, error: "auth_failed" }
  }

  const flight: AuthFlight = {
    verifier: pkce.verifier,
    state: pkce.state,
    nonce: pkce.nonce,
    redirectUri: REDIRECT_URI,
    startedAt: Date.now()
  }
  await writeFlight(flight)

  let returned: string | undefined
  try {
    const as = await getAS()
    const authUrl = buildAuthorizationUrl({
      as,
      clientId: CLIENT_ID,
      redirectUri: REDIRECT_URI,
      scope: SCOPE,
      pkce
    })
    returned = await chrome.identity.launchWebAuthFlow({
      interactive: true,
      url: authUrl.toString()
    })
  } catch (err) {
    await clearFlight()
    const msg = String((err as Error)?.message ?? "").toLowerCase()
    const cancelled = msg.includes("did not approve")
    await writeTransient({ error: cancelled ? "auth_cancelled" : "auth_failed" })
    return { ok: false, error: cancelled ? "auth_cancelled" : "auth_failed" }
  }

  if (!returned) {
    await clearFlight()
    await writeTransient({ error: "auth_failed" })
    return { ok: false, error: "auth_failed" }
  }

  // Re-read flight — the SW may have suspended during the window.
  const persisted = await readFlight()
  if (!persisted || persisted.state !== pkce.state || (Date.now() - persisted.startedAt) > FLIGHT_TTL_MS) {
    await clearFlight()
    await writeTransient({ error: "auth_failed" })
    return { ok: false, error: "auth_failed" }
  }

  try {
    const as = await getAS()
    const result = await exchangeAuthorizationCode({
      as,
      client: CLIENT,
      callbackUrl: new URL(returned),
      redirectUri: persisted.redirectUri,
      verifier: persisted.verifier,
      state: persisted.state,
      nonce: persisted.nonce
    })
    const claims = getIdTokenClaims(result)
    if (!claims || typeof claims.sub !== "string" || typeof claims.email !== "string") {
      throw new Error("id_token missing required claims (sub / email)")
    }
    const user = buildUserFromClaims({
      sub: claims.sub,
      email: claims.email,
      name: typeof claims.name === "string" ? claims.name : undefined,
      given_name: typeof claims.given_name === "string" ? claims.given_name : undefined
    })
    const session: AuthSession = {
      accessToken: result.access_token,
      refreshToken: result.refresh_token ?? "",
      expiresAt: Date.now() + Number(result.expires_in ?? 0) * 1000,
      user
    }
    if (!session.refreshToken) {
      // App 2 spec requires refresh_token grant — if absent, treat as misconfig.
      throw new Error("token response missing refresh_token (App 2 must grant refresh_token)")
    }
    await writeSession(session)
    await clearTransient()
    await clearFlight()
    return { ok: true }
  } catch (err) {
    console.error("[auth-runtime] sign-in code exchange failed:", err)
    await clearFlight()
    await writeTransient({ error: "auth_failed" })
    return { ok: false, error: "auth_failed" }
  }
}

// ---- sign-out ----

export async function handleSignOut(): Promise<void> {
  // Transient cleared BEFORE session so storage events don't briefly
  // render LoginScreen with a stale error.
  await writeTransient(null)
  await writeSession(null)
  await clearFlight()  // hygiene — clears any stranded sign-in flight
  await sweepIdentityBoundCaches()
}

// ---- refresh (serialized) ----

let refreshInFlight: Promise<string> | null = null

async function broadcastNeedsReconnect(): Promise<void> {
  try {
    await chrome.runtime.sendMessage({ type: NEEDS_RECONNECT_BROADCAST })
  } catch {
    // No listener — sidepanel closed. useStorage will catch the storage event.
  }
}

function mergeRefreshedSession(
  prev: NonNullable<AuthSession>,
  result: Awaited<ReturnType<typeof exchangeRefreshToken>>
): NonNullable<AuthSession> {
  let newUser: AuthUser = prev.user
  if (result.id_token) {
    const claims = getIdTokenClaims(result)
    if (claims && typeof claims.sub === "string" && typeof claims.email === "string") {
      newUser = buildUserFromClaims({
        sub: claims.sub,
        email: claims.email,
        name: typeof claims.name === "string" ? claims.name : undefined,
        given_name: typeof claims.given_name === "string" ? claims.given_name : undefined
      })
    }
  }
  return {
    accessToken: result.access_token,
    refreshToken: result.refresh_token ?? prev.refreshToken,
    expiresAt: Date.now() + Number(result.expires_in ?? 0) * 1000,
    user: newUser
  }
}

async function doRefresh(): Promise<string> {
  const session = await readSession()
  if (!session) {
    await writeTransient({ error: "needs_reconnect" })
    throw new NotAuthenticatedError("no_session")
  }
  try {
    const as = await getAS()
    const result = await exchangeRefreshToken({
      as,
      client: CLIENT,
      refreshToken: session.refreshToken
    })
    const newSession = mergeRefreshedSession(session, result)
    await writeSession(newSession)
    await clearTransient()
    return newSession.accessToken
  } catch (err) {
    // Flight state belongs to the sign-in flow; refresh never touches it.
    console.warn("[auth-runtime] refresh failed:", err)
    await writeSession(null)
    await writeTransient({ error: "needs_reconnect" })
    void broadcastNeedsReconnect()
    throw new NotAuthenticatedError("refresh_failed")
  }
}

export function refresh(): Promise<string> {
  if (refreshInFlight) return refreshInFlight
  // Clear the lock inside the body — settle then reset, mirrors the
  // `getAuthorizationServer` pattern in `oauth.ts`. We deliberately avoid
  // `inFlight.finally(() => { inFlight = null })` because `.finally()`
  // returns a new promise; if doRefresh rejects, that new promise also
  // rejects and — since we'd otherwise drop the reference — surfaces as
  // an `unhandledrejection` in the service worker even though every
  // awaiting caller has its own catch.
  refreshInFlight = (async () => {
    try {
      return await doRefresh()
    } finally {
      refreshInFlight = null
    }
  })()
  return refreshInFlight
}

// ---- getValidToken ----

export async function getValidToken(): Promise<string> {
  const session = await readSession()
  if (!session) {
    await writeTransient({ error: "needs_reconnect" })
    throw new NotAuthenticatedError("no_session")
  }
  if (session.expiresAt > Date.now() + REFRESH_LEEWAY_MS) {
    return session.accessToken
  }
  return refresh()
}

// ---- authFetch ----

export type AuthFetchInit = {
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE"
  headers?: HeadersInit
  body?: string
}

function stringifyBody(b: string | undefined): string | undefined {
  if (b === undefined) return undefined
  if (typeof b === "string") return b
  // Belt-and-suspenders; TS already enforces `body?: string`.
  throw new Error("authFetch only accepts string (JSON-stringified) bodies")
}

async function responseSignalsInvalidJwt(resp: Response): Promise<boolean> {
  try {
    const cloned = resp.clone()
    const text = await cloned.text()
    if (!text) return false
    try {
      const body = JSON.parse(text) as { error?: string; reason?: string }
      if (body?.error === "auth_jwt_invalid" || body?.reason === "auth_jwt_invalid") {
        return true
      }
    } catch {
      // not JSON — fall through
    }
    return text.includes("auth_jwt_invalid")
  } catch {
    return false
  }
}

export async function authFetch(
  url: string,
  init: AuthFetchInit
): Promise<Response> {
  const stableBody = stringifyBody(init.body)
  const buildHeaders = (token: string): Headers => {
    const h = new Headers(init.headers)
    h.set("Authorization", `Bearer ${token}`)
    if (!h.has("Content-Type") && stableBody !== undefined) {
      h.set("Content-Type", "application/json")
    }
    return h
  }

  const token = await getValidToken()
  let resp = await fetch(url, {
    method: init.method,
    headers: buildHeaders(token),
    body: stableBody
  })

  if (resp.status === 401 && (await responseSignalsInvalidJwt(resp))) {
    const fresh = await refresh() // throws NotAuthenticatedError on hard fail
    resp = await fetch(url, {
      method: init.method,
      headers: buildHeaders(fresh),
      body: stableBody
    })
  }

  if (resp.ok) {
    await clearTransient().catch(() => {})
  }

  return resp
}

// ---- middleware URL helper (re-export pattern used by handlers) ----

export const MIDDLEWARE_URL = process.env.PLASMO_PUBLIC_MIDDLEWARE_URL

export function buildMiddlewareUrl(path: string): string {
  if (!MIDDLEWARE_URL) {
    throw new Error(
      "Middleware URL not configured at build time. Rebuild with .env.{development,production} set."
    )
  }
  const base = MIDDLEWARE_URL.replace(/\/+$/, "")
  return `${base}${path.startsWith("/") ? path : "/" + path}`
}
