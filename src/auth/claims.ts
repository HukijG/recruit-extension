// src/auth/claims.ts
//
// Resolves a display first-name from id_token claims. CF Access with
// One-Time PIN IdP exposes only `email`, so this falls through to an
// email-derived name. See spec § "Display-name resolution".

import type { AuthUser } from "~auth/storage"

type IdTokenClaims = {
  sub: string
  email: string
  name?: string
  given_name?: string
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0
}

function capitalize(word: string): string {
  if (word.length === 0) return word
  return word.charAt(0).toUpperCase() + word.slice(1)
}

export function resolveDisplayFirstName(
  givenName: string | null,
  name: string | null,
  email: string
): string {
  if (isNonEmptyString(givenName)) return givenName.trim()

  if (isNonEmptyString(name)) {
    const first = name.trim().split(/\s+/)[0]
    if (first) return first
  }

  const local = email.split("@")[0] ?? ""
  if (local) {
    const segment = local.split(/[._]/).find((s) => s.length > 0)
    if (segment) return capitalize(segment.toLowerCase())
  }

  return "there"
}

export function buildUserFromClaims(claims: IdTokenClaims): AuthUser {
  const givenName = isNonEmptyString(claims.given_name) ? claims.given_name : null
  const name = isNonEmptyString(claims.name) ? claims.name : null
  return {
    sub: claims.sub,
    email: claims.email,
    name,
    givenName,
    displayFirstName: resolveDisplayFirstName(givenName, name, claims.email)
  }
}
