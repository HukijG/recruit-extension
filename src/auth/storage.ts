// src/auth/storage.ts
//
// Read helpers + types for the auth storage keys. Imported by React code,
// background, and content scripts.
//
// Writes for these keys live in `src/background/auth-runtime.ts` and are
// only callable from the background service worker. Do NOT add write
// helpers here — see the spec's "Module-placement write-protection"
// section.

import {
  AUTH_FLIGHT_KEY,
  AUTH_SESSION_KEY,
  AUTH_TRANSIENT_KEY,
  localStore
} from "~lib/constants"

export type AuthUser = {
  sub: string
  email: string
  name: string | null
  givenName: string | null
  displayFirstName: string
}

export type AuthSession = {
  accessToken: string
  refreshToken: string
  expiresAt: number
  user: AuthUser
} | null

export type AuthTransientError = "needs_reconnect" | "auth_failed" | "auth_cancelled"

export type AuthTransient = {
  error: AuthTransientError
} | null

export type AuthFlight = {
  verifier: string
  state: string
  nonce: string
  redirectUri: string
  startedAt: number
} | null

export async function readSession(): Promise<AuthSession> {
  return ((await localStore.get<AuthSession>(AUTH_SESSION_KEY)) as AuthSession) ?? null
}

export async function readTransient(): Promise<AuthTransient> {
  return ((await localStore.get<AuthTransient>(AUTH_TRANSIENT_KEY)) as AuthTransient) ?? null
}

export async function readFlight(): Promise<AuthFlight> {
  return ((await localStore.get<AuthFlight>(AUTH_FLIGHT_KEY)) as AuthFlight) ?? null
}
