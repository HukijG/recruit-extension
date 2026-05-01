import { sendToBackground } from "@plasmohq/messaging"
import { useStorage } from "@plasmohq/storage/hook"
import { useEffect, useMemo, useState } from "react"

import { COLD_CALL_TYPE, localStore } from "~lib/constants"
import {
  CallConfigContext,
  CallerIdPickerContext,
  TextSlotContext
} from "~lib/contexts"
import type { DialpadUserContext } from "~lib/dialpad"
import type {
  CallConfig,
  CandidateDetails,
  CandidateState,
  UserContextState
} from "~lib/types"

import { CandidateView } from "./candidate"
import { TextPopover } from "./text-popover"

// --- Test Call View ---
//
// Dev-only mockup of the candidate-mode UI: same layout, hardcoded mock data,
// phone number wired to the developer's personal mobile so the Dialpad API
// can be exercised end-to-end without dialing real candidates.

const TEST_CANDIDATE_DETAILS: CandidateDetails = {
  rfId: -1,
  fullName: "Test Candidate",
  phoneNumber: "+447700900123",
  job: {
    title: "Senior Software Engineer",
    company: "Acme Test Co.",
    stage: "Replied"
  },
  activities: [
    {
      id: "test-cc-1",
      type: COLD_CALL_TYPE,
      name: "Cold call 1",
      description: "Test note: candidate sounded interested.\nFollow up next week.",
      createdAt: "2026-04-26T14:23:00Z",
      outcome: "voicemail"
    },
    {
      id: "test-cc-2",
      type: COLD_CALL_TYPE,
      name: "Cold call 2",
      description: "",
      createdAt: "2026-04-29T09:15:00Z",
      outcome: "connected"
    }
  ]
}

export function TestCallView({ onExit }: { onExit: () => void }) {
  const [extensionSecret] = useStorage<string>(
    { key: "extensionSecret", instance: localStore },
    ""
  )
  const [contextState, setContextState] = useState<UserContextState>({ status: "loading" })
  const [selectedCallerAliasId, setSelectedCallerAliasId] = useState<string>("")
  const [textPopoverOpen, setTextPopoverOpen] = useState(false)

  // Stable slot reference so child renders don't churn on unrelated re-renders.
  const textSlot = useMemo(
    () => ({ onOpen: () => setTextPopoverOpen(true) }),
    []
  )

  useEffect(() => {
    let cancelled = false

    type CtxResp = {
      ok: boolean
      data?: DialpadUserContext
      error?: string
    }

    sendToBackground<unknown, CtxResp>({
      name: "getDialpadUserContext",
      body: { secret: extensionSecret }
    })
      .then((resp) => {
        if (cancelled) return
        if (resp?.ok && resp.data) {
          setContextState({ status: "ready", data: resp.data })
          const defaultCaller =
            resp.data.callerIds.find((c) => c.isDefault) ?? resp.data.callerIds[0]
          if (defaultCaller) setSelectedCallerAliasId(defaultCaller.aliasId)
        } else {
          setContextState({
            status: "error",
            message: resp?.error ?? "Failed to load Dialpad context"
          })
        }
      })
      .catch((err) => {
        if (cancelled) return
        setContextState({
          status: "error",
          message: err?.message ?? "Failed to load Dialpad context"
        })
      })

    return () => {
      cancelled = true
    }
  }, [extensionSecret])

  const candidateState: CandidateState = {
    phase: "ready",
    urlId: "test-mock",
    details: TEST_CANDIDATE_DETAILS,
    markInvalid: { status: "idle" }
  }
  const noop = () => {}

  const callConfig: CallConfig = {
    callerAliasId: selectedCallerAliasId || undefined
  }

  return (
    <div style={testCallStyles.wrapper}>
      <div style={testCallStyles.banner}>
        <button
          type="button"
          onClick={onExit}
          style={testCallStyles.backButton}
          aria-label="Back to landing">
          ← Back
        </button>
        <span style={testCallStyles.bannerLabel}>TEST CALL MODE</span>
        <span style={testCallStyles.bannerSpacer} />
      </div>
      <p style={testCallStyles.bannerHint}>
        Mock candidate. Call dials{" "}
        <strong>{TEST_CANDIDATE_DETAILS.phoneNumber}</strong> via the
        middleware's <code>/dialpad-call</code> endpoint. Dialpad rings every
        eligible device on your account — pick up wherever's nearest.
      </p>

      <CallConfigContext.Provider value={callConfig}>
        <CallerIdPickerContext.Provider
          value={{
            state: contextState,
            selectedAliasId: selectedCallerAliasId,
            onSelect: setSelectedCallerAliasId
          }}>
          <TextSlotContext.Provider value={textSlot}>
            <CandidateView
              state={candidateState}
              onRetry={noop}
              onArmMarkInvalid={noop}
              onUndoMarkInvalid={noop}
              onRetryMarkInvalid={noop}
            />
          </TextSlotContext.Provider>
        </CallerIdPickerContext.Provider>
      </CallConfigContext.Provider>
      {textPopoverOpen && (
        <TextPopover
          fullName={TEST_CANDIDATE_DETAILS.fullName}
          phoneNumber={TEST_CANDIDATE_DETAILS.phoneNumber}
          callerAliasId={selectedCallerAliasId || undefined}
          onClose={() => setTextPopoverOpen(false)}
        />
      )}
    </div>
  )
}

const testCallStyles: Record<string, React.CSSProperties> = {
  wrapper: {
    width: "100%",
    display: "flex",
    flexDirection: "column",
    gap: "10px"
  },
  banner: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "8px",
    padding: "8px 10px",
    backgroundColor: "#fff8e1",
    border: "1px solid #f1c34c",
    borderRadius: "10px"
  },
  bannerLabel: {
    fontSize: "11px",
    fontWeight: 700,
    letterSpacing: "0.08em",
    color: "#7a5b00"
  },
  bannerSpacer: {
    width: "56px"
  },
  backButton: {
    width: "56px",
    padding: "4px 8px",
    backgroundColor: "transparent",
    color: "#7a5b00",
    border: "1px solid #f1c34c",
    borderRadius: "8px",
    fontSize: "12px",
    fontWeight: 600,
    cursor: "pointer"
  },
  bannerHint: {
    margin: "-2px 2px 4px",
    fontSize: "12px",
    color: "#5f6368",
    lineHeight: 1.45
  }
}
