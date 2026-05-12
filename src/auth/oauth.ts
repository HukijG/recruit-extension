// src/auth/oauth.ts
//
// oauth4webapi wrapper: discovery (memoized), authorize URL build, code
// exchange (PKCE / public client / None auth), refresh.
//
// This module has no storage I/O — it's the pure protocol layer.
// `background/auth-runtime.ts` composes these into the full lifecycle.

import * as oauth from "oauth4webapi"

export type AS = oauth.AuthorizationServer
export type Client = oauth.Client

let asPromise: Promise<AS> | null = null

export function buildIssuer(teamDomain: string, clientId: string): URL {
  // Trim trailing slash defensively — Plasmo env values may or may not include one.
  const trimmed = teamDomain.replace(/\/+$/, "")
  return new URL(`${trimmed}/cdn-cgi/access/sso/oidc/${clientId}`)
}

export async function getAuthorizationServer(issuer: URL): Promise<AS> {
  if (asPromise) return asPromise
  asPromise = (async () => {
    try {
      const resp = await oauth.discoveryRequest(issuer, { algorithm: "oidc" })
      return await oauth.processDiscoveryResponse(issuer, resp)
    } catch (err) {
      // Reset so the next caller can retry discovery rather than re-throwing
      // the same failure forever.
      asPromise = null
      throw err
    }
  })()
  return asPromise
}

export type PkceMaterial = {
  verifier: string
  challenge: string
  state: string
  nonce: string
}

export async function generatePkceMaterial(): Promise<PkceMaterial> {
  const verifier = oauth.generateRandomCodeVerifier()
  const challenge = await oauth.calculatePKCECodeChallenge(verifier)
  return {
    verifier,
    challenge,
    state: oauth.generateRandomState(),
    nonce: oauth.generateRandomNonce()
  }
}

export function buildAuthorizationUrl(args: {
  as: AS
  clientId: string
  redirectUri: string
  scope: string
  pkce: PkceMaterial
}): URL {
  // `authorization_endpoint` is optional on the discovery type but required
  // for OIDC. CF Access always returns one; if discovery ever omits it the
  // tenant is misconfigured and we throw a typed error instead of letting
  // `new URL(undefined!)` produce an opaque TypeError.
  if (!args.as.authorization_endpoint) {
    throw new Error("Discovery response missing authorization_endpoint")
  }
  const u = new URL(args.as.authorization_endpoint)
  u.searchParams.set("client_id", args.clientId)
  u.searchParams.set("redirect_uri", args.redirectUri)
  u.searchParams.set("response_type", "code")
  u.searchParams.set("scope", args.scope)
  u.searchParams.set("code_challenge", args.pkce.challenge)
  u.searchParams.set("code_challenge_method", "S256")
  u.searchParams.set("state", args.pkce.state)
  u.searchParams.set("nonce", args.pkce.nonce)
  return u
}

export async function exchangeAuthorizationCode(args: {
  as: AS
  client: Client
  callbackUrl: URL
  redirectUri: string
  verifier: string
  state: string
  nonce: string
}): Promise<oauth.TokenEndpointResponse> {
  // validateAuthResponse runs the synchronous state + iss + error checks and
  // throws if the callback URL is malformed. processAuthorizationCodeResponse
  // performs the id_token nonce + audience checks downstream.
  const params = oauth.validateAuthResponse(
    args.as,
    args.client,
    args.callbackUrl,
    args.state
  )
  const tokenResp = await oauth.authorizationCodeGrantRequest(
    args.as,
    args.client,
    oauth.None(),
    params,
    args.redirectUri,
    args.verifier
  )
  return oauth.processAuthorizationCodeResponse(
    args.as,
    args.client,
    tokenResp,
    { expectedNonce: args.nonce, requireIdToken: true }
  )
}

export async function exchangeRefreshToken(args: {
  as: AS
  client: Client
  refreshToken: string
}): Promise<oauth.TokenEndpointResponse> {
  const refreshResp = await oauth.refreshTokenGrantRequest(
    args.as,
    args.client,
    oauth.None(),
    args.refreshToken
  )
  return oauth.processRefreshTokenResponse(args.as, args.client, refreshResp)
}

export function getIdTokenClaims(
  result: oauth.TokenEndpointResponse
): oauth.IDToken | undefined {
  return oauth.getValidatedIdTokenClaims(result)
}
