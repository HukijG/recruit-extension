import type { DialpadUserContext } from "~/lib/dialpad"

// --- Candidate flow types (copied from extension) ---

export interface CandidateActivity {
  id: string | number
  type: string
  name: string
  description: string
  createdAt: string
  outcome: string | null
}

export interface CandidateJob {
  title: string
  company: string
  stage: string
}

export interface CandidateDetails {
  rfId: number
  fullName: string
  phoneNumber: string | null
  job: CandidateJob | null
  activities: CandidateActivity[]
}

export type MarkInvalidState =
  | { status: "idle" }
  | { status: "armed"; undoExpiresAt: number }
  | { status: "submitting" }
  | { status: "marked" }
  | { status: "error"; message: string }

export type CandidateState =
  | { phase: "idle" }
  | { phase: "loading"; urlId: string }
  | {
      phase: "ready"
      urlId: string
      details: CandidateDetails
      markInvalid: MarkInvalidState
    }
  | { phase: "error"; urlId: string; message: string }

// --- Calling / caller-id types ---

export interface CallConfig {
  callerAliasId?: string
}

export type UserContextState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; data: DialpadUserContext }

export type CallerIdPickerSlot = {
  state: UserContextState
  selectedAliasId: string
  onSelect: (aliasId: string) => void
} | null

export type TextSlot = {
  onOpen: () => void
} | null

// --- Live call-state polling ---

export type CallStreamStatus = "idle" | "calling" | "active"

export interface CallStreamState {
  status: CallStreamStatus
  phoneNumber: string | null
}

export type CallStreamSlot = {
  state: CallStreamState
  beginLocalCalling: (phoneNumber: string) => void
  cancelLocalCalling: () => void
} | null

// --- Outcome / cold call ---

export type OutcomeTone = "positive" | "neutral" | "negative"

// --- SMS templates ---

export interface SmsTemplate {
  id: string
  name: string
  body: string
  createdAt: string
  updatedAt: string
}

export type TemplateVariable = "firstName"

// --- Mobile-only types ---

// Returned by POST /my-sourcing-jobs.
export interface MobileJob {
  id: number
  name: string
  company: string
}

// One entry in the POST /job-pipeline response. The middleware filters out
// candidates without a usable LinkedIn URL and normalizes the URL to the
// canonical /in/<slug> form, so the PWA can pass `linkedinUrl` straight
// to /candidate-details.
export interface PipelineCandidate {
  rfId: number
  linkedinUrl: string
}
