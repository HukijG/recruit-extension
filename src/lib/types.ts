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

export type OutcomeTone = "positive" | "neutral" | "negative" | "cancelled"

// --- SMS templates ---

export interface SmsTemplate {
  id: string
  name: string
  body: string
  createdAt: string
  updatedAt: string
}

export type TemplateVariable = "firstName"

// --- Music remote (now-playing bar) ---
//
// FROZEN CROSS-REPO CONTRACT (byte-identical in the extension, worker, and
// dashboard repos). These camelCase shapes mirror the NowPlayingSnapshot the
// Durable Object streams over the worker's WS route. Do NOT diverge from the
// worker's JSON — if the contract has to change, it changes in all three
// repos at once.

export interface NowPlayingTrack {
  // u64 on the dashboard wire (relay protocol `load_id`), serialised as a JSON
  // NUMBER — the CHANGE KEY for a new-track reset. useInterpolatedPosition
  // re-anchors on each snapshot's positionMs directly (a new track arrives with
  // a fresh loadId and positionMs ~0, which hard-resets the fill), so it isn't
  // compared by hand here; kept as the raw number for a clean wire-identity
  // match rather than a coerced string.
  loadId: number
  title: string
  // The dashboard's TrackMetadata carries `artists: Vec<String>` (a JSON
  // array). parseSnapshot joins it to a single display string at the edge;
  // the bar renders one comma-separated line, so the stored shape is a string.
  artists: string
  album: string
  // `art_url: Option<String>` on the wire — serde emits `null` when a track
  // has no cover. Normalised to "" at parse time; the bar branches on falsy
  // artUrl to show its empty-art fallback, so a missing cover must NOT drop
  // the frame.
  artUrl: string
  durationMs: number
}

export interface NowPlayingSnapshot {
  isPlaying: boolean
  positionMs: number
  track: NowPlayingTrack | null
}

// Connection lifecycle for the side-panel DO socket. `idle` is the pre-open
// state (no candidate mode yet / handshake not started); `connecting` covers
// the open + initial-snapshot wait; `open` means a snapshot has streamed;
// `closed` is a clean/expected close; `error` is a failed handshake or drop
// awaiting backoff reconnect.
export type MusicWsStatus = "idle" | "connecting" | "open" | "closed" | "error"

// A single Deezer search hit. The id is the canonical Deezer track id, held
// here as a STRING for stable React-key identity and tolerant parsing (the
// search/contents wire may emit it as a JSON number or string — parseSongs
// normalises either to a string). This is purely the in-extension carrier
// shape; it is NOT the action wire shape.
//
// WIRE (frozen contract): "Deezer ids numeric; song actions mirror {id}
// payloads." Song actions (enqueue / play) therefore post a JSON NUMBER —
// coerceTrackId narrows this string back to a number in the musicPlay /
// musicEnqueue handlers so `songs::{play,enqueue}` (serde `id: u64`) accept it.
export interface MusicSongResult {
  id: string
  title: string
  artists: string
  album: string
  // Normalised to "" when the wire cover is null — the row branches on falsy
  // artUrl to render its empty-art placeholder.
  artUrl: string
  durationMs: number
}

// A single playlist search hit. The id is held as a string for the same
// identity/parsing reason as song ids above; the playlist-play action posts the
// NUMERIC `{ id }` the frozen contract specifies (coerced in musicPlaylistPlay,
// matching `playlists::play`'s serde `id: u64`).
export interface MusicPlaylistResult {
  id: string
  title: string
  creator: string
  artUrl: string
  trackCount: number
}

// Cross-mode slot for the now-playing bar. The bar lives as base-page chrome
// (mounted by sidepanel like global CSS), so the slot carries DATA ONLY — the
// live snapshot, the connection status, and whether the bar is currently
// suppressed by an overlay above it. The bar owns all of its own UI; nothing
// here threads callbacks, mirroring how the data-only call-stream slot is
// shaped (state in, behaviour owned by the consumer).
export type MusicRemoteSlot = {
  snapshot: NowPlayingSnapshot | null
  status: MusicWsStatus
  // True while a higher overlay (settings, text composer, template manager,
  // job modal) covers the panel. The bar reads this to suppress its chrome
  // and release its reserved height; it does NOT use it to close its own
  // search overlay (overlay open/closed is the bar's own source of truth so
  // an incidental blur can never destroy a half-typed query).
  suppressed: boolean
} | null
