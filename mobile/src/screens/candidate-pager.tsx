import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useNavigate, useParams } from "react-router-dom"

import {
  CandidateView,
  ErrorToast,
  UndoToast
} from "~/components/candidate"
import { TextPopover } from "~/components/text-popover"
import {
  fetchCandidateDetails,
  listJobPipeline,
  markNumberInvalid
} from "~/lib/api"
import { UNDO_DELAY_MS } from "~/lib/constants"
import { TextSlotContext } from "~/lib/contexts"
import { useStorage } from "~/lib/storage"
import type { CandidateState, PipelineCandidate } from "~/lib/types"

// Pipeline pager — the heart of the mobile app. URL params drive position;
// pipeline list and per-candidate fetch lifecycles match the extension's
// candidate-mode flow (token-based race protection, urlId-gated state
// updates, deferred mark-invalid via undo timer).

type PipelineState =
  | { kind: "loading" }
  | {
      kind: "ready"
      candidates: PipelineCandidate[]
      // Total count from the worker — may exceed `candidates.length` since
      // the response is capped at 1000. Surfaced for the position label.
      total: number
    }
  | { kind: "error"; message: string }

export function CandidatePager() {
  const { jobId: jobIdStr, index: indexStr } = useParams<{
    jobId: string
    index: string
  }>()
  const jobId = Number(jobIdStr ?? 0)
  const index = Number(indexStr ?? 0)
  const navigate = useNavigate()

  const [secret] = useStorage<string>("extensionSecret", "")

  // ----- Pipeline list -----
  // Fetched once per job entry; URL changes within /jobs/:jobId/candidate/*
  // re-render this component without remounting, so we don't refetch on
  // prev/next navigation.
  const [pipelineState, setPipelineState] = useState<PipelineState>({
    kind: "loading"
  })

  const reloadPipeline = useCallback(() => {
    setPipelineState({ kind: "loading" })
    let cancelled = false
    listJobPipeline({ jobId, secret })
      .then((resp) => {
        if (cancelled) return
        if (resp.ok) {
          setPipelineState({
            kind: "ready",
            candidates: resp.data.candidates,
            total: resp.data.total
          })
        } else {
          setPipelineState({ kind: "error", message: resp.error })
        }
      })
      .catch((err) => {
        if (cancelled) return
        setPipelineState({
          kind: "error",
          message:
            err instanceof Error ? err.message : "Failed to load pipeline"
        })
      })
    return () => {
      cancelled = true
    }
  }, [jobId, secret])

  useEffect(() => {
    return reloadPipeline()
  }, [reloadPipeline])

  // ----- Per-candidate details -----
  const [candidateState, setCandidateState] = useState<CandidateState>({
    phase: "idle"
  })
  const requestTokenRef = useRef(0)

  const currentProfileUrl =
    pipelineState.kind === "ready"
      ? pipelineState.candidates[index]?.linkedinUrl
      : undefined

  const fetchCurrent = useCallback(
    async (profileUrl: string) => {
      const token = ++requestTokenRef.current
      setCandidateState({ phase: "loading", urlId: profileUrl })

      const resp = await fetchCandidateDetails({ profileUrl, secret })

      if (token !== requestTokenRef.current) return

      if (!resp.ok) {
        setCandidateState({
          phase: "error",
          urlId: profileUrl,
          message: resp.error
        })
        return
      }

      setCandidateState({
        phase: "ready",
        urlId: profileUrl,
        details: resp.data,
        markInvalid: { status: "idle" }
      })
    },
    [secret]
  )

  useEffect(() => {
    if (currentProfileUrl) {
      fetchCurrent(currentProfileUrl)
    } else {
      requestTokenRef.current++
      setCandidateState({ phase: "idle" })
    }
  }, [currentProfileUrl, fetchCurrent])

  // ----- Mark invalid (deferred POST with undo) -----
  const undoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [errorToast, setErrorToast] = useState<string | null>(null)

  const fireMarkInvalid = useCallback(
    async (rfId: number, urlId: string) => {
      setCandidateState((prev) => {
        if (prev.phase !== "ready" || prev.urlId !== urlId) return prev
        return { ...prev, markInvalid: { status: "submitting" } }
      })

      const resp = await markNumberInvalid({ rfId, secret })

      let committedToCurrent = false
      setCandidateState((prev) => {
        if (prev.phase !== "ready" || prev.urlId !== urlId) return prev
        committedToCurrent = true
        if (resp.ok) {
          return { ...prev, markInvalid: { status: "marked" } }
        }
        return {
          ...prev,
          markInvalid: { status: "error", message: resp.error }
        }
      })

      if (committedToCurrent && !resp.ok) {
        setErrorToast(resp.error)
        setTimeout(() => setErrorToast(null), 5000)
      }
    },
    [secret]
  )

  const handleArmMarkInvalid = useCallback(() => {
    if (candidateState.phase !== "ready") return
    const { urlId, details } = candidateState
    setCandidateState({
      ...candidateState,
      markInvalid: {
        status: "armed",
        undoExpiresAt: Date.now() + UNDO_DELAY_MS
      }
    })
    if (undoTimerRef.current) clearTimeout(undoTimerRef.current)
    undoTimerRef.current = setTimeout(() => {
      undoTimerRef.current = null
      fireMarkInvalid(details.rfId, urlId)
    }, UNDO_DELAY_MS)
  }, [candidateState, fireMarkInvalid])

  const handleUndoMarkInvalid = useCallback(() => {
    if (undoTimerRef.current) {
      clearTimeout(undoTimerRef.current)
      undoTimerRef.current = null
    }
    setCandidateState((prev) => {
      if (prev.phase !== "ready") return prev
      return { ...prev, markInvalid: { status: "idle" } }
    })
  }, [])

  const handleRetryMarkInvalid = useCallback(() => {
    if (candidateState.phase !== "ready") return
    const { urlId, details } = candidateState
    fireMarkInvalid(details.rfId, urlId)
  }, [candidateState, fireMarkInvalid])

  // ----- Text composer -----
  const [textPopoverOpen, setTextPopoverOpen] = useState(false)
  const textSlot = useMemo(
    () => ({ onOpen: () => setTextPopoverOpen(true) }),
    []
  )
  // Close any open SMS popover when the user navigates between candidates
  // so the popover never shows stale fullName/phoneNumber.
  useEffect(() => {
    setTextPopoverOpen(false)
  }, [currentProfileUrl])

  // ----- Pipeline-level rendering (loading / error / empty) -----

  if (pipelineState.kind === "loading") {
    return (
      <PagerShell jobId={jobId}>
        <div style={shellStyles.statusBlock}>
          <div style={shellStyles.spinner} />
          <p style={shellStyles.statusText}>Loading pipeline…</p>
        </div>
      </PagerShell>
    )
  }

  if (pipelineState.kind === "error") {
    return (
      <PagerShell jobId={jobId}>
        <div style={shellStyles.statusBlock}>
          <p style={shellStyles.errorText}>{pipelineState.message}</p>
          <button
            type="button"
            onClick={reloadPipeline}
            style={shellStyles.retryButton}>
            Retry
          </button>
        </div>
      </PagerShell>
    )
  }

  // `length` is the navigable count (capped at 1000); `total` is the
  // worker's full filtered count. Position label uses the worker total
  // when it's larger so the user sees the real pipeline depth.
  const length = pipelineState.candidates.length
  const total = pipelineState.total

  if (length === 0) {
    return (
      <PagerShell jobId={jobId}>
        <div style={shellStyles.statusBlock}>
          <p style={shellStyles.statusText}>
            No sourced candidates for this job.
          </p>
          <p style={shellStyles.statusSubtext}>
            Add someone to the sourced stage in Recruiterflow and they'll
            show up here.
          </p>
        </div>
      </PagerShell>
    )
  }

  // Index out of range — shove the user back to the first candidate. This
  // is what we do when a stale link or refresh lands beyond the pipeline.
  if (index < 0 || index >= length) {
    setTimeout(() => navigate(`/jobs/${jobId}/candidate/0`, { replace: true }), 0)
    return null
  }

  const goPrev = () => {
    if (index > 0) navigate(`/jobs/${jobId}/candidate/${index - 1}`)
  }
  const goNext = () => {
    if (index < length - 1) navigate(`/jobs/${jobId}/candidate/${index + 1}`)
  }

  // Position label: "1 of 23" normally; "1 of 1000+ (23)" when the worker
  // capped a long pipeline. Keeps the user oriented when they're working
  // through a deep job.
  const positionLabel =
    total > length ? `${index + 1} of ${length} (cap of ${total})` : `${index + 1} of ${length}`

  // CandidateView remount on candidate change — clears its internal state
  // (rate-limit countdown, expanded cold-call rows, etc.) so navigation
  // doesn't bleed UI state across candidates.
  return (
    <PagerShell jobId={jobId} position={positionLabel}>
      <TextSlotContext.Provider value={textSlot}>
        <CandidateView
          key={currentProfileUrl}
          state={candidateState}
          onRetry={() =>
            currentProfileUrl ? fetchCurrent(currentProfileUrl) : undefined
          }
          onArmMarkInvalid={handleArmMarkInvalid}
          onUndoMarkInvalid={handleUndoMarkInvalid}
          onRetryMarkInvalid={handleRetryMarkInvalid}
        />
      </TextSlotContext.Provider>
      <div style={shellStyles.pager}>
        <button
          type="button"
          onClick={goPrev}
          disabled={index === 0}
          style={{
            ...shellStyles.pagerBtn,
            ...(index === 0 ? shellStyles.pagerBtnDisabled : null)
          }}>
          ← Prev
        </button>
        <button
          type="button"
          onClick={goNext}
          disabled={index === length - 1}
          style={{
            ...shellStyles.pagerBtn,
            ...(index === length - 1 ? shellStyles.pagerBtnDisabled : null)
          }}>
          Next →
        </button>
      </div>
      {textPopoverOpen && candidateState.phase === "ready" && (
        <TextPopover
          fullName={candidateState.details.fullName}
          phoneNumber={candidateState.details.phoneNumber}
          onClose={() => setTextPopoverOpen(false)}
        />
      )}
      {candidateState.phase === "ready" &&
        candidateState.markInvalid.status === "armed" && (
          <UndoToast
            message={`Marked ${candidateState.details.phoneNumber ?? "number"} invalid`}
            onUndo={handleUndoMarkInvalid}
          />
        )}
      {errorToast && <ErrorToast message={errorToast} />}
    </PagerShell>
  )
}

function PagerShell({
  jobId,
  position,
  children
}: {
  jobId: number
  position?: string
  children: React.ReactNode
}) {
  const navigate = useNavigate()
  return (
    <div style={shellStyles.shell}>
      <header style={shellStyles.header}>
        <button
          type="button"
          onClick={() => navigate("/jobs")}
          style={shellStyles.backBtn}
          aria-label="Back to jobs">
          ← Jobs
        </button>
        {position && <span style={shellStyles.position}>{position}</span>}
        <span style={shellStyles.jobIdSpacer} aria-hidden>
          #{jobId}
        </span>
      </header>
      <div style={shellStyles.body}>{children}</div>
    </div>
  )
}

const shellStyles: Record<string, React.CSSProperties> = {
  shell: {
    flex: 1,
    minHeight: "100vh",
    width: "100%",
    maxWidth: "640px",
    margin: "0 auto",
    padding: "56px 16px 24px",
    display: "flex",
    flexDirection: "column",
    gap: "16px"
  },
  header: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "12px",
    padding: "0 4px"
  },
  backBtn: {
    flexShrink: 0,
    padding: "8px 14px",
    backgroundColor: "transparent",
    color: "#0a66c2",
    border: "1px solid #0a66c2",
    borderRadius: "999px",
    fontSize: "13px",
    fontWeight: 600,
    cursor: "pointer",
    fontFamily: "inherit"
  },
  position: {
    fontSize: "13px",
    fontWeight: 700,
    letterSpacing: "0.04em",
    textTransform: "uppercase",
    color: "#3c4043"
  },
  jobIdSpacer: {
    fontSize: "12px",
    fontWeight: 500,
    color: "#98a2ad",
    fontVariantNumeric: "tabular-nums"
  },
  body: {
    flex: 1,
    display: "flex",
    flexDirection: "column"
  },
  pager: {
    display: "flex",
    flexDirection: "row",
    alignItems: "stretch",
    gap: "10px",
    marginTop: "16px"
  },
  pagerBtn: {
    flex: "1 1 0",
    minWidth: 0,
    padding: "13px 14px",
    backgroundColor: "#ffffff",
    color: "#0a66c2",
    border: "1px solid #0a66c2",
    borderRadius: "999px",
    fontSize: "15px",
    fontWeight: 600,
    cursor: "pointer",
    fontFamily: "inherit"
  },
  pagerBtnDisabled: {
    backgroundColor: "#eef0f2",
    color: "#98a2ad",
    borderColor: "#e3e6ea",
    cursor: "not-allowed"
  },
  statusBlock: {
    width: "100%",
    minHeight: "240px",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: "12px",
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
    maxWidth: "360px",
    lineHeight: 1.4
  },
  errorText: {
    margin: 0,
    fontSize: "14px",
    fontWeight: 600,
    color: "#a82a20",
    maxWidth: "360px",
    lineHeight: 1.4
  },
  retryButton: {
    padding: "10px 18px",
    backgroundColor: "#0a66c2",
    color: "#ffffff",
    border: "1px solid #0a66c2",
    borderRadius: "999px",
    fontSize: "14px",
    fontWeight: 600,
    cursor: "pointer"
  }
}
