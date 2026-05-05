import { sendToBackground } from "@plasmohq/messaging"
import { useStorage } from "@plasmohq/storage/hook"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"

import {
  CandidateView,
  ErrorToast,
  UndoToast
} from "~components/candidate"
import {
  AuthSecretInput,
  buildPayload,
  CandidateList,
  CandidateResultsList,
  CsvDropZone,
  JobModal,
  matchCandidates,
  parseCsv,
  ReviewTable,
  sendCandidatesBatch,
  addCandidatesToJob,
  StatusDisplay,
  styles
} from "~components/sync"
import { TestCallView } from "~components/test-call"
import { TextPopover } from "~components/text-popover"
import { useCallStream } from "~lib/callStream"
import { localStore, UNDO_DELAY_MS } from "~lib/constants"
import {
  CallConfigContext,
  CallerIdPickerContext,
  CallStreamContext,
  TextSlotContext
} from "~lib/contexts"
import type { DialpadUserContext } from "~lib/dialpad"
import type {
  CallConfig,
  Candidate,
  CandidateDetails,
  CandidateResult,
  CandidateState,
  MatchedCandidate,
  PageInfo,
  RFJob,
  UserContextState,
  WorkflowState
} from "~lib/types"

// --- Inject keyframe animations and class-based selectors ---
//
// One-shot global stylesheet: ensures only a single injection per side-panel
// load even if HMR re-evaluates this module.

const sidepanelStyle = document.createElement("style")
sidepanelStyle.textContent = `
  html, body {
    margin: 0;
    padding: 0;
    overflow-x: hidden;
  }
  *, *::before, *::after { box-sizing: border-box; }

  @keyframes spin { to { transform: rotate(360deg); } }
  @keyframes wave {
    0%, 60%, 100% { transform: rotate(0deg); }
    10%, 30% { transform: rotate(14deg); }
    20% { transform: rotate(-8deg); }
    40% { transform: rotate(14deg); }
    50% { transform: rotate(-4deg); }
  }
  @keyframes fade-up {
    from { opacity: 0; transform: translateY(6px); }
    to { opacity: 1; transform: translateY(0); }
  }

  /* ----- Animated "select profiles" checkbox ----- */

  @keyframes lr-box-pulse {
    0%, 50% {
      fill-opacity: 0;
      transform: scale(1);
    }
    54% {
      fill-opacity: 0;
      transform: scale(0.9);
    }
    58% {
      fill-opacity: 1;
      transform: scale(0.9);
    }
    64% {
      fill-opacity: 1;
      transform: scale(1);
    }
    86% {
      fill-opacity: 1;
      transform: scale(1);
    }
    92%, 100% {
      fill-opacity: 0;
      transform: scale(1);
    }
  }

  @keyframes lr-check-draw {
    0%, 56%   { stroke-dashoffset: 30; }
    66%, 86%  { stroke-dashoffset: 0; }
    92%, 100% { stroke-dashoffset: 30; }
  }

  @keyframes lr-spark-fly {
    0%, 60% { opacity: 0; transform: translateY(0); }
    66%     { opacity: 1; transform: translateY(-3px); }
    78%     { opacity: 0; transform: translateY(-11px); }
    100%    { opacity: 0; transform: translateY(-11px); }
  }

  .lr-checkbox-rect {
    fill: #0a66c2;
    fill-opacity: 0;
    transform-box: fill-box;
    transform-origin: center;
    animation: lr-box-pulse 4s ease-in-out infinite;
  }

  .lr-checkmark-path {
    stroke: #ffffff;
    stroke-dasharray: 30;
    stroke-dashoffset: 30;
    animation: lr-check-draw 4s ease-in-out infinite;
  }

  /* Each spark line lives inside a parent <g transform="rotate(X)"> for static
     radial positioning. CSS translateY then animates outward along the parent
     group's rotated y-axis — no transform-origin gymnastics required. */
  .lr-spark {
    opacity: 0;
    animation: lr-spark-fly 4s ease-in-out infinite;
  }

  @media (prefers-reduced-motion: reduce) {
    .lr-checkbox-rect,
    .lr-checkmark-path,
    .lr-spark {
      animation: none;
    }
    .lr-checkbox-rect { fill-opacity: 0; }
    .lr-checkmark-path { stroke-dashoffset: 0; }
  }

  /* ----- Candidate-mode action buttons ----- */

  .lr-call-btn {
    flex: 1 1 0;
    min-width: 0;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    padding: 10px 10px;
    background-color: #1f9d55;
    color: #ffffff;
    border: 1px solid #1f9d55;
    border-radius: 999px;
    font-size: 14px;
    font-weight: 600;
    text-decoration: none;
    cursor: pointer;
    transition: background-color 120ms ease, border-color 120ms ease, transform 120ms ease, box-shadow 120ms ease;
    box-shadow: 0 1px 0 rgba(0,0,0,0.04);
    white-space: nowrap;
  }
  .lr-call-btn:hover {
    background-color: #178044;
    border-color: #178044;
    box-shadow: 0 2px 6px rgba(31,157,85,0.32);
  }
  .lr-call-btn:active {
    transform: translateY(1px);
    box-shadow: 0 1px 0 rgba(0,0,0,0.04);
  }
  .lr-call-btn[aria-disabled="true"],
  .lr-call-btn:disabled {
    background-color: #eef0f2;
    color: #98a2ad;
    border-color: #e3e6ea;
    cursor: not-allowed;
    box-shadow: none;
    pointer-events: none;
  }
  .lr-call-btn .lr-call-icon {
    flex-shrink: 0;
  }

  /* Red modifier for the Hangup state — same pill geometry, swapped colour
     ramp. Applied when polling reports the call is in progress. */
  .lr-call-btn--hangup {
    background-color: #d23a2c;
    border-color: #d23a2c;
  }
  .lr-call-btn--hangup:hover {
    background-color: #b8302a;
    border-color: #b8302a;
    box-shadow: 0 2px 6px rgba(210,58,44,0.32);
  }

  .lr-invalid-btn {
    flex: 1 1 0;
    min-width: 0;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 10px 10px;
    background-color: transparent;
    color: #d23a2c;
    border: 1px solid #d23a2c;
    border-radius: 999px;
    font-size: 14px;
    font-weight: 600;
    cursor: pointer;
    transition: background-color 120ms ease, color 120ms ease, transform 120ms ease, box-shadow 120ms ease;
    white-space: nowrap;
  }
  .lr-invalid-btn:hover {
    background-color: #d23a2c;
    color: #ffffff;
    box-shadow: 0 2px 6px rgba(210,58,44,0.28);
  }
  .lr-invalid-btn:active {
    transform: translateY(1px);
    box-shadow: none;
  }
  .lr-invalid-btn:disabled {
    color: #b9bdc4;
    border-color: #e3e6ea;
    background-color: #fafbfc;
    cursor: not-allowed;
    box-shadow: none;
  }
  .lr-invalid-btn:disabled:hover {
    background-color: #fafbfc;
    color: #b9bdc4;
  }
  .lr-invalid-btn--marked {
    background-color: #fdecea;
    color: #b8302a;
    border-color: #f6c2bd;
    cursor: default;
  }
  .lr-invalid-btn--marked:hover {
    background-color: #fdecea;
    color: #b8302a;
    box-shadow: none;
  }
  .lr-invalid-btn--error {
    background-color: #d23a2c;
    color: #ffffff;
  }
  .lr-invalid-btn--error:hover {
    background-color: #b8302a;
    color: #ffffff;
  }

  /* ----- Cold call row ----- */

  .lr-coldcall-row {
    transition: border-color 120ms ease, background-color 120ms ease;
  }
  .lr-coldcall-row[data-expandable="true"]:hover {
    border-color: #d6dbe1;
    background-color: #ffffff;
  }
  .lr-coldcall-chevron {
    transition: transform 160ms ease;
    transform-origin: 50% 50%;
  }
  .lr-coldcall-chevron[data-open="true"] {
    transform: rotate(90deg);
  }
  .lr-coldcall-section-toggle {
    border-radius: 4px;
  }
  .lr-coldcall-section-toggle:focus-visible {
    outline: 2px solid #0a66c2;
    outline-offset: 2px;
  }
`
if (!document.querySelector("[data-lr-sync-styles]")) {
  sidepanelStyle.setAttribute("data-lr-sync-styles", "")
  document.head.appendChild(sidepanelStyle)
}

// --- Main Component ---

function SidePanel() {
  const [workflowState, setWorkflowState] =
    useState<WorkflowState>("not_on_pipeline")
  const [pageInfo, setPageInfo] = useState<PageInfo | null>(null)
  const [candidates, setCandidates] = useState<Candidate[]>([])
  const [loadStatus, setLoadStatus] = useState("")
  const [matchedCandidates, setMatchedCandidates] = useState<
    MatchedCandidate[]
  >([])
  const [csvError, setCsvError] = useState("")
  const [csvFileName, setCsvFileName] = useState("")
  const [extensionSecret, setExtensionSecret] = useStorage<string>(
    { key: "extensionSecret", instance: localStore },
    ""
  )
  const [candidateResults, setCandidateResults] = useState<CandidateResult[]>([])
  const [sendProgress, setSendProgress] = useState("")
  const [jobs, setJobs] = useState<RFJob[]>([])
  const [rfIds, setRfIds] = useState<number[]>([])
  const [selectedJobId, setSelectedJobId] = useState<number | null>(null)
  const [jobAddResult, setJobAddResult] = useState<string>("")
  const [showJobModal, setShowJobModal] = useState(false)
  const [mode, setMode] = useState<"sync" | "candidate" | "test_call">("sync")
  const [candidateUrlId, setCandidateUrlId] = useState<string | null>(null)
  const [candidateState, setCandidateState] = useState<CandidateState>({ phase: "idle" })
  const requestTokenRef = useRef(0)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const pollPageInfo = useCallback(async () => {
    try {
      const response = await sendToBackground<any, PageInfo>({
        name: "getPageInfo"
      })

      if (!response || !response.isPipelinePage) {
        setPageInfo(null)
        // Don't blow away state if we have loaded/matched data
        setWorkflowState((prev) => {
          if (
            prev === "loading" ||
            prev === "ready" ||
            prev === "csv_matched" ||
            prev === "sending" ||
            prev === "complete" ||
            prev === "adding_to_job" ||
            prev === "job_added"
          ) {
            return prev
          }
          return "not_on_pipeline"
        })
        return
      }

      setPageInfo(response)

      if (response.checkedCount === 0) {
        setWorkflowState((prev) => {
          if (
            prev === "loading" ||
            prev === "ready" ||
            prev === "csv_matched" ||
            prev === "sending" ||
            prev === "complete" ||
            prev === "adding_to_job" ||
            prev === "job_added"
          ) {
            return prev
          }
          return "no_selection"
        })
      } else {
        setWorkflowState((prev) => {
          if (
            prev === "loading" ||
            prev === "ready" ||
            prev === "csv_matched" ||
            prev === "sending" ||
            prev === "complete" ||
            prev === "adding_to_job" ||
            prev === "job_added"
          ) {
            return prev
          }
          return "profiles_selected"
        })
      }
    } catch {
      setPageInfo(null)
      setWorkflowState((prev) => {
        if (
          prev === "loading" ||
          prev === "ready" ||
          prev === "csv_matched" ||
          prev === "sending" ||
          prev === "complete"
        ) {
          return prev
        }
        return "not_on_pipeline"
      })
    }
  }, [])

  const resetTransientState = useCallback(() => {
    setCandidates([])
    setLoadStatus("")
    setMatchedCandidates([])
    setCsvError("")
    setCsvFileName("")
    setCandidateResults([])
    setSendProgress("")
    setJobs([])
    setRfIds([])
    setSelectedJobId(null)
    setJobAddResult("")
    setShowJobModal(false)
  }, [])

  useEffect(() => {
    if (mode !== "sync") {
      // Candidate / test-call modes own the sidepanel; pipeline polling is
      // irrelevant and would contribute to LinkedIn-tab load. Clear any
      // active interval.
      if (pollRef.current) {
        clearInterval(pollRef.current)
        pollRef.current = null
      }
      // Wipe sync transient state — non-sync modes win absolutely.
      resetTransientState()
      setPageInfo(null)
      setWorkflowState("not_on_pipeline")
      return
    }
    // mode === "sync" — resume interval-based polling AND tab-event-driven polling.
    pollPageInfo()
    pollRef.current = setInterval(pollPageInfo, 500)
    const onActivated = () => {
      pollPageInfo()
    }
    chrome.tabs.onActivated.addListener(onActivated)
    chrome.tabs.onUpdated.addListener(onActivated)
    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current)
        pollRef.current = null
      }
      chrome.tabs.onActivated.removeListener(onActivated)
      chrome.tabs.onUpdated.removeListener(onActivated)
    }
  }, [mode, pollPageInfo, resetTransientState])

  useEffect(() => {
    let cancelled = false

    // Seed initial mode from active tab.
    sendToBackground<unknown, { mode: "sync" | "candidate"; urlId: string | null; url: string }>({
      name: "getActiveTabContext"
    })
      .then((ctx) => {
        if (cancelled) return
        if (ctx?.mode) {
          setMode(ctx.mode)
          setCandidateUrlId(ctx.urlId)
        }
      })
      .catch(() => { })

    // Subscribe to background broadcasts. Test-call mode is user-triggered
    // and must NOT be clobbered by URL-driven mode broadcasts — the user has
    // to hit the Back button to leave it.
    const listener = (message: any) => {
      if (message?.type === "lr-mode-changed") {
        setMode((prev) => (prev === "test_call" ? prev : message.mode))
        setCandidateUrlId(message.urlId)
      }
    }
    chrome.runtime.onMessage.addListener(listener)

    return () => {
      cancelled = true
      chrome.runtime.onMessage.removeListener(listener)
    }
  }, [])

  const fetchCandidate = useCallback(
    async (urlId: string) => {
      const token = ++requestTokenRef.current
      setCandidateState({ phase: "loading", urlId })

      const urlResp = await sendToBackground<unknown, { profileUrl: string | null }>({
        name: "getCandidateProfileUrl"
      }).catch(() => ({ profileUrl: null }))

      if (token !== requestTokenRef.current) return

      if (!urlResp?.profileUrl) {
        setCandidateState({
          phase: "error",
          urlId,
          message:
            "Couldn't read LinkedIn profile on candidate sidepanel — try refreshing"
        })
        return
      }

      const resp = await sendToBackground<any, { ok: boolean; data?: CandidateDetails; error?: string }>({
        name: "fetchCandidateDetails",
        body: { profileUrl: urlResp.profileUrl, secret: extensionSecret }
      }).catch((err): { ok: boolean; data?: CandidateDetails; error?: string } => ({ ok: false, error: err?.message ?? "Network error" }))

      if (token !== requestTokenRef.current) return

      if (!resp?.ok || !resp.data) {
        setCandidateState({
          phase: "error",
          urlId,
          message: resp?.error ?? "Failed to fetch candidate"
        })
        return
      }

      setCandidateState({
        phase: "ready",
        urlId,
        details: resp.data,
        markInvalid: { status: "idle" }
      })
    },
    [extensionSecret]
  )

  useEffect(() => {
    if (mode === "candidate" && candidateUrlId) {
      fetchCandidate(candidateUrlId)
    } else {
      // Mode flipped away from candidate — drop any in-flight work and clear UI.
      requestTokenRef.current++
      setCandidateState({ phase: "idle" })
    }
  }, [mode, candidateUrlId, fetchCandidate])

  // --- Candidate-mode SMS / call surfaces ---
  //
  // These were previously test-call-only via TestCallView. Lifted up here so
  // production candidate-mode (real LinkedIn Recruiter profile sidepanel)
  // gets the full surface: caller-ID picker inside the identity card, Text
  // button on the action row, full template manager + editor flow, and
  // /dialpad-sms send. Storage of the picked alias is per-session
  // (selectedCallerAliasId state); not persisted across reloads on purpose
  // — the user re-confirms which number they're calling/texting from each
  // time the panel mounts.
  const [contextState, setContextState] = useState<UserContextState>({
    status: "loading"
  })
  const [selectedCallerAliasId, setSelectedCallerAliasId] = useState<string>("")
  const [textPopoverOpen, setTextPopoverOpen] = useState(false)

  // Fetch /dialpad-user-context once whenever we enter candidate mode. The
  // middleware response is small (devices + caller IDs aliased), and this
  // happens at most once per panel session per candidate-mode entry.
  useEffect(() => {
    if (mode !== "candidate") {
      setContextState({ status: "loading" })
      setTextPopoverOpen(false)
      return
    }
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
            resp.data.callerIds.find((c) => c.isDefault) ??
            resp.data.callerIds[0]
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
  }, [mode, extensionSecret])

  // Close any open SMS popover when the user navigates to a different
  // candidate so the popover never shows stale fullName/phoneNumber.
  useEffect(() => {
    setTextPopoverOpen(false)
  }, [candidateUrlId])

  const textSlot = useMemo(
    () => ({ onOpen: () => setTextPopoverOpen(true) }),
    []
  )

  // Polled call-state hook (POST /extension-call-status). Mounted once at
  // the sidepanel level so candidate-mode and test_call-mode share state.
  // Polling itself is gated on status — only runs while there's an active
  // calling/active call to track; idle = no network.
  const callStream = useCallStream()
  const callStreamSlot = useMemo(
    () => ({
      state: callStream.state,
      beginLocalCalling: callStream.beginLocalCalling,
      cancelLocalCalling: callStream.cancelLocalCalling
    }),
    [
      callStream.state,
      callStream.beginLocalCalling,
      callStream.cancelLocalCalling
    ]
  )

  const callConfig: CallConfig = {
    callerAliasId: selectedCallerAliasId || undefined
  }

  const undoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [errorToast, setErrorToast] = useState<string | null>(null)

  const fireMarkInvalid = useCallback(
    async (rfId: number, urlId: string) => {
      // Move to submitting (only if we're still on the same candidate).
      setCandidateState((prev) => {
        if (prev.phase !== "ready" || prev.urlId !== urlId) return prev
        return { ...prev, markInvalid: { status: "submitting" } }
      })

      const resp = await sendToBackground<any, { ok: boolean; error?: string }>({
        name: "markNumberInvalid",
        body: { rfId, secret: extensionSecret }
      }).catch((err) => ({ ok: false, error: err?.message ?? "Network error" }))

      // Track whether the response committed against the current candidate.
      // Used below to decide whether to surface the error toast — a stale
      // response (user navigated away during a deferred-POST timer) should
      // not pop a red toast over the new candidate's view.
      let committedToCurrent = false
      setCandidateState((prev) => {
        if (prev.phase !== "ready" || prev.urlId !== urlId) return prev
        committedToCurrent = true
        if (resp?.ok) {
          return { ...prev, markInvalid: { status: "marked" } }
        }
        return {
          ...prev,
          markInvalid: { status: "error", message: resp?.error ?? "Failed to mark invalid" }
        }
      })

      if (committedToCurrent && !resp?.ok) {
        setErrorToast(resp?.error ?? "Failed to mark invalid")
        // Auto-dismiss the error toast after 5s.
        setTimeout(() => setErrorToast(null), 5000)
      }
    },
    [extensionSecret]
  )

  const handleArmMarkInvalid = useCallback(() => {
    if (candidateState.phase !== "ready") return
    const { urlId, details } = candidateState
    setCandidateState({
      ...candidateState,
      markInvalid: { status: "armed", undoExpiresAt: Date.now() + UNDO_DELAY_MS }
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

  const handleSync = useCallback(async () => {
    // Full reset of transient state so each sync starts from the same baseline
    // a fresh page+extension load gives us. extensionSecret is
    // useStorage-backed and intentionally preserved.
    resetTransientState()
    setWorkflowState("loading")
    setLoadStatus("Loading candidates...")

    // Fetch fresh page info right now instead of relying on potentially stale polled state
    let freshPageInfo: PageInfo | null = null
    try {
      freshPageInfo = await sendToBackground<any, PageInfo>({ name: "getPageInfo" })
    } catch { }
    const info = freshPageInfo ?? pageInfo
    const targetCount = info?.totalOnPage || info?.checkedCount || 25

    const scrollResult = await sendToBackground({
      name: "scrollToBottom",
      body: { targetCount }
    })

    if (!scrollResult?.success) {
      setLoadStatus("Failed to scroll page. Try again.")
      setWorkflowState("profiles_selected")
      return
    }

    setLoadStatus("Extracting candidate data...")

    const loadResult = await sendToBackground({
      name: "getSelectedCandidates"
    })

    if (!loadResult) {
      setLoadStatus("Failed to extract candidates. Try again.")
      setWorkflowState("profiles_selected")
      return
    }

    setCandidates(loadResult.candidates)
    setLoadStatus(
      `${loadResult.count} candidate${loadResult.count !== 1 ? "s" : ""} ready`
    )
    setWorkflowState("ready")
  }, [pageInfo, resetTransientState])

  const handleCsvFile = useCallback(
    (file: File) => {
      setCsvError("")
      setCsvFileName(file.name)

      const reader = new FileReader()
      reader.onload = (e) => {
        const text = e.target?.result as string
        if (!text) {
          setCsvError("Could not read file")
          return
        }

        const csvRows = parseCsv(text)

        if (csvRows.length < candidates.length) {
          setCsvError(
            `CSV has fewer rows (${csvRows.length}) than synced candidates (${candidates.length}). Some candidates won't have a match.`
          )
        }

        const matched = matchCandidates(candidates, csvRows)
        setMatchedCandidates(matched)
        setWorkflowState("csv_matched")
      }
      reader.readAsText(file)
    },
    [candidates]
  )

  const toggleCandidate = useCallback((index: number) => {
    setMatchedCandidates((prev) =>
      prev.map((m, i) =>
        i === index ? { ...m, checked: !m.checked } : m
      )
    )
  }, [])

  const handleSend = useCallback(async () => {
    const toSend = matchedCandidates.filter((m) => m.checked)
    if (toSend.length === 0) return

    setWorkflowState("sending")
    setCandidateResults([])
    setJobs([])
    setRfIds([])
    setSelectedJobId(null)
    setJobAddResult("")
    setSendProgress(`Sending ${toSend.length} candidates...`)

    const payloads = toSend.map(buildPayload)
    const result = await sendCandidatesBatch(payloads, extensionSecret)

    if (!result.ok || !result.data) {
      setSendProgress(`Failed — ${result.error}`)
      setCandidateResults([])
      setWorkflowState("complete")
      return
    }

    const { data } = result

    setCandidateResults(data.results)
    setJobs(data.jobs)

    // Collect rfIds from created + updated + skipped (not errors)
    const ids = data.results
      .filter((r) => r.rfId != null && r.status !== "error")
      .map((r) => r.rfId!)
    setRfIds(ids)

    const parts: string[] = []
    if (data.created) parts.push(`${data.created} created`)
    if (data.updated) parts.push(`${data.updated} updated`)
    if (data.skipped) parts.push(`${data.skipped} skipped`)
    if (data.errors) parts.push(`${data.errors} failed`)
    setSendProgress(parts.join(", ") || "0 processed")
    setWorkflowState("complete")
  }, [matchedCandidates, extensionSecret])

  const handleAddToJob = useCallback(async () => {
    if (!selectedJobId || rfIds.length === 0) return

    const job = jobs.find((j) => j.id === selectedJobId)
    setWorkflowState("adding_to_job")
    setJobAddResult("")

    const result = await addCandidatesToJob(rfIds, selectedJobId, extensionSecret)

    if (!result.ok || !result.data) {
      setJobAddResult(`Failed — ${result.error}`)
      setWorkflowState("complete")
      return
    }

    const { data } = result
    // Derive from results array if available, otherwise fall back to top-level counts
    const added = data.results?.length
      ? data.results.filter((r) => r.status === "added").length
      : (data.added ?? 0)
    const alreadyInJob = data.results?.length
      ? data.results.filter((r) => r.status === "already_in_job").length
      : (data.alreadyInJob ?? 0)
    const errors = data.results?.length
      ? data.results.filter((r) => r.status === "error").length
      : (data.errors ?? 0)
    const jobName = job?.name ?? "job"
    const parts: string[] = []
    if (added) parts.push(`${added} added to ${jobName}`)
    if (alreadyInJob) parts.push(`${alreadyInJob} already in job`)
    if (errors) parts.push(`${errors} failed`)
    setJobAddResult(parts.join(", ") || `0 added to ${jobName}`)
    setWorkflowState("job_added")
  }, [extensionSecret, selectedJobId, rfIds, jobs])

  const handleReset = useCallback(() => {
    resetTransientState()
    setPageInfo(null)
    setWorkflowState("not_on_pipeline")
  }, [resetTransientState])

  const showResetButton =
    workflowState === "ready" ||
    workflowState === "csv_matched" ||
    workflowState === "complete" ||
    workflowState === "job_added"

  const checkedCount = matchedCandidates.filter((m) => m.checked).length
  const canSend = checkedCount > 0

  return (
    <div style={styles.container}>
      {mode === "candidate" && (
        <CallStreamContext.Provider value={callStreamSlot}>
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
                  onRetry={() =>
                    candidateUrlId && fetchCandidate(candidateUrlId)
                  }
                  onArmMarkInvalid={handleArmMarkInvalid}
                  onUndoMarkInvalid={handleUndoMarkInvalid}
                  onRetryMarkInvalid={handleRetryMarkInvalid}
                />
              </TextSlotContext.Provider>
            </CallerIdPickerContext.Provider>
          </CallConfigContext.Provider>
          {textPopoverOpen && candidateState.phase === "ready" && (
            <TextPopover
              fullName={candidateState.details.fullName}
              phoneNumber={candidateState.details.phoneNumber}
              callerAliasId={selectedCallerAliasId || undefined}
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
        </CallStreamContext.Provider>
      )}

      {mode === "test_call" && (
        <CallStreamContext.Provider value={callStreamSlot}>
          <TestCallView onExit={() => setMode("sync")} />
        </CallStreamContext.Provider>
      )}

      {mode === "sync" && (
        <>
          {showResetButton && (
            <div style={styles.resetBar}>
              <button onClick={handleReset} style={styles.resetButton} title="Clear all extension state and start over">
                Reset
              </button>
            </div>
          )}
          <StatusDisplay
            state={workflowState}
            pageInfo={pageInfo}
            loadStatus={loadStatus}
            count={candidates.length}
          />

          {workflowState === "profiles_selected" && (
            <button onClick={handleSync} style={styles.syncButton}>
              Sync {pageInfo?.checkedCount} Selected Profile
              {pageInfo?.checkedCount !== 1 ? "s" : ""}
            </button>
          )}

          {workflowState === "ready" && candidates.length > 0 && (
            <>
              <CsvDropZone
                onFile={handleCsvFile}
                fileName={csvFileName}
                error={csvError}
              />
              <CandidateList candidates={candidates} />
            </>
          )}

          {workflowState === "csv_matched" && matchedCandidates.length > 0 && (
            <>
              <AuthSecretInput secret={extensionSecret} onSecretChange={setExtensionSecret} />
              <ReviewTable
                matched={matchedCandidates}
                onToggle={toggleCandidate}
              />
              <button
                onClick={handleSend}
                disabled={!canSend}
                style={{
                  ...styles.syncButton,
                  backgroundColor: canSend ? "#27ae60" : "#ccc",
                  cursor: canSend ? "pointer" : "not-allowed"
                }}>
                Send {checkedCount} Candidate{checkedCount !== 1 ? "s" : ""}
              </button>
            </>
          )}

          {workflowState === "sending" && (
            <div style={styles.statusCentered}>
              <div style={styles.spinner} />
              <p style={styles.statusText}>{sendProgress}</p>
            </div>
          )}

          {workflowState === "complete" && (
            <>
              <p style={{ ...styles.statusText, textAlign: "center" }}>{sendProgress}</p>
              {candidateResults.length > 0 && (
                <CandidateResultsList results={candidateResults} />
              )}
              {candidateResults.length === 0 && (
                <>
                  <button
                    onClick={handleSend}
                    style={{ ...styles.syncButton, backgroundColor: "#e67e22" }}>
                    Retry
                  </button>
                  <button
                    onClick={() => setWorkflowState("csv_matched")}
                    style={{ ...styles.syncButton, backgroundColor: "#888" }}>
                    Back to Review
                  </button>
                </>
              )}
              {jobs.length > 0 && rfIds.length > 0 && (
                <button
                  onClick={() => setShowJobModal(true)}
                  style={{
                    ...styles.syncButton,
                    backgroundColor: "#0a66c2"
                  }}>
                  Add {rfIds.length} to Job
                </button>
              )}
              {showJobModal && (
                <JobModal
                  jobs={jobs}
                  selectedJobId={selectedJobId}
                  onSelect={setSelectedJobId}
                  candidateCount={rfIds.length}
                  onAdd={() => {
                    setShowJobModal(false)
                    handleAddToJob()
                  }}
                  onClose={() => setShowJobModal(false)}
                />
              )}
            </>
          )}

          {workflowState === "adding_to_job" && (
            <div style={styles.statusCentered}>
              <div style={styles.spinner} />
              <p style={styles.statusText}>Adding candidates to job...</p>
            </div>
          )}

          {workflowState === "job_added" && (
            <div style={styles.statusCentered}>
              <div style={styles.statusIcon}>
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#27ae60" strokeWidth="1.5">
                  <path d="M22 11.08V12a10 10 0 11-5.93-9.14" strokeLinecap="round" />
                  <path d="M22 4L12 14.01l-3-3" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </div>
              <p style={styles.statusText}>{jobAddResult}</p>
              <button
                onClick={handleReset}
                style={{
                  ...styles.syncButton,
                  backgroundColor: "#0a66c2",
                  marginTop: "12px"
                }}>
                OK
              </button>
            </div>
          )}
        </>
      )}
    </div>
  )
}

export default SidePanel
