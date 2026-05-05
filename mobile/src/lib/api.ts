import { storage } from "~/lib/storage"
import type { DialpadUserContext } from "~/lib/dialpad"
import type {
  CandidateDetails,
  MobileJob,
  PipelineCandidate
} from "~/lib/types"

// Direct-fetch wrapper around the middleware. On Android, Capacitor's
// `CapacitorHttp.enabled` config patches fetch to route through native
// HTTP — no CORS, no preflight, no WebView quirks. On web/dev this is
// a regular browser fetch and the worker's `Access-Control-Allow-Origin: *`
// handles cross-origin requests.
//
// All envelopes follow the same `{ ok, error?, reason?, retryAfterSec? }`
// shape the extension uses, so CallButton/TextPopover/etc. behave
// identically across the extension and the PWA.

const MIDDLEWARE_URL = import.meta.env.VITE_MIDDLEWARE_URL

export type Envelope<T> =
  | { ok: true; data: T }
  | {
      ok: false
      error: string
      reason?: "duplicate" | "rate_limit"
      retryAfterSec?: number
      status?: number
    }

function consultantName(): string {
  return storage.get<string>("consultantFirstName", "")
}

async function post<T>(
  path: string,
  body: object,
  secret: string
): Promise<Envelope<T>> {
  if (!MIDDLEWARE_URL) {
    return {
      ok: false,
      error:
        "Middleware URL not configured. Set VITE_MIDDLEWARE_URL in mobile/.env."
    }
  }
  const url = `${MIDDLEWARE_URL.replace(/\/+$/, "")}${path}`
  const headers: Record<string, string> = { "Content-Type": "application/json" }
  if (secret) headers["X-Extension-Token"] = secret

  try {
    const resp = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body)
    })

    if (!resp.ok) {
      let parsed: unknown = null
      try {
        parsed = await resp.json()
      } catch {
        // non-JSON error — fall through to status-line synthesis
      }
      if (
        parsed &&
        typeof parsed === "object" &&
        "error" in parsed &&
        typeof (parsed as { error: unknown }).error === "string"
      ) {
        const p = parsed as {
          error: string
          reason?: "duplicate" | "rate_limit"
          retryAfterSec?: number
        }
        return {
          ok: false,
          error: p.error,
          reason: p.reason,
          retryAfterSec:
            typeof p.retryAfterSec === "number" ? p.retryAfterSec : undefined,
          status: resp.status
        }
      }
      return {
        ok: false,
        error: `${resp.status} ${resp.statusText}`,
        status: resp.status
      }
    }

    const data = (await resp.json().catch(() => ({}))) as T
    return { ok: true, data }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Network error"
    return { ok: false, error: message }
  }
}

// ===== Dialpad / candidate endpoints (verbatim from the extension) =====

export function initiateDialpadCall(args: {
  phoneNumber: string
  callerAliasId?: string
  secret: string
}): Promise<Envelope<unknown>> {
  return post<unknown>(
    "/dialpad-call",
    {
      consultantFirstName: consultantName(),
      phoneNumber: args.phoneNumber.trim(),
      callerAliasId:
        args.callerAliasId && args.callerAliasId.trim()
          ? args.callerAliasId.trim()
          : undefined
    },
    args.secret
  )
}

export function dialpadHangup(args: {
  secret: string
}): Promise<Envelope<unknown>> {
  return post<unknown>(
    "/dialpad-hangup",
    { consultantFirstName: consultantName() },
    args.secret
  )
}

export function sendDialpadSms(args: {
  phoneNumber: string
  callerAliasId?: string
  text: string
  secret: string
}): Promise<Envelope<unknown>> {
  return post<unknown>(
    "/dialpad-sms",
    {
      consultantFirstName: consultantName(),
      phoneNumber: args.phoneNumber.trim(),
      callerAliasId:
        args.callerAliasId && args.callerAliasId.trim()
          ? args.callerAliasId.trim()
          : undefined,
      text: args.text
    },
    args.secret
  )
}

export function getDialpadUserContext(args: {
  secret: string
}): Promise<Envelope<DialpadUserContext>> {
  return post<DialpadUserContext>(
    "/dialpad-user-context",
    { consultantFirstName: consultantName() },
    args.secret
  )
}

export function markNumberInvalid(args: {
  rfId: number
  secret: string
}): Promise<Envelope<unknown>> {
  return post<unknown>(
    "/candidate-mark-invalid",
    { consultantFirstName: consultantName(), rfId: args.rfId },
    args.secret
  )
}

export function fetchCandidateDetails(args: {
  profileUrl: string
  secret: string
}): Promise<Envelope<CandidateDetails>> {
  return post<CandidateDetails>(
    "/candidate-details",
    {
      consultantFirstName: consultantName(),
      profileUrl: args.profileUrl
    },
    args.secret
  )
}

// ===== PWA-specific endpoints (the two new ones) =====

export function listMyJobs(args: {
  secret: string
}): Promise<Envelope<{ jobs: MobileJob[] }>> {
  return post<{ jobs: MobileJob[] }>(
    "/my-sourcing-jobs",
    { consultantFirstName: consultantName() },
    args.secret
  )
}

// Response is already sorted (added_time ASC, oldest first) and capped at
// 1000 candidates. `total` may exceed `candidates.length` when capped —
// surface as an info indicator if useful, but don't block traversal.
export function listJobPipeline(args: {
  jobId: number
  secret: string
}): Promise<
  Envelope<{
    jobId: number
    stage: string
    total: number
    candidates: PipelineCandidate[]
  }>
> {
  return post<{
    jobId: number
    stage: string
    total: number
    candidates: PipelineCandidate[]
  }>(
    "/job-pipeline",
    { consultantFirstName: consultantName(), jobId: args.jobId },
    args.secret
  )
}
