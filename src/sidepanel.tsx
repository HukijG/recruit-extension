import { sendToBackground } from "@plasmohq/messaging"
import { Storage } from "@plasmohq/storage"
import { useStorage } from "@plasmohq/storage/hook"
import Papa from "papaparse"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"

const localStore = new Storage({ area: "local" })

// The activity `type` value the middleware uses for cold calls. Confirm with the
// middleware-side agent and update this constant when finalized.
const COLD_CALL_TYPE = "cold_call"

// --- Types ---

type WorkflowState =
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

type MatchStatus = "matched" | "warning" | "error"

interface PageInfo {
  isPipelinePage: boolean
  totalOnPage: number
  checkedCount: number
}

interface ExperienceEntry {
  title: string
  company: string
  startYear: number | null
  endYear: number | null
  isCurrent: boolean
}

interface EducationEntry {
  institution: string
  degree: string
  startYear: number | null
  endYear: number | null
}

interface Candidate {
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

interface CsvRow {
  firstName: string
  lastName: string
  currentCompany: string
  profileUrl: string
}

interface MatchedCandidate {
  candidate: Candidate
  csv: CsvRow
  status: MatchStatus
  normalizedCandidate: string
  normalizedCsv: string
  checked: boolean
}

interface CandidatePayload {
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

interface CandidateResult {
  fullName: string
  status: "created" | "updated" | "skipped" | "error"
  rfId?: number
  reason?: string
  dialpadSynced?: boolean
  phoneRequested?: boolean
}

interface RFJob {
  id: number
  name: string
  company: string
}

interface SendCandidatesResponse {
  total: number
  created: number
  updated: number
  skipped: number
  errors: number
  results: CandidateResult[]
  jobs: RFJob[]
}

interface AddToJobResponse {
  jobId: number
  added: number
  alreadyInJob: number
  errors: number
  results: { rfId: number; status: string; reason?: string }[]
}

// --- Candidate-mode types ---

interface CandidateActivity {
  id: string | number
  type: string
  name: string
  description: string
  createdAt: string
  outcome: string | null
}

interface CandidateJob {
  title: string
  company: string
  stage: string
}

interface CandidateDetails {
  rfId: number
  fullName: string
  phoneNumber: string | null
  job: CandidateJob | null
  activities: CandidateActivity[]
}

type MarkInvalidState =
  | { status: "idle" }
  | { status: "armed"; undoExpiresAt: number }
  | { status: "submitting" }
  | { status: "marked" }
  | { status: "error"; message: string }

type CandidateState =
  | { phase: "idle" }
  | { phase: "loading"; urlId: string }
  | { phase: "ready"; urlId: string; details: CandidateDetails; markInvalid: MarkInvalidState }
  | { phase: "error"; urlId: string; message: string }

// --- Normalization ---

function normalize(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // strip combining marks
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ")
}

// --- CSV Parsing ---

function parseCsv(text: string): CsvRow[] {
  const result = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: true
  })

  return result.data.map((row) => ({
    firstName: (row["First Name"] ?? "").trim(),
    lastName: (row["Last Name"] ?? "").trim(),
    currentCompany: (row["Current Company"] ?? "").trim(),
    profileUrl: (row["Profile URL"] ?? "").trim()
  }))
}

// --- Matching ---

function findBestCsvMatch(
  candidate: Candidate,
  remaining: { csv: CsvRow; originalIndex: number }[]
): { csv: CsvRow; originalIndex: number; score: number } | null {
  const sName = normalize(candidate.fullName)
  // Get company from first current experience entry, or empty
  const sCompany = normalize(
    candidate.experience.find((e) => e.isCurrent)?.company ?? ""
  )

  let bestMatch: { csv: CsvRow; originalIndex: number; score: number } | null = null

  for (const entry of remaining) {
    const cName = normalize(`${entry.csv.firstName} ${entry.csv.lastName}`)
    const cCompany = normalize(entry.csv.currentCompany)

    let score = 0

    // Exact name match is strong
    if (sName === cName) {
      score += 10
    }
    // Company match adds confidence
    if (sCompany && cCompany && sCompany === cCompany) {
      score += 5
    }

    if (score > 0 && (!bestMatch || score > bestMatch.score)) {
      bestMatch = { ...entry, score }
    }
  }

  return bestMatch
}

function matchCandidates(
  candidates: Candidate[],
  csv: CsvRow[]
): MatchedCandidate[] {
  const remaining = csv.map((c, i) => ({ csv: c, originalIndex: i }))
  const matched: MatchedCandidate[] = []

  for (let i = 0; i < candidates.length; i++) {
    const s = candidates[i]
    const best = findBestCsvMatch(s, remaining)

    if (best) {
      // Remove from remaining so it can't be matched again
      const idx = remaining.findIndex((r) => r.originalIndex === best.originalIndex)
      remaining.splice(idx, 1)

      const normalizedCandidate = normalize(s.fullName)
      const normalizedCsv = normalize(`${best.csv.firstName} ${best.csv.lastName}`)
      const nameMatch = normalizedCandidate === normalizedCsv

      const status: MatchStatus = nameMatch ? "matched" : "warning"

      matched.push({
        candidate: s,
        csv: best.csv,
        status,
        normalizedCandidate,
        normalizedCsv,
        checked: true
      })
    } else {
      // No match found
      matched.push({
        candidate: s,
        csv: { firstName: "", lastName: "", currentCompany: "", profileUrl: "" },
        status: "error",
        normalizedCandidate: normalize(s.fullName),
        normalizedCsv: "",
        checked: false
      })
    }
  }

  return matched
}

// --- Payload & Send ---

function buildPayload(m: MatchedCandidate): CandidatePayload {
  return {
    linkedinUrl: m.csv.profileUrl,
    internalTalentUrl: m.candidate.internalTalentUrl,
    fullName: m.candidate.fullName,
    headline: m.candidate.headline,
    location: m.candidate.location,
    industry: m.candidate.industry,
    photoUrl: m.candidate.photoUrl,
    connectionDegree: m.candidate.connectionDegree,
    pipelineStatus: m.candidate.pipelineStatus,
    experience: m.candidate.experience,
    totalExperienceCount: m.candidate.totalExperienceCount,
    education: m.candidate.education
  }
}

async function sendCandidatesBatch(
  candidates: CandidatePayload[],
  secret?: string
): Promise<{ ok: boolean; data?: SendCandidatesResponse; error?: string }> {
  try {
    const result = await sendToBackground({
      name: "sendCandidates",
      body: { candidates, secret }
    })
    return result ?? { ok: false, error: "No response from background" }
  } catch (err: any) {
    const msg = err?.message ?? "Send failed"
    return { ok: false, error: msg }
  }
}

async function addCandidatesToJob(
  rfIds: number[],
  jobId: number,
  secret?: string
): Promise<{ ok: boolean; data?: AddToJobResponse; error?: string }> {
  try {
    const result = await sendToBackground({
      name: "addToJob",
      body: { rfIds, jobId, secret }
    })
    return result ?? { ok: false, error: "No response from background" }
  } catch (err: any) {
    const msg = err?.message ?? "Add to job failed"
    return { ok: false, error: msg }
  }
}

// --- Inject spinner animation ---

const spinnerStyle = document.createElement("style")
spinnerStyle.textContent = `@keyframes spin { to { transform: rotate(360deg); } }`
if (!document.querySelector("[data-lr-sync-styles]")) {
  spinnerStyle.setAttribute("data-lr-sync-styles", "")
  document.head.appendChild(spinnerStyle)
}

// --- Consultant Name Header ---

function ConsultantNameHeader() {
  const [name, setName] = useStorage<string>(
    { key: "consultantFirstName", instance: localStore },
    ""
  )
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState("")
  const inputRef = useRef<HTMLInputElement>(null)

  const startEdit = () => {
    setDraft(name ?? "")
    setEditing(true)
    setTimeout(() => inputRef.current?.focus(), 0)
  }

  const confirmEdit = () => {
    const trimmed = draft.trim()
    if (!trimmed) return // reject empty submission, stay in edit mode
    setName(trimmed)
    setEditing(false)
  }

  const cancelEdit = () => {
    setEditing(false)
    setDraft("")
  }

  if (editing) {
    return (
      <div style={consultantStyles.headerRow}>
        <input
          ref={inputRef}
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") confirmEdit()
            else if (e.key === "Escape") cancelEdit()
          }}
          onBlur={cancelEdit}
          placeholder="First name"
          style={consultantStyles.headerInput}
        />
        <button
          onMouseDown={(e) => {
            e.preventDefault()
            confirmEdit()
          }}
          style={consultantStyles.headerConfirm}>
          Confirm
        </button>
      </div>
    )
  }

  const hasName = !!(name && name.trim())
  return (
    <div style={consultantStyles.headerRow}>
      <button
        onClick={startEdit}
        style={hasName ? consultantStyles.headerSet : consultantStyles.headerUnset}
        title="Click to edit your name">
        <span>{hasName ? name : "Add your name"}</span>
        <span style={consultantStyles.headerEditIcon}>✎</span>
      </button>
    </div>
  )
}

const consultantStyles: Record<string, React.CSSProperties> = {
  headerRow: {
    width: "100%",
    display: "flex",
    justifyContent: "flex-start",
    alignItems: "center",
    gap: "6px",
    marginBottom: "-12px"
  },
  headerSet: {
    background: "#fff",
    border: "1px solid #e0e0e0",
    borderRadius: "12px",
    padding: "4px 10px",
    fontSize: "11px",
    fontWeight: 500,
    color: "#444",
    cursor: "pointer",
    display: "inline-flex",
    alignItems: "center",
    gap: "6px"
  },
  headerUnset: {
    background: "#fafafa",
    border: "1px dashed #ccc",
    borderRadius: "12px",
    padding: "4px 10px",
    fontSize: "11px",
    fontStyle: "italic",
    color: "#999",
    cursor: "pointer",
    display: "inline-flex",
    alignItems: "center",
    gap: "6px"
  },
  headerEditIcon: {
    fontSize: "10px",
    opacity: 0.6
  },
  headerInput: {
    padding: "4px 8px",
    fontSize: "12px",
    border: "1px solid #0a66c2",
    borderRadius: "12px",
    outline: "none",
    width: "120px"
  },
  headerConfirm: {
    padding: "4px 10px",
    fontSize: "11px",
    fontWeight: 500,
    color: "#fff",
    background: "#0a66c2",
    border: "none",
    borderRadius: "12px",
    cursor: "pointer"
  }
}

// --- Main Component ---

function SidePanel() {
  const [workflowState, setWorkflowState] =
    useState<WorkflowState>("not_on_pipeline")
  const [pageInfo, setPageInfo] = useState<PageInfo | null>(null)
  const [candidates, setCandidates] = useState<
    Candidate[]
  >([])
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
  const [mode, setMode] = useState<"sync" | "candidate">("sync")
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
    if (mode === "candidate") {
      // Candidate mode owns the sidepanel; pipeline polling is irrelevant
      // and would contribute to LinkedIn-tab load. Clear any active interval.
      if (pollRef.current) {
        clearInterval(pollRef.current)
        pollRef.current = null
      }
      // Wipe sync transient state — candidate mode wins absolutely (per spec).
      resetTransientState()
      setPageInfo(null)
      setWorkflowState("not_on_pipeline")
      return
    }
    // mode === "sync" — resume polling.
    pollPageInfo()
    pollRef.current = setInterval(pollPageInfo, 500)
    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current)
        pollRef.current = null
      }
    }
  }, [mode, pollPageInfo, resetTransientState])

  useEffect(() => {
    const onActivated = () => {
      pollPageInfo()
    }
    chrome.tabs.onActivated.addListener(onActivated)
    chrome.tabs.onUpdated.addListener(onActivated)
    return () => {
      chrome.tabs.onActivated.removeListener(onActivated)
      chrome.tabs.onUpdated.removeListener(onActivated)
    }
  }, [pollPageInfo])

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
      .catch(() => {})

    // Subscribe to background broadcasts.
    const listener = (message: any) => {
      if (message?.type === "lr-mode-changed") {
        setMode(message.mode)
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
          message: "Could not read profile URL from page"
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

      setCandidateState((prev) => {
        if (prev.phase !== "ready" || prev.urlId !== urlId) return prev
        if (resp?.ok) {
          return { ...prev, markInvalid: { status: "marked" } }
        }
        return {
          ...prev,
          markInvalid: { status: "error", message: resp?.error ?? "Failed to mark invalid" }
        }
      })

      if (!resp?.ok) {
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
    } catch {}
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
      <ConsultantNameHeader />

      {mode === "candidate" && (
        <>
          <CandidateView
            state={candidateState}
            onRetry={() => candidateUrlId && fetchCandidate(candidateUrlId)}
            onArmMarkInvalid={handleArmMarkInvalid}
            onUndoMarkInvalid={handleUndoMarkInvalid}
            onRetryMarkInvalid={handleRetryMarkInvalid}
          />
          {candidateState.phase === "ready" &&
            candidateState.markInvalid.status === "armed" && (
              <UndoToast
                message={`Marked ${candidateState.details.phoneNumber ?? "number"} invalid`}
                onUndo={handleUndoMarkInvalid}
              />
            )}
          {errorToast && <ErrorToast message={errorToast} />}
        </>
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

// --- Candidate View ---

function CandidateView({
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
  if (state.phase === "idle" || state.phase === "loading") {
    return (
      <div style={styles.statusCentered}>
        <div style={styles.spinner} />
        <p style={styles.statusText}>Loading candidate…</p>
      </div>
    )
  }

  if (state.phase === "error") {
    return (
      <div style={styles.statusCentered}>
        <div style={styles.statusIcon}>
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#e74c3c" strokeWidth="1.5">
            <circle cx="12" cy="12" r="10" />
            <path d="M12 8v4M12 16h.01" strokeLinecap="round" />
          </svg>
        </div>
        <p style={styles.statusText}>Failed to load candidate</p>
        <p style={styles.statusSubtext}>{state.message}</p>
        <button onClick={onRetry} style={{ ...styles.syncButton, marginTop: "12px" }}>
          Retry
        </button>
      </div>
    )
  }

  // phase === "ready"
  return (
    <div style={candidateStyles.container}>
      <p style={candidateStyles.candidateName}>{state.details.fullName}</p>
      <div style={candidateStyles.phoneAndInvalidRow}>
        <CandidatePhoneRow phoneNumber={state.details.phoneNumber} />
        <NumberInvalidButton
          rfId={state.details.rfId}
          phoneNumber={state.details.phoneNumber}
          state={state.markInvalid}
          onArm={onArmMarkInvalid}
          onUndo={onUndoMarkInvalid}
          onRetry={onRetryMarkInvalid}
        />
      </div>
      <CandidateJobBox job={state.details.job} />
      <CandidateColdCallList activities={state.details.activities} />
    </div>
  )
}

function CandidatePhoneRow({ phoneNumber }: { phoneNumber: string | null }) {
  if (!phoneNumber) {
    return (
      <div style={candidateStyles.phoneRow}>
        <span style={candidateStyles.phoneDisabled}>📞 No phone on file</span>
      </div>
    )
  }
  const dialUrl = `dialpad://${phoneNumber}?launchMinimode=1`
  return (
    <div style={candidateStyles.phoneRow}>
      <a href={dialUrl} style={candidateStyles.phoneLink}>
        📞 {phoneNumber}
      </a>
    </div>
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
  return (
    <div style={candidateStyles.jobBox}>
      <p style={candidateStyles.jobTitle}>{job.title}</p>
      <p style={candidateStyles.jobCompany}>{job.company}</p>
      <span style={candidateStyles.jobStageChip}>{job.stage}</span>
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
      <p style={candidateStyles.coldCallHeading}>Cold calls ({coldCalls.length})</p>
      {coldCalls.map((c, i) => {
        const date = formatActivityDate(c.createdAt)
        const isConnected = c.outcome === "connected"
        const hasNotes = c.description.trim().length > 0
        const canExpand = isConnected || hasNotes
        const isExpanded = expanded.has(c.id)
        return (
          <div key={c.id} style={candidateStyles.coldCallRow}>
            <div
              style={{
                ...candidateStyles.coldCallHeader,
                cursor: canExpand ? "pointer" : "default"
              }}
              onClick={canExpand ? () => toggle(c.id) : undefined}>
              <span style={candidateStyles.coldCallChevron}>
                {canExpand ? (isExpanded ? "▾" : "▸") : "·"}
              </span>
              <span style={candidateStyles.coldCallLabel}>
                Cold call {i + 1} — {date}
              </span>
              {isConnected && <span style={candidateStyles.coldCallConnected}>✓</span>}
            </div>
            {canExpand && isExpanded && (
              <p style={candidateStyles.coldCallDescription}>
                {hasNotes ? c.description : "(connected)"}
              </p>
            )}
          </div>
        )
      })}
    </div>
  )
}

function formatActivityDate(iso: string): string {
  const d = new Date(iso)
  if (isNaN(d.getTime())) return iso
  return d.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric"
  })
}

const UNDO_DELAY_MS = 5000

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
      <button onClick={onRetry} style={candidateStyles.invalidButtonError}>
        Retry mark invalid
      </button>
    )
  }

  return (
    <button
      onClick={onArm}
      disabled={isDisabled || isMarked}
      style={
        isMarked
          ? candidateStyles.invalidButtonMarked
          : isDisabled
            ? candidateStyles.invalidButtonDisabled
            : candidateStyles.invalidButton
      }>
      {isMarked ? "Marked invalid ✓" : "Number Invalid"}
    </button>
  )
}

function UndoToast({
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

function ErrorToast({ message }: { message: string }) {
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
  candidateName: {
    margin: 0,
    fontSize: "18px",
    fontWeight: 600,
    color: "#222",
    textAlign: "center"
  },
  phoneRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: "12px"
  },
  phoneLink: {
    display: "inline-flex",
    alignItems: "center",
    gap: "6px",
    padding: "8px 16px",
    backgroundColor: "#0a66c2",
    color: "#fff",
    borderRadius: "20px",
    fontSize: "14px",
    fontWeight: 500,
    textDecoration: "none"
  },
  phoneDisabled: {
    display: "inline-flex",
    alignItems: "center",
    gap: "6px",
    padding: "8px 16px",
    backgroundColor: "#f0f0f0",
    color: "#999",
    borderRadius: "20px",
    fontSize: "14px",
    fontWeight: 500
  },
  jobBox: {
    width: "100%",
    padding: "12px 14px",
    backgroundColor: "#f8f9fa",
    borderRadius: "8px",
    border: "1px solid #e8e8e8",
    display: "flex",
    flexDirection: "column",
    gap: "4px"
  },
  jobTitle: {
    margin: 0,
    fontSize: "14px",
    fontWeight: 600,
    color: "#222"
  },
  jobCompany: {
    margin: 0,
    fontSize: "13px",
    color: "#555"
  },
  jobStageChip: {
    alignSelf: "flex-start",
    fontSize: "11px",
    padding: "2px 8px",
    borderRadius: "10px",
    backgroundColor: "#e8f0fe",
    color: "#0a66c2",
    fontWeight: 500,
    marginTop: "4px"
  },
  jobPlaceholder: {
    margin: 0,
    fontSize: "13px",
    color: "#888",
    fontStyle: "italic"
  },
  coldCallSection: {
    width: "100%",
    display: "flex",
    flexDirection: "column",
    gap: "4px"
  },
  coldCallHeading: {
    margin: "0 0 4px 0",
    fontSize: "12px",
    fontWeight: 600,
    color: "#555",
    textTransform: "uppercase",
    letterSpacing: "0.5px"
  },
  coldCallEmpty: {
    margin: 0,
    fontSize: "12px",
    color: "#888",
    fontStyle: "italic"
  },
  coldCallRow: {
    padding: "6px 8px",
    backgroundColor: "#fafafa",
    borderRadius: "6px",
    border: "1px solid #eee"
  },
  coldCallHeader: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    fontSize: "13px",
    color: "#333"
  },
  coldCallChevron: {
    fontSize: "11px",
    color: "#888",
    width: "12px",
    textAlign: "center"
  },
  coldCallLabel: {
    flex: 1
  },
  coldCallConnected: {
    color: "#27ae60",
    fontWeight: 600
  },
  coldCallDescription: {
    margin: "6px 0 0 20px",
    fontSize: "12px",
    color: "#555",
    fontStyle: "italic",
    lineHeight: "1.4"
  },
  phoneAndInvalidRow: {
    width: "100%",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: "8px"
  },
  invalidButton: {
    padding: "6px 14px",
    fontSize: "12px",
    fontWeight: 500,
    color: "#e74c3c",
    backgroundColor: "#fff",
    border: "1px solid #e74c3c",
    borderRadius: "16px",
    cursor: "pointer"
  },
  invalidButtonMarked: {
    padding: "6px 14px",
    fontSize: "12px",
    fontWeight: 500,
    color: "#888",
    backgroundColor: "#f5f5f5",
    border: "1px solid #ddd",
    borderRadius: "16px",
    cursor: "default"
  },
  invalidButtonDisabled: {
    padding: "6px 14px",
    fontSize: "12px",
    fontWeight: 500,
    color: "#bbb",
    backgroundColor: "#fafafa",
    border: "1px solid #eee",
    borderRadius: "16px",
    cursor: "not-allowed"
  },
  invalidButtonError: {
    padding: "6px 14px",
    fontSize: "12px",
    fontWeight: 500,
    color: "#fff",
    backgroundColor: "#e74c3c",
    border: "none",
    borderRadius: "16px",
    cursor: "pointer"
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

// --- Status Display ---

function StatusDisplay({
  state,
  pageInfo,
  loadStatus,
  count
}: {
  state: WorkflowState
  pageInfo: PageInfo | null
  loadStatus: string
  count: number
}) {
  if (state === "not_on_pipeline") {
    return (
      <div style={styles.statusCentered}>
        <div style={styles.statusIcon}>
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#999" strokeWidth="1.5">
            <path d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            <path d="M9 10h.01M15 10h.01M9.5 15.5a3.5 3.5 0 005 0" strokeLinecap="round" />
          </svg>
        </div>
        <p style={styles.statusText}>Navigate to a LinkedIn Recruiter pipeline page</p>
        <p style={styles.statusSubtext}>The extension will activate when it detects a pipeline view</p>
      </div>
    )
  }

  if (state === "no_selection") {
    return (
      <div style={styles.statusCentered}>
        <div style={styles.statusIcon}>
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#0a66c2" strokeWidth="1.5">
            <rect x="3" y="3" width="18" height="18" rx="2" />
            <path d="M9 12l2 2 4-4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
        <p style={styles.statusText}>Select profiles to sync</p>
      </div>
    )
  }

  if (state === "profiles_selected") {
    return (
      <div style={styles.statusCentered}>
        <div style={styles.statusIcon}>
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#27ae60" strokeWidth="1.5">
            <path d="M22 11.08V12a10 10 0 11-5.93-9.14" strokeLinecap="round" />
            <path d="M22 4L12 14.01l-3-3" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
        <p style={styles.statusText}>
          {pageInfo?.checkedCount} profile{pageInfo?.checkedCount !== 1 ? "s" : ""} selected
        </p>
        <p style={styles.statusSubtext}>Ready to sync</p>
      </div>
    )
  }

  if (state === "loading") {
    return (
      <div style={styles.statusCentered}>
        <div style={styles.spinner} />
        <p style={styles.statusText}>Loading profiles...</p>
        <p style={styles.statusSubtext}>{loadStatus}</p>
      </div>
    )
  }

  if (state === "ready") {
    return (
      <div style={styles.statusCentered}>
        <div style={styles.statusIcon}>
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#27ae60" strokeWidth="1.5">
            <path d="M22 11.08V12a10 10 0 11-5.93-9.14" strokeLinecap="round" />
            <path d="M22 4L12 14.01l-3-3" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
        <p style={styles.statusText}>
          {count} candidate{count !== 1 ? "s" : ""} ready
        </p>
        <p style={styles.statusSubtext}>Upload a CSV export to match</p>
      </div>
    )
  }

  if (state === "csv_matched") {
    return (
      <div style={styles.statusCentered}>
        <div style={styles.statusIcon}>
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#27ae60" strokeWidth="1.5">
            <path d="M22 11.08V12a10 10 0 11-5.93-9.14" strokeLinecap="round" />
            <path d="M22 4L12 14.01l-3-3" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
        <p style={styles.statusText}>Matched — review candidates below</p>
      </div>
    )
  }

  // sending and complete states render their own UI in the main component
  return null
}

// --- CSV Drop Zone ---

function CsvDropZone({
  onFile,
  fileName,
  error
}: {
  onFile: (file: File) => void
  fileName: string
  error: string
}) {
  const [isDragging, setIsDragging] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      setIsDragging(false)
      const file = e.dataTransfer.files[0]
      if (file) onFile(file)
    },
    [onFile]
  )

  return (
    <div style={{ width: "100%" }}>
      <div
        onDragOver={(e) => {
          e.preventDefault()
          setIsDragging(true)
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
        style={{
          ...styles.dropZone,
          borderColor: isDragging ? "#0a66c2" : error ? "#e74c3c" : "#ccc",
          backgroundColor: isDragging ? "#f0f7ff" : "#fafafa"
        }}>
        <input
          ref={fileInputRef}
          type="file"
          accept=".csv"
          style={{ display: "none" }}
          onChange={(e) => {
            const file = e.target.files?.[0]
            if (file) onFile(file)
          }}
        />
        {fileName ? (
          <p style={styles.dropZoneText}>{fileName}</p>
        ) : (
          <>
            <p style={styles.dropZoneText}>Drop CSV export here</p>
            <p style={styles.dropZoneSubtext}>or click to browse</p>
          </>
        )}
      </div>
      {error && <p style={styles.errorText}>{error}</p>}
    </div>
  )
}

// --- Review Table ---

function ReviewTable({
  matched,
  onToggle
}: {
  matched: MatchedCandidate[]
  onToggle: (index: number) => void
}) {
  const checkedCount = matched.filter((m) => m.checked).length
  const warningCount = matched.filter((m) => m.status === "warning").length

  return (
    <div style={styles.reviewContainer}>
      <div style={styles.reviewHeader}>
        <p style={styles.sectionTitle}>Review Matches</p>
        <p style={styles.reviewSummary}>
          {checkedCount} selected
          {warningCount > 0 ? ` · ${warningCount} warning${warningCount !== 1 ? "s" : ""}` : ""}
        </p>
      </div>
      <div style={styles.tableWrapper}>
        <table style={styles.table}>
          <thead>
            <tr>
              <th style={styles.th}></th>
              <th style={{ ...styles.th, textAlign: "left" }}>Name</th>
              <th style={{ ...styles.th, textAlign: "left" }}>Role</th>
              <th style={{ ...styles.th, textAlign: "left" }}>LinkedIn URL</th>
              <th style={styles.th}>Match</th>
            </tr>
          </thead>
          <tbody>
            {matched.map((m, i) => {
              const rowBg =
                m.status === "warning"
                  ? "#fff8e1"
                  : m.status === "error"
                    ? "#ffebee"
                    : "#f0faf0"

              return (
                <tr key={i} style={{ backgroundColor: rowBg }}>
                  <td style={styles.td}>
                    <input
                      type="checkbox"
                      checked={m.checked}
                      onChange={() => onToggle(i)}
                    />
                  </td>
                  <td style={styles.td}>
                    <span style={styles.tdName}>{m.candidate.fullName}</span>
                  </td>
                  <td style={styles.td}>
                    <span style={styles.tdDetail}>
                      {m.candidate.experience[0]?.title || m.candidate.headline}
                    </span>
                  </td>
                  <td style={styles.td}>
                    {m.csv.profileUrl ? (
                      <a
                        href={m.csv.profileUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={styles.tdLink}>
                        {m.csv.profileUrl.replace("https://www.linkedin.com/in/", "")}
                      </a>
                    ) : (
                      <span style={styles.tdDetail}>—</span>
                    )}
                  </td>
                  <td style={{ ...styles.td, textAlign: "center" }}>
                    {m.status === "matched" ? (
                      <span style={{ color: "#27ae60" }}>✓</span>
                    ) : m.status === "warning" ? (
                      <span
                        style={{ color: "#f39c12", cursor: "help" }}
                        title={`Candidate: "${m.normalizedCandidate}" vs CSV: "${m.normalizedCsv}"`}>
                        ⚠
                      </span>
                    ) : (
                      <span style={{ color: "#e74c3c" }}>✗</span>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// --- Auth Secret Input ---

function AuthSecretInput({
  secret,
  onSecretChange
}: {
  secret: string
  onSecretChange: (secret: string) => void
}) {
  return (
    <div style={{ width: "100%" }}>
      <label style={styles.inputLabel}>Extension Secret</label>
      <div style={{ display: "flex", gap: "6px" }}>
        <input
          type="password"
          value={secret ?? ""}
          onChange={(e) => onSecretChange(e.target.value)}
          placeholder="Enter secret..."
          style={{ ...styles.urlInput, flex: 1 }}
        />
        {secret && (
          <button
            onClick={() => onSecretChange("")}
            title="Clear secret"
            style={{
              padding: "6px 10px",
              border: "1px solid #ddd",
              borderRadius: "6px",
              backgroundColor: "#fff",
              cursor: "pointer",
              fontSize: "12px",
              color: "#e74c3c",
              flexShrink: 0
            }}>
            Clear
          </button>
        )}
      </div>
    </div>
  )
}

// --- Candidate Results List ---

function CandidateResultsList({ results }: { results: CandidateResult[] }) {
  return (
    <div style={{ width: "100%", marginTop: "8px" }}>
      {results.map((r, i) => {
        const bg =
          r.status === "created" ? "#f0faf0" :
          r.status === "updated" ? "#e8f4fd" :
          r.status === "skipped" ? "#fff8e1" :
          "#ffebee"
        const icon =
          r.status === "created" ? "✓" :
          r.status === "updated" ? "↻" :
          r.status === "skipped" ? "↷" :
          "✗"
        const color =
          r.status === "created" ? "#27ae60" :
          r.status === "updated" ? "#0a66c2" :
          r.status === "skipped" ? "#f39c12" :
          "#e74c3c"
        const detail =
          r.status === "updated" ? "updated" :
          r.status === "skipped" ? "already exists" :
          r.status === "error" ? (r.reason ?? "error") :
          ""

        return (
          <div
            key={i}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "8px",
              padding: "4px 8px",
              fontSize: "12px",
              backgroundColor: bg,
              borderRadius: "4px",
              marginBottom: "2px"
            }}>
            <span style={{ color, flexShrink: 0 }}>{icon}</span>
            <span style={{ flex: 1, color: "#333" }}>{r.fullName}</span>
            {detail && (
              <span style={{ color: "#888", fontSize: "10px" }}>{detail}</span>
            )}
          </div>
        )
      })}
    </div>
  )
}

// --- Job Dropdown ---

function JobDropdown({
  jobs,
  selectedJobId,
  onSelect
}: {
  jobs: RFJob[]
  selectedJobId: number | null
  onSelect: (id: number | null) => void
}) {
  const [isOpen, setIsOpen] = useState(false)
  const [search, setSearch] = useState("")
  const searchRef = useRef<HTMLInputElement>(null)
  const selected = jobs.find((j) => j.id === selectedJobId)

  const filtered = search
    ? jobs.filter((j) => {
        const q = search.toLowerCase()
        return j.name.toLowerCase().includes(q) || j.company.toLowerCase().includes(q)
      })
    : jobs

  return (
    <div style={{ width: "100%", position: "relative" }}>
      <label style={styles.inputLabel}>Assign to Job</label>
      <div
        onClick={() => {
          setIsOpen(!isOpen)
          if (!isOpen) setTimeout(() => searchRef.current?.focus(), 0)
        }}
        style={{
          padding: "10px 12px",
          border: "1px solid #ddd",
          borderRadius: "8px",
          cursor: "pointer",
          backgroundColor: "#fff",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          transition: "border-color 0.15s",
          borderColor: isOpen ? "#0a66c2" : "#ddd"
        }}>
        {selected ? (
          <div>
            <div style={{ fontSize: "13px", fontWeight: 500, color: "#333" }}>
              {selected.name}
            </div>
            <div style={{ fontSize: "11px", color: "#888", marginTop: "1px" }}>
              {selected.company}
            </div>
          </div>
        ) : (
          <span style={{ fontSize: "13px", color: "#999" }}>Select a job...</span>
        )}
        <svg
          width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#888" strokeWidth="2"
          style={{ transform: isOpen ? "rotate(180deg)" : "none", transition: "transform 0.15s", flexShrink: 0 }}>
          <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
      {isOpen && (
        <div style={{
          position: "absolute",
          top: "100%",
          left: 0,
          right: 0,
          marginTop: "4px",
          backgroundColor: "#fff",
          border: "1px solid #ddd",
          borderRadius: "8px",
          boxShadow: "0 4px 12px rgba(0,0,0,0.1)",
          zIndex: 10,
          maxHeight: "280px",
          display: "flex",
          flexDirection: "column" as const
        }}>
          <div style={{ padding: "8px", borderBottom: "1px solid #eee" }}>
            <input
              ref={searchRef}
              type="text"
              placeholder="Search jobs..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onClick={(e) => e.stopPropagation()}
              style={{
                width: "100%",
                padding: "7px 10px",
                border: "1px solid #ddd",
                borderRadius: "6px",
                fontSize: "13px",
                outline: "none",
                boxSizing: "border-box" as const
              }}
              onFocus={(e) => { e.target.style.borderColor = "#0a66c2" }}
              onBlur={(e) => { e.target.style.borderColor = "#ddd" }}
            />
          </div>
          <div style={{ overflowY: "auto" as const, maxHeight: "220px" }}>
            {filtered.length === 0 ? (
              <div style={{ padding: "12px", fontSize: "13px", color: "#999", textAlign: "center" as const }}>
                No jobs found
              </div>
            ) : filtered.map((job) => (
              <div
                key={job.id}
                onClick={() => {
                  onSelect(job.id)
                  setIsOpen(false)
                  setSearch("")
                }}
                style={{
                  padding: "10px 12px",
                  cursor: "pointer",
                  backgroundColor: job.id === selectedJobId ? "#f0f7ff" : "#fff",
                  borderBottom: "1px solid #f0f0f0",
                  transition: "background-color 0.1s"
                }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.backgroundColor = "#f5f5f5" }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.backgroundColor = job.id === selectedJobId ? "#f0f7ff" : "#fff" }}>
                <div style={{ fontSize: "13px", fontWeight: 500, color: "#333" }}>
                  {job.name}
                </div>
                <div style={{ fontSize: "11px", color: "#888", marginTop: "1px" }}>
                  {job.company}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// --- Job Modal ---

function JobModal({
  jobs,
  selectedJobId,
  onSelect,
  candidateCount,
  onAdd,
  onClose
}: {
  jobs: RFJob[]
  selectedJobId: number | null
  onSelect: (id: number | null) => void
  candidateCount: number
  onAdd: () => void
  onClose: () => void
}) {
  const [search, setSearch] = useState("")
  const searchRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    setTimeout(() => searchRef.current?.focus(), 0)
  }, [])

  const filtered = search
    ? jobs.filter((j) => {
        const q = search.toLowerCase()
        return j.name.toLowerCase().includes(q) || j.company.toLowerCase().includes(q)
      })
    : jobs

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        backgroundColor: "rgba(0,0,0,0.4)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 100,
        padding: "16px"
      }}>
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          backgroundColor: "#fff",
          borderRadius: "12px",
          width: "100%",
          maxWidth: "360px",
          maxHeight: "80vh",
          display: "flex",
          flexDirection: "column" as const,
          boxShadow: "0 8px 32px rgba(0,0,0,0.2)"
        }}>
        <div style={{ padding: "16px 16px 12px", borderBottom: "1px solid #eee" }}>
          <h3 style={{ margin: 0, fontSize: "15px", fontWeight: 600, color: "#333" }}>
            Assign to Job
          </h3>
          <p style={{ margin: "4px 0 0", fontSize: "12px", color: "#888" }}>
            {candidateCount} candidate{candidateCount !== 1 ? "s" : ""} will be added
          </p>
        </div>
        <div style={{ padding: "12px 16px 8px" }}>
          <input
            ref={searchRef}
            type="text"
            placeholder="Search jobs..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{
              width: "100%",
              padding: "8px 10px",
              border: "1px solid #ddd",
              borderRadius: "6px",
              fontSize: "13px",
              outline: "none",
              boxSizing: "border-box" as const
            }}
            onFocus={(e) => { e.target.style.borderColor = "#0a66c2" }}
            onBlur={(e) => { e.target.style.borderColor = "#ddd" }}
          />
        </div>
        <div style={{ flex: 1, overflowY: "auto" as const, padding: "0 8px" }}>
          {filtered.length === 0 ? (
            <div style={{ padding: "16px", fontSize: "13px", color: "#999", textAlign: "center" as const }}>
              No jobs found
            </div>
          ) : filtered.map((job) => (
            <div
              key={job.id}
              onClick={() => onSelect(job.id)}
              style={{
                padding: "10px 12px",
                cursor: "pointer",
                backgroundColor: job.id === selectedJobId ? "#e8f0fe" : "#fff",
                borderRadius: "6px",
                marginBottom: "2px",
                border: job.id === selectedJobId ? "1px solid #0a66c2" : "1px solid transparent",
                transition: "background-color 0.1s"
              }}
              onMouseEnter={(e) => {
                if (job.id !== selectedJobId) e.currentTarget.style.backgroundColor = "#f5f5f5"
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = job.id === selectedJobId ? "#e8f0fe" : "#fff"
              }}>
              <div style={{ fontSize: "13px", fontWeight: 500, color: "#333" }}>
                {job.name}
              </div>
              <div style={{ fontSize: "11px", color: "#888", marginTop: "1px" }}>
                {job.company}
              </div>
            </div>
          ))}
        </div>
        <div style={{
          padding: "12px 16px",
          borderTop: "1px solid #eee",
          display: "flex",
          gap: "8px"
        }}>
          <button
            onClick={onClose}
            style={{
              flex: 1,
              padding: "10px",
              border: "1px solid #ddd",
              borderRadius: "8px",
              backgroundColor: "#fff",
              fontSize: "13px",
              cursor: "pointer",
              color: "#555"
            }}>
            Cancel
          </button>
          <button
            onClick={onAdd}
            disabled={!selectedJobId}
            style={{
              flex: 1,
              padding: "10px",
              border: "none",
              borderRadius: "8px",
              backgroundColor: selectedJobId ? "#0a66c2" : "#ccc",
              color: "#fff",
              fontSize: "13px",
              fontWeight: 600,
              cursor: selectedJobId ? "pointer" : "not-allowed"
            }}>
            Add to Job
          </button>
        </div>
      </div>
    </div>
  )
}

// --- Candidate List ---

function CandidateList({ candidates }: { candidates: Candidate[] }) {
  return (
    <div style={styles.candidateList}>
      <p style={styles.sectionTitle}>Selected Candidates</p>
      {candidates.map((c, i) => (
        <div key={i} style={styles.candidateCard}>
          <div style={styles.candidateHeader}>
            {c.photoUrl && (
              <img src={c.photoUrl} alt={c.fullName} style={styles.candidatePhoto} />
            )}
            <div style={styles.candidateInfo}>
              <p style={styles.candidateName}>{c.fullName}</p>
              <p style={styles.candidateDetail}>{c.headline}</p>
              <p style={styles.candidateDetail}>
                {c.location}
                {c.industry ? ` · ${c.industry}` : ""}
              </p>
            </div>
          </div>
          <div style={styles.candidateMeta}>
            {c.pipelineStatus && (
              <span style={styles.statusBadge}>{c.pipelineStatus}</span>
            )}
            {c.connectionDegree && (
              <span style={styles.degreeBadge}>
                {c.connectionDegree}
                {c.connectionDegree === 1
                  ? "st"
                  : c.connectionDegree === 2
                    ? "nd"
                    : c.connectionDegree === 3
                      ? "rd"
                      : "th"}
              </span>
            )}
            <span style={styles.metaText}>
              {c.experience.length} exp
              {c.totalExperienceCount > c.experience.length
                ? ` (${c.totalExperienceCount} total)`
                : ""}
              {c.education.length > 0 ? ` · ${c.education.length} edu` : ""}
            </span>
          </div>
        </div>
      ))}
    </div>
  )
}

// --- Styles ---

const styles: Record<string, React.CSSProperties> = {
  container: {
    padding: "24px 16px",
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: "20px",
    minHeight: "100vh",
    boxSizing: "border-box"
  },
  statusCentered: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    textAlign: "center",
    marginTop: "40px",
    gap: "8px"
  },
  statusIcon: {
    marginBottom: "4px",
    opacity: 0.8
  },
  statusText: {
    margin: 0,
    fontSize: "14px",
    fontWeight: 500,
    color: "#333"
  },
  statusSubtext: {
    margin: 0,
    fontSize: "12px",
    color: "#888",
    maxWidth: "220px",
    lineHeight: "1.4"
  },
  syncButton: {
    padding: "10px 20px",
    backgroundColor: "#0a66c2",
    color: "white",
    border: "none",
    borderRadius: "20px",
    fontSize: "14px",
    fontWeight: 500,
    cursor: "pointer",
    width: "100%",
    maxWidth: "280px",
    transition: "background-color 0.15s"
  },
  spinner: {
    width: "28px",
    height: "28px",
    border: "3px solid #e0e0e0",
    borderTopColor: "#0a66c2",
    borderRadius: "50%",
    animation: "spin 0.8s linear infinite",
    marginBottom: "4px"
  },
  dropZone: {
    border: "2px dashed #ccc",
    borderRadius: "8px",
    padding: "20px",
    textAlign: "center" as const,
    cursor: "pointer",
    transition: "border-color 0.15s, background-color 0.15s"
  },
  dropZoneText: {
    margin: 0,
    fontSize: "13px",
    fontWeight: 500,
    color: "#444"
  },
  dropZoneSubtext: {
    margin: "4px 0 0 0",
    fontSize: "11px",
    color: "#999"
  },
  errorText: {
    margin: "8px 0 0 0",
    fontSize: "12px",
    color: "#e74c3c",
    lineHeight: "1.4"
  },
  reviewContainer: {
    width: "100%"
  },
  reviewHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: "8px"
  },
  reviewSummary: {
    margin: 0,
    fontSize: "11px",
    color: "#888"
  },
  tableWrapper: {
    width: "100%",
    overflowX: "auto" as const
  },
  table: {
    width: "100%",
    borderCollapse: "collapse" as const,
    fontSize: "11px"
  },
  th: {
    padding: "6px 8px",
    fontSize: "10px",
    fontWeight: 600,
    color: "#888",
    textTransform: "uppercase" as const,
    borderBottom: "1px solid #ddd"
  },
  td: {
    padding: "6px 8px",
    borderBottom: "1px solid #eee",
    verticalAlign: "middle" as const
  },
  tdName: {
    fontWeight: 500,
    color: "#333",
    fontSize: "12px"
  },
  tdDetail: {
    color: "#666",
    fontSize: "11px"
  },
  tdLink: {
    color: "#0a66c2",
    textDecoration: "none",
    fontSize: "11px",
    wordBreak: "break-all" as const
  },
  candidateList: {
    width: "100%",
    display: "flex",
    flexDirection: "column",
    gap: "8px"
  },
  sectionTitle: {
    margin: 0,
    fontSize: "13px",
    fontWeight: 600,
    color: "#555",
    textTransform: "uppercase" as const,
    letterSpacing: "0.5px"
  },
  candidateCard: {
    padding: "10px 12px",
    backgroundColor: "#f8f9fa",
    borderRadius: "8px",
    border: "1px solid #e8e8e8"
  },
  candidateHeader: {
    display: "flex",
    gap: "10px",
    alignItems: "flex-start"
  },
  candidatePhoto: {
    width: "36px",
    height: "36px",
    borderRadius: "50%",
    objectFit: "cover" as const,
    flexShrink: 0
  },
  candidateInfo: {
    flex: 1,
    minWidth: 0
  },
  candidateName: {
    margin: 0,
    fontSize: "13px",
    fontWeight: 600,
    color: "#333"
  },
  candidateDetail: {
    margin: "2px 0 0 0",
    fontSize: "11px",
    color: "#666",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap" as const
  },
  candidateMeta: {
    display: "flex",
    gap: "6px",
    alignItems: "center",
    marginTop: "6px",
    flexWrap: "wrap" as const
  },
  statusBadge: {
    fontSize: "10px",
    padding: "2px 6px",
    borderRadius: "10px",
    backgroundColor: "#e8f0fe",
    color: "#0a66c2",
    fontWeight: 500
  },
  degreeBadge: {
    fontSize: "10px",
    padding: "2px 6px",
    borderRadius: "10px",
    backgroundColor: "#f0f0f0",
    color: "#555",
    fontWeight: 500
  },
  metaText: {
    fontSize: "10px",
    color: "#888"
  },
  inputLabel: {
    display: "block",
    fontSize: "11px",
    fontWeight: 600,
    color: "#555",
    textTransform: "uppercase" as const,
    letterSpacing: "0.5px",
    marginBottom: "4px"
  },
  urlInput: {
    width: "100%",
    padding: "8px 10px",
    fontSize: "13px",
    border: "1px solid #ddd",
    borderRadius: "6px",
    boxSizing: "border-box" as const,
    fontFamily: "monospace",
    outline: "none"
  },
  resetBar: {
    width: "100%",
    display: "flex",
    justifyContent: "flex-end",
    marginBottom: "-12px"
  },
  resetButton: {
    background: "#fff",
    border: "1px solid #e0e0e0",
    borderRadius: "12px",
    padding: "4px 12px",
    fontSize: "11px",
    fontWeight: 500,
    color: "#888",
    cursor: "pointer"
  }
}

export default SidePanel
