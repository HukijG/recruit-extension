import { sendToBackground } from "@plasmohq/messaging"
import { useStorage } from "@plasmohq/storage/hook"
import { useContext, useEffect, useMemo, useState } from "react"

import { Select } from "~components/select"
import { TextButton } from "~components/text-popover"
import { styles as syncStyles } from "~components/sync"
import { COLD_CALL_TYPE, localStore } from "~lib/constants"
import {
  CallConfigContext,
  CallerIdPickerContext,
  CallStatsRefreshContext,
  CallStreamContext,
  TextSlotContext
} from "~lib/contexts"
import {
  formatActivityDate,
  formatCallerOption,
  formatOutcome,
  formatPhoneDisplay,
  outcomeDotColor,
  outcomeTextColor,
  stageChipStyle
} from "~lib/formatters"
import type {
  CandidateActivity,
  CandidateJob,
  CandidateState,
  MarkInvalidState,
  OutcomeTone,
  UserContextState
} from "~lib/types"

// --- Candidate View ---

export function CandidateView({
  state,
  onRetry,
  onArmMarkInvalid,
  onUndoMarkInvalid,
  onRetryMarkInvalid
}: {
  state: CandidateState
  onRetry: () => void
  onArmMarkInvalid: () => void
  onUndoMarkInvalid: () => void
  onRetryMarkInvalid: () => void
}) {
  const pickerSlot = useContext(CallerIdPickerContext)
  const textSlot = useContext(TextSlotContext)

  if (state.phase === "idle" || state.phase === "loading") {
    return (
      <div style={syncStyles.statusCentered}>
        <div style={syncStyles.spinner} />
        <p style={syncStyles.statusText}>Loading candidate…</p>
      </div>
    )
  }

  if (state.phase === "error") {
    return (
      <div style={syncStyles.statusCentered}>
        <div style={syncStyles.statusIcon}>
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#e74c3c" strokeWidth="1.5">
            <circle cx="12" cy="12" r="10" />
            <path d="M12 8v4M12 16h.01" strokeLinecap="round" />
          </svg>
        </div>
        <p style={syncStyles.statusText}>Failed to load candidate</p>
        <p style={syncStyles.statusSubtext}>{state.message}</p>
        <button onClick={onRetry} style={{ ...syncStyles.syncButton, marginTop: "12px" }}>
          Retry
        </button>
      </div>
    )
  }

  // phase === "ready"
  return (
    <div style={candidateStyles.container}>
      <CandidateJobBox job={state.details.job} />
      <header style={candidateStyles.identityCard}>
        <h2 style={candidateStyles.candidateName}>{state.details.fullName}</h2>
        <PhoneNumberLabel phoneNumber={state.details.phoneNumber} />
        {pickerSlot && (
          <div style={candidateStyles.identityPickerWrap}>
            <InlineCallerIdPicker {...pickerSlot} />
          </div>
        )}
        {textSlot ? (
          <>
            <div style={candidateStyles.actionRow}>
              <CallButton phoneNumber={state.details.phoneNumber} />
              <TextButton
                phoneNumber={state.details.phoneNumber}
                onClick={textSlot.onOpen}
              />
            </div>
            <div style={candidateStyles.actionRow}>
              <NumberInvalidButton
                rfId={state.details.rfId}
                phoneNumber={state.details.phoneNumber}
                state={state.markInvalid}
                onArm={onArmMarkInvalid}
                onUndo={onUndoMarkInvalid}
                onRetry={onRetryMarkInvalid}
              />
            </div>
          </>
        ) : (
          <div style={candidateStyles.actionRow}>
            <CallButton phoneNumber={state.details.phoneNumber} />
            <NumberInvalidButton
              rfId={state.details.rfId}
              phoneNumber={state.details.phoneNumber}
              state={state.markInvalid}
              onArm={onArmMarkInvalid}
              onUndo={onUndoMarkInvalid}
              onRetry={onRetryMarkInvalid}
            />
          </div>
        )}
      </header>
      <CandidateColdCallList activities={state.details.activities} />
    </div>
  )
}

function PhoneNumberLabel({ phoneNumber }: { phoneNumber: string | null }) {
  if (!phoneNumber) {
    return <p style={candidateStyles.phoneNumberMissing}>No phone on file</p>
  }
  return (
    <p style={candidateStyles.phoneNumber}>{formatPhoneDisplay(phoneNumber)}</p>
  )
}

// Receiver path used by both Call (upright) and Hangup (rotated). Spans
// roughly (4,2)→(22,22) inside its 24×24 viewBox, so a naive 135° rotation
// pushes the corners outside the frame and the icon visually competes with
// "Hangup"'s 6-character label. We render at 14×14 (matching Call) and
// shrink the path to 0.85 around the centre before rotating, so the rotated
// receiver fits inside its render area without cropping.
const RECEIVER_PATH =
  "M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"

function CallIcon() {
  return (
    <svg
      className="lr-call-icon"
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true">
      <path d={RECEIVER_PATH} />
    </svg>
  )
}

function HangupIcon() {
  return (
    <svg
      className="lr-call-icon"
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true">
      {/* Receiver rotated 135° — the conventional hangup glyph. The inner
          group scales the path to 0.85 around (12,12) before the outer
          rotation so the diagonal extents stay inside the viewBox. */}
      <g transform="rotate(135 12 12)">
        <g transform="translate(12 12) scale(0.85) translate(-12 -12)">
          <path d={RECEIVER_PATH} />
        </g>
      </g>
    </svg>
  )
}

type CallRespEnvelope = {
  ok: boolean
  error?: string
  reason?: "duplicate" | "rate_limit"
  retryAfterSec?: number
}

type HangupRespEnvelope = {
  ok: boolean
  error?: string
  status?: number
}

// E.164-ish equality: strip everything except digits and a leading +.
// Recruiterflow and the middleware both produce E.164, but defensive
// normalization protects against drift (spaces, parens, dashes).
function samePhone(a: string | null, b: string | null): boolean {
  if (!a || !b) return false
  const norm = (s: string) => s.replace(/[^\d+]/g, "")
  return norm(a) === norm(b)
}

function CallButton({ phoneNumber }: { phoneNumber: string | null }) {
  const callConfig = useContext(CallConfigContext)
  const callStream = useContext(CallStreamContext)
  const callStatsRefresh = useContext(CallStatsRefreshContext)
  const [extensionSecret] = useStorage<string>(
    { key: "extensionSecret", instance: localStore },
    ""
  )

  // Local overlays — kept narrow so candidate switches (which remount this
  // component via CandidateView's phase transitions) wipe the slate. By
  // request: no "retry" labels, no error flashes; failures revert silently
  // to the default Call surface.
  const [rateLimit, setRateLimit] = useState<{
    resumeAt: number
    message: string
  } | null>(null)
  const [hangupPending, setHangupPending] = useState(false)
  const [, setTick] = useState(0)

  // Drives the rate-limited countdown. Re-renders ~every 250ms so the visible
  // "Try again in Xs" label decrements; auto-flips off when the window
  // elapses.
  useEffect(() => {
    if (!rateLimit) return
    const id = setInterval(() => {
      if (Date.now() >= rateLimit.resumeAt) {
        setRateLimit(null)
      } else {
        setTick((t) => t + 1)
      }
    }, 250)
    return () => clearInterval(id)
  }, [rateLimit])

  const status = callStream?.state.status ?? "idle"
  // Phone-match gates the Calling…/Hangup affordances to THIS candidate's
  // page. If the active call is for a different candidate, this view shows
  // plain Call — never inherits another candidate's call UI.
  const isThisCandidatesCall = samePhone(
    callStream?.state.phoneNumber ?? null,
    phoneNumber
  )

  const handleCallClick = async () => {
    if (!phoneNumber) return
    callStream?.beginLocalCalling(phoneNumber)

    const resp = await sendToBackground<unknown, CallRespEnvelope>({
      name: "initiateDialpadCall",
      body: {
        phoneNumber,
        callerAliasId: callConfig.callerAliasId,
        secret: extensionSecret
      }
    }).catch(
      (err): CallRespEnvelope => ({
        ok: false,
        error: err?.message ?? "Network error"
      })
    )

    if (resp?.ok) {
      // 200 means the worker accepted the call and is discovering the call_id
      // via Dialpad's call-list. Polling flips us to `active` on the first
      // `in_progress` response; the hook's 10s watchdog reverts silently to
      // idle if discovery never lands (errors, no-active-call responses, or
      // just silence) so the user can retry.
      // Tick the daily-calls badge: the worker increments on call accept,
      // so an immediate refresh shows the new count without waiting for
      // the 10-min fallback timer.
      callStatsRefresh?.()
      return
    }

    callStream?.cancelLocalCalling()

    // Middleware enforces both a back-to-back dedup window (reason: "duplicate",
    // 1-3s) and a 5/min rolling rate limit (reason: "rate_limit", 1-60s). Both
    // surface as 429 with retryAfterSec; show the wait as a button-label
    // countdown so the user gets explicit feedback rather than a silent retry.
    if (resp?.reason === "duplicate" || resp?.reason === "rate_limit") {
      const sec = Math.max(1, resp.retryAfterSec ?? 30)
      setRateLimit({
        resumeAt: Date.now() + sec * 1000,
        message: resp.error ?? "Try again shortly"
      })
      return
    }

    // Other failures revert silently — user sees the button back to Call
    // and can try again. Logged for debugging; no user-facing retry label.
    console.warn("[CallButton] initiateDialpadCall failed:", resp?.error)
  }

  const handleHangupClick = async () => {
    if (hangupPending) return
    setHangupPending(true)

    const resp = await sendToBackground<unknown, HangupRespEnvelope>({
      name: "dialpadHangup",
      body: { secret: extensionSecret }
    }).catch(
      (err): HangupRespEnvelope => ({
        ok: false,
        error: err?.message ?? "Network error"
      })
    )

    setHangupPending(false)

    if (resp?.ok) {
      // Polling will deliver `ended` on the next tick once Dialpad's hangup
      // webhook lands (or the call-list reflects termination). No local
      // optimistic transition — keeps the state machine driven by one source.
      return
    }

    // 409 = "No active call" (the Calling… buffer should prevent this, but
    // races with very fast hangups can still show it). All other failures:
    // same silent revert. Polling will reconcile state on the next tick.
    console.warn("[CallButton] dialpadHangup failed:", resp?.error)
  }

  // --- Rendering ---

  // Active call belonging to this candidate → red Hangup. Active call to a
  // different candidate is invisible from this view's perspective: render as
  // plain Call so the consultant can dial this candidate normally.
  if (status === "active" && isThisCandidatesCall) {
    return (
      <button
        type="button"
        onClick={handleHangupClick}
        disabled={hangupPending}
        className="lr-call-btn lr-call-btn--hangup"
        aria-label="Hang up active call">
        <HangupIcon />
        {hangupPending ? "Hanging up…" : "Hangup"}
      </button>
    )
  }

  // 429 from /dialpad-call — user has to wait the full window before a new
  // call attempt can land. Per-component state, so it dies on candidate
  // switch (which is what we want — fresh button, fresh attempt).
  if (rateLimit) {
    const remaining = Math.max(
      0,
      Math.ceil((rateLimit.resumeAt - Date.now()) / 1000)
    )
    return (
      <button
        type="button"
        disabled
        className="lr-call-btn"
        title={rateLimit.message}
        aria-label={rateLimit.message}>
        <CallIcon />
        Try again in {remaining}s
      </button>
    )
  }

  if (status === "calling" && isThisCandidatesCall) {
    return (
      <button
        type="button"
        disabled
        className="lr-call-btn"
        aria-label="Calling — waiting for confirmation">
        <CallIcon />
        Calling…
      </button>
    )
  }

  if (!phoneNumber) {
    return (
      <button
        type="button"
        disabled
        className="lr-call-btn"
        aria-label="Call (no phone on file)">
        <CallIcon />
        Call
      </button>
    )
  }

  return (
    <button
      type="button"
      onClick={handleCallClick}
      className="lr-call-btn"
      aria-label={`Call ${phoneNumber}`}>
      <CallIcon />
      Call
    </button>
  )
}

function NumberInvalidButton({
  rfId,
  phoneNumber,
  state,
  onArm,
  onUndo,
  onRetry
}: {
  rfId: number
  phoneNumber: string | null
  state: MarkInvalidState
  onArm: () => void
  onUndo: () => void
  onRetry: () => void
}) {
  const isDisabled = phoneNumber == null
  const isMarked =
    state.status === "armed" ||
    state.status === "submitting" ||
    state.status === "marked"

  if (state.status === "error") {
    return (
      <button
        type="button"
        onClick={onRetry}
        className="lr-invalid-btn lr-invalid-btn--error">
        Retry mark invalid
      </button>
    )
  }

  const className = isMarked
    ? "lr-invalid-btn lr-invalid-btn--marked"
    : "lr-invalid-btn"

  return (
    <button
      type="button"
      onClick={onArm}
      disabled={isDisabled || isMarked}
      className={className}>
      {isMarked ? "Marked invalid" : "Number Invalid"}
    </button>
  )
}

function CandidateJobBox({ job }: { job: CandidateJob | null }) {
  if (!job) {
    return (
      <div style={candidateStyles.jobBox}>
        <p style={candidateStyles.jobPlaceholder}>Not on any active job</p>
      </div>
    )
  }
  const stageStyle = stageChipStyle(job.stage)
  return (
    <div style={candidateStyles.jobBox}>
      <p style={candidateStyles.jobTitle}>{job.title}</p>
      {job.company && <p style={candidateStyles.jobCompany}>{job.company}</p>}
      <span style={{ ...candidateStyles.jobStageChip, ...stageStyle }}>
        <span style={{ ...candidateStyles.jobStageDot, backgroundColor: stageStyle.color }} />
        {job.stage}
      </span>
    </div>
  )
}

function CandidateColdCallList({ activities }: { activities: CandidateActivity[] }) {
  const coldCalls = useMemo(() => {
    return activities
      .filter((a) => a.type === COLD_CALL_TYPE)
      .slice()
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  }, [activities])

  const [expanded, setExpanded] = useState<Set<string | number>>(new Set())
  const [sectionExpanded, setSectionExpanded] = useState(false)

  const sectionTone: OutcomeTone | null = useMemo(() => {
    let hasPositive = false
    let hasNegative = false
    for (const c of coldCalls) {
      const tone = formatOutcome(c.outcome)?.tone
      if (tone === "positive") hasPositive = true
      else if (tone === "negative") hasNegative = true
    }
    if (hasPositive) return "positive"
    if (hasNegative) return "negative"
    return null
  }, [coldCalls])

  const toggle = (id: string | number) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  if (coldCalls.length === 0) {
    return (
      <div style={candidateStyles.coldCallSection}>
        <p style={candidateStyles.coldCallHeading}>Cold calls (0)</p>
        <p style={candidateStyles.coldCallEmpty}>No cold calls yet</p>
      </div>
    )
  }

  return (
    <div style={candidateStyles.coldCallSection}>
      <button
        type="button"
        className="lr-coldcall-section-toggle"
        style={candidateStyles.coldCallSectionToggle}
        onClick={() => setSectionExpanded((prev) => !prev)}
        aria-expanded={sectionExpanded}>
        <span style={candidateStyles.coldCallIconColumn} aria-hidden="true">
          <svg
            className="lr-coldcall-chevron"
            data-open={sectionExpanded}
            width="9"
            height="9"
            viewBox="0 0 9 9"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round">
            <polyline points="2.5 1.5 6 4.5 2.5 7.5" />
          </svg>
        </span>
        <span style={candidateStyles.coldCallSectionHeading}>
          Cold calls ({coldCalls.length})
        </span>
        {sectionTone && (
          <span
            style={{
              ...candidateStyles.coldCallSectionTone,
              color: outcomeTextColor(sectionTone)
            }}>
            Connected
          </span>
        )}
      </button>
      {sectionExpanded && coldCalls.map((c, i) => {
        const date = formatActivityDate(c.createdAt)
        const outcome = formatOutcome(c.outcome)
        const hasNotes = c.description.trim().length > 0
        const canExpand = hasNotes
        const isExpanded = expanded.has(c.id)
        return (
          <div
            key={c.id}
            className="lr-coldcall-row"
            data-expandable={canExpand}
            style={candidateStyles.coldCallRow}>
            <div
              style={{
                ...candidateStyles.coldCallHeader,
                cursor: canExpand ? "pointer" : "default"
              }}
              onClick={canExpand ? () => toggle(c.id) : undefined}
              role={canExpand ? "button" : undefined}
              aria-expanded={canExpand ? isExpanded : undefined}>
              <span style={candidateStyles.coldCallIconColumn} aria-hidden="true">
                {canExpand && (
                  <svg
                    className="lr-coldcall-chevron"
                    data-open={isExpanded}
                    width="9"
                    height="9"
                    viewBox="0 0 9 9"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.6"
                    strokeLinecap="round"
                    strokeLinejoin="round">
                    <polyline points="2.5 1.5 6 4.5 2.5 7.5" />
                  </svg>
                )}
              </span>
              <span style={candidateStyles.coldCallLabel}>Cold call {i + 1}</span>
              <span style={candidateStyles.coldCallDate}>{date}</span>
            </div>
            {outcome && (
              <div style={candidateStyles.coldCallOutcomeRow}>
                <span style={candidateStyles.coldCallIconColumn} aria-hidden="true">
                  <span
                    style={{
                      ...candidateStyles.coldCallOutcomeDot,
                      backgroundColor: outcomeDotColor(outcome.tone)
                    }}
                  />
                </span>
                <span
                  style={{
                    ...candidateStyles.coldCallOutcomeText,
                    color: outcomeTextColor(outcome.tone)
                  }}>
                  {outcome.label}
                </span>
              </div>
            )}
            {canExpand && isExpanded && (
              <p style={candidateStyles.coldCallDescription}>{c.description}</p>
            )}
          </div>
        )
      })}
    </div>
  )
}

export function InlineCallerIdPicker({
  state,
  selectedAliasId,
  onSelect
}: {
  state: UserContextState
  selectedAliasId: string
  onSelect: (aliasId: string) => void
}) {
  return (
    <div style={candidateStyles.pickerInline}>
      <span style={candidateStyles.pickerInlineLabel}>Outbound caller ID</span>
      {state.status === "loading" && (
        <div style={candidateStyles.pickerInlineLoading}>Loading caller IDs…</div>
      )}
      {state.status === "error" && (
        <div style={candidateStyles.pickerInlineError}>{state.message}</div>
      )}
      {state.status === "ready" && state.data.callerIds.length === 0 && (
        <div style={candidateStyles.pickerInlineError}>
          No caller IDs returned from the middleware.
        </div>
      )}
      {state.status === "ready" && state.data.callerIds.length > 0 && (
        <Select<string>
          value={selectedAliasId}
          onChange={onSelect}
          options={state.data.callerIds.map((c) => ({
            value: c.aliasId,
            label: formatCallerOption(c, state.data.callerIds)
          }))}
        />
      )}
    </div>
  )
}

export function UndoToast({
  message,
  onUndo
}: {
  message: string
  onUndo: () => void
}) {
  return (
    <div style={candidateStyles.toast}>
      <span style={candidateStyles.toastMessage}>{message}</span>
      <button onClick={onUndo} style={candidateStyles.toastUndo}>
        Undo
      </button>
    </div>
  )
}

export function ErrorToast({ message }: { message: string }) {
  return (
    <div style={candidateStyles.toastError}>
      <span style={candidateStyles.toastMessage}>{message}</span>
    </div>
  )
}

const candidateStyles: Record<string, React.CSSProperties> = {
  container: {
    width: "100%",
    display: "flex",
    flexDirection: "column",
    gap: "12px"
  },
  identityCard: {
    width: "100%",
    display: "flex",
    flexDirection: "column",
    alignItems: "stretch",
    gap: "6px",
    padding: "16px 14px 14px",
    backgroundColor: "#ffffff",
    border: "1px solid #e3e6ea",
    borderRadius: "12px",
    boxShadow: "0 1px 2px rgba(15,23,42,0.04)",
    margin: "2px 0px 10px 0px"
  },
  candidateName: {
    margin: 0,
    fontSize: "20px",
    lineHeight: 1.2,
    fontWeight: 700,
    color: "#15171a",
    textAlign: "center",
    letterSpacing: "-0.01em"
  },
  phoneNumber: {
    margin: 0,
    fontSize: "15px",
    fontWeight: 500,
    color: "#15171a",
    textAlign: "center",
    fontVariantNumeric: "tabular-nums",
    letterSpacing: "0.01em"
  },
  phoneNumberMissing: {
    margin: 0,
    fontSize: "15px",
    color: "#80868b",
    textAlign: "center",
    fontStyle: "italic"
  },
  actionRow: {
    display: "flex",
    flexDirection: "row",
    alignItems: "stretch",
    gap: "8px",
    marginTop: "4px"
  },
  identityPickerWrap: {
    marginTop: "10px",
    marginBottom: "12px"
  },
  pickerInline: {
    display: "flex",
    flexDirection: "column",
    gap: "5px"
  },
  pickerInlineLabel: {
    fontSize: "12px",
    fontWeight: 700,
    letterSpacing: "0.04em",
    color: "#3c4043",
    textTransform: "uppercase",
    textAlign: "left"
  },
  pickerInlineLoading: {
    fontSize: "12px",
    color: "#80868b",
    fontStyle: "italic",
    textAlign: "center",
    padding: "4px 0"
  },
  pickerInlineError: {
    fontSize: "12px",
    color: "#b8302a",
    backgroundColor: "#fdecea",
    border: "1px solid #f6c2bd",
    borderRadius: "6px",
    padding: "6px 8px",
    lineHeight: 1.4
  },
  jobBox: {
    width: "100%",
    padding: "14px 14px",
    backgroundColor: "#ffffff",
    borderRadius: "12px",
    border: "1px solid #e3e6ea",
    display: "flex",
    flexDirection: "column",
    gap: "2px",
    boxShadow: "0 1px 2px rgba(15,23,42,0.04)",
    alignItems: "center",
    margin: "4px 0px"
  },
  jobTitle: {
    margin: 0,
    fontSize: "18px",
    fontWeight: 600,
    color: "#08090a",
    lineHeight: 1.3
  },
  jobCompany: {
    margin: 0,
    fontSize: "16px",
    color: "#2e3133"
  },
  jobStageChip: {
    alignSelf: "center",
    display: "inline-flex",
    alignItems: "center",
    gap: "8px",
    fontSize: "12px",
    padding: "4px 10px",
    borderRadius: "999px",
    fontWeight: 600,
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: "transparent",
    marginTop: "10px"
  },
  jobStageDot: {
    width: "6px",
    height: "6px",
    borderRadius: "50%"
  },
  jobPlaceholder: {
    margin: 0,
    fontSize: "13px",
    color: "#80868b",
    fontStyle: "italic"
  },
  coldCallSection: {
    width: "100%",
    display: "flex",
    flexDirection: "column",
    gap: "8px"
  },
  coldCallHeading: {
    margin: "0 0 2px 0",
    fontSize: "13px",
    fontWeight: 700,
    color: "#15171a",
    textTransform: "uppercase",
    letterSpacing: "0.6px"
  },
  coldCallSectionToggle: {
    appearance: "none",
    background: "transparent",
    border: "none",
    padding: "2px 0",
    margin: 0,
    width: "100%",
    display: "flex",
    alignItems: "center",
    gap: "8px",
    cursor: "pointer",
    textAlign: "left",
    color: "#15171a"
  },
  coldCallSectionHeading: {
    margin: 0,
    flex: 1,
    minWidth: 0,
    fontSize: "13px",
    fontWeight: 700,
    color: "#15171a",
    textTransform: "uppercase",
    letterSpacing: "0.6px"
  },
  coldCallSectionTone: {
    fontSize: "13px",
    fontWeight: 600,
    flexShrink: 0
  },
  coldCallEmpty: {
    margin: 0,
    fontSize: "13px",
    color: "#80868b",
    fontStyle: "italic"
  },
  coldCallRow: {
    padding: "10px 12px",
    backgroundColor: "#ffffff",
    borderRadius: "10px",
    border: "1px solid #e3e6ea",
    display: "flex",
    flexDirection: "column",
    gap: "6px"
  },
  coldCallHeader: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    fontSize: "15px",
    color: "#15171a",
    fontWeight: 600,
    lineHeight: 1.3
  },
  coldCallIconColumn: {
    width: "12px",
    flexShrink: 0,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    color: "#5f6368"
  },
  coldCallLabel: {
    flex: 1,
    minWidth: 0
  },
  coldCallDate: {
    fontSize: "13px",
    color: "#5f6368",
    fontWeight: 500,
    fontVariantNumeric: "tabular-nums",
    flexShrink: 0
  },
  coldCallOutcomeRow: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    lineHeight: 1.3
  },
  coldCallOutcomeDot: {
    width: "7px",
    height: "7px",
    borderRadius: "50%",
    display: "block"
  },
  coldCallOutcomeText: {
    fontSize: "13px",
    fontWeight: 600
  },
  coldCallDescription: {
    margin: 0,
    paddingTop: "6px",
    borderTop: "1px solid #eef0f2",
    fontSize: "13px",
    color: "#3c4043",
    lineHeight: 1.5,
    whiteSpace: "pre-wrap",
    wordBreak: "break-word"
  },
  toast: {
    position: "fixed",
    // Ride above the now-playing music bar when it's present; the bar writes
    // its height to --lr-music-bar-height (0px when absent), so this keeps a
    // constant 16px gap above either the bar or the panel bottom.
    bottom: "calc(16px + var(--lr-music-bar-height, 0px))",
    left: "16px",
    right: "16px",
    padding: "10px 14px",
    backgroundColor: "#333",
    color: "#fff",
    borderRadius: "8px",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "12px",
    fontSize: "13px",
    boxShadow: "0 4px 12px rgba(0,0,0,0.2)",
    zIndex: 100
  },
  toastError: {
    position: "fixed",
    // See `toast` above — keep error toasts above the music bar too.
    bottom: "calc(16px + var(--lr-music-bar-height, 0px))",
    left: "16px",
    right: "16px",
    padding: "10px 14px",
    backgroundColor: "#e74c3c",
    color: "#fff",
    borderRadius: "8px",
    fontSize: "13px",
    boxShadow: "0 4px 12px rgba(0,0,0,0.2)",
    zIndex: 100
  },
  toastMessage: {
    flex: 1
  },
  toastUndo: {
    background: "transparent",
    border: "1px solid #fff",
    color: "#fff",
    padding: "4px 10px",
    borderRadius: "12px",
    fontSize: "12px",
    fontWeight: 500,
    cursor: "pointer"
  }
}
