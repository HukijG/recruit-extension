import type { DialpadUserContext } from "~lib/dialpad"

// --- Sync flow types ---

export type WorkflowState =
  | "not_on_pipeline"
  | "no_selection"
  | "profiles_selected"
  | "loading"
  | "ready"
  | "csv_matched"
  | "sending"
  | "complete"
  | "adding_to_job"
  | "job_added"

export type MatchStatus = "matched" | "warning" | "error"

export interface PageInfo {
  isPipelinePage: boolean
  totalOnPage: number
  checkedCount: number
}

export interface ExperienceEntry {
  title: string
  company: string
  startYear: number | null
  endYear: number | null
  isCurrent: boolean
}

export interface EducationEntry {
  institution: string
  degree: string
  startYear: number | null
  endYear: number | null
}

export interface Candidate {
  fullName: string
  internalTalentUrl: string
  headline: string
  location: string
  industry: string
  photoUrl: string
  connectionDegree: number | null
  pipelineStatus: string
  experience: ExperienceEntry[]
  totalExperienceCount: number
  education: EducationEntry[]
}

export interface CsvRow {
  firstName: string
  lastName: string
  currentCompany: string
  profileUrl: string
}

export interface MatchedCandidate {
  candidate: Candidate
  csv: CsvRow
  status: MatchStatus
  normalizedCandidate: string
  normalizedCsv: string
  checked: boolean
}

export interface CandidatePayload {
  linkedinUrl: string
  internalTalentUrl: string
  fullName: string
  headline: string
  location: string
  industry: string
  photoUrl: string
  connectionDegree: number | null
  pipelineStatus: string
  experience: ExperienceEntry[]
  totalExperienceCount: number
  education: EducationEntry[]
}

export interface CandidateResult {
  fullName: string
  status: "created" | "updated" | "skipped" | "error"
  rfId?: number
  reason?: string
  dialpadSynced?: boolean
  phoneRequested?: boolean
}

export interface RFJob {
  id: number
  name: string
  company: string
}

export interface SendCandidatesResponse {
  total: number
  created: number
  updated: number
  skipped: number
  errors: number
  results: CandidateResult[]
  jobs: RFJob[]
}

export interface AddToJobResponse {
  jobId: number
  added: number
  alreadyInJob: number
  errors: number
  results: { rfId: number; status: string; reason?: string }[]
}

// --- Candidate flow types ---

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
  | { phase: "ready"; urlId: string; details: CandidateDetails; markInvalid: MarkInvalidState }
  | { phase: "error"; urlId: string; message: string }

// --- Calling / caller-id types ---

// Per-call caller-ID alias the user picked from the dropdown. The middleware
// decodes it back to an E.164 number when initiating the call. Production
// candidate-mode renders without a Provider, so CallButton reads `{}` and
// the middleware falls back to the user's Dialpad default caller ID.
//
// There's no device picker — Dialpad's `initiate_call` endpoint doesn't
// accept a device_id; it just rings every eligible device and the user
// picks up wherever they are.
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

// Optional "open the text composer" slot — only injected by views that want
// the candidate-mode UI to expose a Text action button (currently test_call).
// Production candidate mode reads `null` and renders only Call + Number
// Invalid.
export type TextSlot = {
  onOpen: () => void
} | null

// --- Live call-state polling ---

// Three local UX states. The worker only reports two wire states
// (`in_progress` / `ended`) over POST /extension-call-status; the hook
// translates those to transitions across these three. `idle` renders Call;
// `calling` renders Calling… (disabled); `active` renders the red Hangup.
export type CallStreamStatus = "idle" | "calling" | "active"

export interface CallStreamState {
  status: CallStreamStatus
  // Candidate's E.164 number stamped locally when /dialpad-call fires. The
  // polling response intentionally doesn't include the dialed number — we
  // already know it. Used by per-candidate views to phone-match and gate
  // Calling…/Hangup affordances to the right profile.
  phoneNumber: string | null
}

// Hook-shaped slot exposed via context so any view can read live state and
// preempt with a local "calling" intent the moment /dialpad-call fires —
// before polling confirms `active`. The candidate's own phone number is
// required when starting a local call so the per-candidate UI can
// phone-match against state.phoneNumber and avoid showing Hangup/Calling on
// a different candidate's profile.
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
