import { sendToBackground } from "@plasmohq/messaging"
import { useStorage } from "@plasmohq/storage/hook"
import { useContext, useEffect, useMemo, useRef, useState } from "react"

import { Select } from "~components/select"
import { TextButton } from "~components/text-popover"
import { styles as syncStyles } from "~components/sync"
import { COLD_CALL_TYPE, localStore } from "~lib/constants"
import {
  CallConfigContext,
  CallerIdPickerContext,
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

function CallIcon() {
  return (
    <svg
      className="lr-call-icon"
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true">
      <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
    </svg>
  )
}

function CallButton({ phoneNumber }: { phoneNumber: string | null }) {
  const callConfig = useContext(CallConfigContext)
  const [extensionSecret] = useStorage<string>(
    { key: "extensionSecret", instance: localStore },
    ""
  )
  const [callState, setCallState] = useState<"idle" | "calling" | "ringing" | "error">("idle")
  const resetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    return () => {
      if (resetTimerRef.current) clearTimeout(resetTimerRef.current)
    }
  }, [])

  if (!phoneNumber) {
    return (
      <button type="button" disabled className="lr-call-btn" aria-label="Call (no phone on file)">
        <CallIcon />
        Call
      </button>
    )
  }

  const scheduleReset = (ms: number) => {
    if (resetTimerRef.current) clearTimeout(resetTimerRef.current)
    resetTimerRef.current = setTimeout(() => setCallState("idle"), ms)
  }

  const handleClick = async () => {
    if (callState === "calling") return
    setCallState("calling")

    type CallResp = { ok: boolean; error?: string }
    const resp = await sendToBackground<unknown, CallResp>({
      name: "initiateDialpadCall",
      body: {
        phoneNumber,
        callerAliasId: callConfig.callerAliasId,
        secret: extensionSecret
      }
    }).catch(
      (err): CallResp => ({
        ok: false,
        error: err?.message ?? "Network error"
      })
    )

    if (resp?.ok) {
      setCallState("ringing")
      scheduleReset(2500)
      return
    }

    console.warn("[CallButton] initiateDialpadCall failed:", resp?.error)
    setCallState("error")
    scheduleReset(4000)
  }

  const label =
    callState === "calling"
      ? "Calling…"
      : callState === "ringing"
        ? "Ringing"
        : callState === "error"
          ? "Failed — retry"
          : "Call"

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={callState === "calling"}
      className="lr-call-btn"
      aria-label={`Call ${phoneNumber}`}>
      <CallIcon />
      {label}
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
