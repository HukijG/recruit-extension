import { useContext, useEffect, useMemo, useState } from "react"

import { Select } from "~/components/select"
import { TextButton } from "~/components/text-popover"
import { initiateDialpadCall, dialpadHangup } from "~/lib/api"
import { COLD_CALL_TYPE } from "~/lib/constants"
import {
  CallConfigContext,
  CallerIdPickerContext,
  CallStreamContext,
  TextSlotContext
} from "~/lib/contexts"
import {
  formatActivityDate,
  formatCallerOption,
  formatOutcome,
  formatPhoneDisplay,
  outcomeDotColor,
  outcomeTextColor,
  stageChipStyle
} from "~/lib/formatters"
import { useStorage } from "~/lib/storage"
import type {
  CandidateActivity,
  CandidateJob,
  CandidateState,
  MarkInvalidState,
  OutcomeTone,
  UserContextState
} from "~/lib/types"

// Candidate view ported from the extension. Logic is unchanged; the only
// edits replace the Plasmo background-message API with direct middleware
// fetch (api.ts) and the Plasmo storage hook with the localStorage hook.

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
      <div style={statusStyles.statusCentered}>
        <div style={statusStyles.spinner} />
        <p style={statusStyles.statusText}>Loading candidate…</p>
      </div>
    )
  }

  if (state.phase === "error") {
    return (
      <div style={statusStyles.statusCentered}>
        <div style={statusStyles.statusIcon}>
          <svg
            width="32"
            height="32"
            viewBox="0 0 24 24"
            fill="none"
            stroke="#e74c3c"
            strokeWidth="1.5">
            <circle cx="12" cy="12" r="10" />
            <path d="M12 8v4M12 16h.01" strokeLinecap="round" />
          </svg>
        </div>
        <p style={statusStyles.statusText}>Failed to load candidate</p>
        <p style={statusStyles.statusSubtext}>{state.message}</p>
        <button
          onClick={onRetry}
          style={{ ...statusStyles.primaryButton, marginTop: "12px" }}>
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
      <g transform="rotate(135 12 12)">
        <g transform="translate(12 12) scale(0.85) translate(-12 -12)">
          <path d={RECEIVER_PATH} />
        </g>
      </g>
    </svg>
  )
}

function samePhone(a: string | null, b: string | null): boolean {
  if (!a || !b) return false
  const norm = (s: string) => s.replace(/[^\d+]/g, "")
  return norm(a) === norm(b)
}

function CallButton({ phoneNumber }: { phoneNumber: string | null }) {
  const callConfig = useContext(CallConfigContext)
  const callStream = useContext(CallStreamContext)
  const [extensionSecret] = useStorage<string>("extensionSecret", "")

  const [rateLimit, setRateLimit] = useState<{
    resumeAt: number
    message: string
  } | null>(null)
  const [hangupPending, setHangupPending] = useState(false)
  const [, setTick] = useState(0)

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
  const isThisCandidatesCall = samePhone(
    callStream?.state.phoneNumber ?? null,
    phoneNumber
  )

  const handleCallClick = async () => {
    if (!phoneNumber) return
    callStream?.beginLocalCalling(phoneNumber)

    const resp = await initiateDialpadCall({
      phoneNumber,
      callerAliasId: callConfig.callerAliasId,
      secret: extensionSecret
    })

    if (resp.ok) {
      // 200 means the worker accepted the call. Polling flips us to `active`
      // on the first `in_progress` response. No watchdog — the button stays
      // grey indefinitely while we wait, by request. Stuck-grey is preferable
      // to silently reverting while a real call connects in the background.
      return
    }

    callStream?.cancelLocalCalling()

    if (resp.reason === "duplicate" || resp.reason === "rate_limit") {
      const sec = Math.max(1, resp.retryAfterSec ?? 30)
      setRateLimit({
        resumeAt: Date.now() + sec * 1000,
        message: resp.error
      })
      return
    }

    console.warn("[CallButton] initiateDialpadCall failed:", resp.error)
  }

  const handleHangupClick = async () => {
    if (hangupPending) return
    setHangupPending(true)

    const resp = await dialpadHangup({ secret: extensionSecret })

    setHangupPending(false)

    if (resp.ok) return
    console.warn("[CallButton] dialpadHangup failed:", resp.error)
  }

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
  phoneNumber,
  state,
  onArm,
  onUndo: _onUndo,
  onRetry
}: {
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
        <span
          style={{
            ...candidateStyles.jobStageDot,
            backgroundColor: stageStyle.color
          }}
        />
        {job.stage}
      </span>
    </div>
  )
}

function CandidateColdCallList({
  activities
}: {
  activities: CandidateActivity[]
}) {
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
      {sectionExpanded &&
        coldCalls.map((c, i) => {
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
                <span
                  style={candidateStyles.coldCallIconColumn}
                  aria-hidden="true">
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
                <span style={candidateStyles.coldCallLabel}>
                  Cold call {i + 1}
                </span>
                <span style={candidateStyles.coldCallDate}>{date}</span>
              </div>
              {outcome && (
                <div style={candidateStyles.coldCallOutcomeRow}>
                  <span
                    style={candidateStyles.coldCallIconColumn}
                    aria-hidden="true">
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
                <p style={candidateStyles.coldCallDescription}>
                  {c.description}
                </p>
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
        <div style={candidateStyles.pickerInlineLoading}>
          Loading caller IDs…
        </div>
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

const statusStyles: Record<string, React.CSSProperties> = {
  statusCentered: {
    width: "100%",
    minHeight: "240px",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: "10px",
    padding: "24px 16px",
    textAlign: "center"
  },
  spinner: {
    width: "26px",
    height: "26px",
    border: "3px solid #e3e6ea",
    borderTopColor: "#0a66c2",
    borderRadius: "50%",
    animation: "spin 800ms linear infinite"
  },
  statusIcon: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center"
  },
  statusText: {
    margin: 0,
    fontSize: "15px",
    fontWeight: 600,
    color: "#15171a"
  },
  statusSubtext: {
    margin: 0,
    fontSize: "13px",
    fontWeight: 500,
    color: "#5f6368",
    maxWidth: "320px",
    lineHeight: 1.4
  },
  primaryButton: {
    padding: "11px 18px",
    backgroundColor: "#0a66c2",
    color: "#ffffff",
    border: "1px solid #0a66c2",
    borderRadius: "999px",
    fontSize: "14px",
    fontWeight: 600,
    cursor: "pointer"
  }
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
    bottom: "16px",
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
    bottom: "16px",
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
