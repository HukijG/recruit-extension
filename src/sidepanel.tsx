import { sendToBackground } from "@plasmohq/messaging"
import { useStorage } from "@plasmohq/storage/hook"
import Papa from "papaparse"
import { useCallback, useEffect, useRef, useState } from "react"

const LOG_PREFIX = "[LR-Scraper][SidePanel]"

// --- Types ---

type WorkflowState =
  | "not_on_pipeline"
  | "no_selection"
  | "profiles_selected"
  | "scraping"
  | "scraped"
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

interface ScrapedCandidate {
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
  scraped: ScrapedCandidate
  csv: CsvRow
  status: MatchStatus
  normalizedScraped: string
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

  console.log(
    LOG_PREFIX,
    "CSV parsed:",
    result.data.length,
    "rows,",
    result.errors.length,
    "errors"
  )
  if (result.errors.length > 0) {
    console.warn(LOG_PREFIX, "CSV parse errors:", result.errors)
  }
  if (result.data.length > 0) {
    console.log(LOG_PREFIX, "CSV first row keys:", Object.keys(result.data[0]))
  }

  return result.data.map((row) => ({
    firstName: (row["First Name"] ?? "").trim(),
    lastName: (row["Last Name"] ?? "").trim(),
    currentCompany: (row["Current Company"] ?? "").trim(),
    profileUrl: (row["Profile URL"] ?? "").trim()
  }))
}

// --- Matching ---

function findBestCsvMatch(
  scraped: ScrapedCandidate,
  remaining: { csv: CsvRow; originalIndex: number }[]
): { csv: CsvRow; originalIndex: number; score: number } | null {
  const sName = normalize(scraped.fullName)
  // Get company from first current experience entry, or empty
  const sCompany = normalize(
    scraped.experience.find((e) => e.isCurrent)?.company ?? ""
  )

  let bestMatch: { csv: CsvRow; originalIndex: number; score: number } | null = null

  for (const candidate of remaining) {
    const cName = normalize(`${candidate.csv.firstName} ${candidate.csv.lastName}`)
    const cCompany = normalize(candidate.csv.currentCompany)

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
      bestMatch = { ...candidate, score }
    }
  }

  return bestMatch
}

function matchCandidates(
  scraped: ScrapedCandidate[],
  csv: CsvRow[]
): MatchedCandidate[] {
  const remaining = csv.map((c, i) => ({ csv: c, originalIndex: i }))
  const matched: MatchedCandidate[] = []

  for (const s of scraped) {
    const best = findBestCsvMatch(s, remaining)

    if (best) {
      // Remove from remaining so it can't be matched again
      const idx = remaining.findIndex((r) => r.originalIndex === best.originalIndex)
      remaining.splice(idx, 1)

      const normalizedScraped = normalize(s.fullName)
      const normalizedCsv = normalize(`${best.csv.firstName} ${best.csv.lastName}`)
      const nameMatch = normalizedScraped === normalizedCsv

      const status: MatchStatus = nameMatch ? "matched" : "warning"

      console.log(LOG_PREFIX, `Match: "${s.fullName}" → CSV[${best.originalIndex}] "${best.csv.firstName} ${best.csv.lastName}" (score: ${best.score}, ${status})`)

      matched.push({
        scraped: s,
        csv: best.csv,
        status,
        normalizedScraped,
        normalizedCsv,
        checked: true
      })
    } else {
      // No match found
      console.warn(LOG_PREFIX, `No CSV match for: "${s.fullName}"`)
      matched.push({
        scraped: s,
        csv: { firstName: "", lastName: "", currentCompany: "", profileUrl: "" },
        status: "error",
        normalizedScraped: normalize(s.fullName),
        normalizedCsv: "",
        checked: false
      })
    }
  }

  const matchedCount = matched.filter((m) => m.status === "matched").length
  const warningCount = matched.filter((m) => m.status === "warning").length
  const errorCount = matched.filter((m) => m.status === "error").length
  console.log(LOG_PREFIX, `Matching complete: ${matchedCount} matched, ${warningCount} warnings, ${errorCount} unmatched`)

  return matched
}

// --- Payload & Send ---

function buildPayload(m: MatchedCandidate): CandidatePayload {
  return {
    linkedinUrl: m.csv.profileUrl,
    internalTalentUrl: m.scraped.internalTalentUrl,
    fullName: m.scraped.fullName,
    headline: m.scraped.headline,
    location: m.scraped.location,
    industry: m.scraped.industry,
    photoUrl: m.scraped.photoUrl,
    connectionDegree: m.scraped.connectionDegree,
    pipelineStatus: m.scraped.pipelineStatus,
    experience: m.scraped.experience,
    totalExperienceCount: m.scraped.totalExperienceCount,
    education: m.scraped.education
  }
}

async function sendCandidatesBatch(
  middlewareUrl: string,
  candidates: CandidatePayload[],
  secret?: string
): Promise<{ ok: boolean; data?: SendCandidatesResponse; error?: string }> {
  console.log(LOG_PREFIX, `Sending batch of ${candidates.length} candidates via background`)
  try {
    const result = await sendToBackground({
      name: "sendCandidates",
      body: { middlewareUrl, candidates, secret }
    })
    return result ?? { ok: false, error: "No response from background" }
  } catch (err: any) {
    const msg = err?.message ?? "Send failed"
    console.error(LOG_PREFIX, `Batch send error:`, msg)
    return { ok: false, error: msg }
  }
}

async function addCandidatesToJob(
  middlewareUrl: string,
  rfIds: number[],
  jobId: number,
  secret?: string
): Promise<{ ok: boolean; data?: AddToJobResponse; error?: string }> {
  console.log(LOG_PREFIX, `Adding ${rfIds.length} candidates to job ${jobId} via background`)
  try {
    const result = await sendToBackground({
      name: "addToJob",
      body: { middlewareUrl, rfIds, jobId, secret }
    })
    return result ?? { ok: false, error: "No response from background" }
  } catch (err: any) {
    const msg = err?.message ?? "Add to job failed"
    console.error(LOG_PREFIX, `Add to job error:`, msg)
    return { ok: false, error: msg }
  }
}

// --- Inject spinner animation ---

const spinnerStyle = document.createElement("style")
spinnerStyle.textContent = `@keyframes spin { to { transform: rotate(360deg); } }`
if (!document.querySelector("[data-lr-scraper-styles]")) {
  spinnerStyle.setAttribute("data-lr-scraper-styles", "")
  document.head.appendChild(spinnerStyle)
}

// --- Main Component ---

function SidePanel() {
  const [workflowState, setWorkflowState] =
    useState<WorkflowState>("not_on_pipeline")
  const [pageInfo, setPageInfo] = useState<PageInfo | null>(null)
  const [scrapedCandidates, setScrapedCandidates] = useState<
    ScrapedCandidate[]
  >([])
  const [scrapeStatus, setScrapeStatus] = useState("")
  const [matchedCandidates, setMatchedCandidates] = useState<
    MatchedCandidate[]
  >([])
  const [csvError, setCsvError] = useState("")
  const [csvFileName, setCsvFileName] = useState("")
  const [middlewareUrl, setMiddlewareUrl] = useStorage<string>("middlewareUrl", "")
  const [extensionSecret, setExtensionSecret] = useStorage<string>("extensionSecret", "")
  const [candidateResults, setCandidateResults] = useState<CandidateResult[]>([])
  const [sendProgress, setSendProgress] = useState("")
  const [jobs, setJobs] = useState<RFJob[]>([])
  const [rfIds, setRfIds] = useState<number[]>([])
  const [selectedJobId, setSelectedJobId] = useState<number | null>(null)
  const [jobAddResult, setJobAddResult] = useState<string>("")
  const [showJobModal, setShowJobModal] = useState(false)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const pollPageInfo = useCallback(async () => {
    try {
      const response = await sendToBackground<any, PageInfo>({
        name: "getPageInfo"
      })

      if (!response || !response.isPipelinePage) {
        setPageInfo(null)
        // Don't blow away state if we have scraped/matched data
        setWorkflowState((prev) => {
          if (
            prev === "scraping" ||
            prev === "scraped" ||
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
            prev === "scraping" ||
            prev === "scraped" ||
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
            prev === "scraping" ||
            prev === "scraped" ||
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
          prev === "scraping" ||
          prev === "scraped" ||
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

  useEffect(() => {
    console.log(LOG_PREFIX, "Starting page info polling")
    pollPageInfo()
    pollRef.current = setInterval(pollPageInfo, 500)
    return () => {
      if (pollRef.current) clearInterval(pollRef.current)
    }
  }, [pollPageInfo])

  useEffect(() => {
    const onActivated = () => {
      console.log(LOG_PREFIX, "Tab changed, polling immediately")
      pollPageInfo()
    }
    chrome.tabs.onActivated.addListener(onActivated)
    chrome.tabs.onUpdated.addListener(onActivated)
    return () => {
      chrome.tabs.onActivated.removeListener(onActivated)
      chrome.tabs.onUpdated.removeListener(onActivated)
    }
  }, [pollPageInfo])

  const resetTransientState = useCallback(() => {
    setScrapedCandidates([])
    setScrapeStatus("")
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

  const handleScrape = useCallback(async () => {
    console.log(LOG_PREFIX, "Scrape started — clearing transient state")
    // Full reset of transient state so each scrape starts from the same baseline
    // a fresh page+extension load gives us. middlewareUrl/extensionSecret are
    // useStorage-backed and intentionally preserved.
    resetTransientState()
    setWorkflowState("scraping")
    setScrapeStatus("Scrolling page to load all candidates...")

    // Fetch fresh page info right now instead of relying on potentially stale polled state
    let freshPageInfo: PageInfo | null = null
    try {
      freshPageInfo = await sendToBackground<any, PageInfo>({ name: "getPageInfo" })
    } catch {}
    const info = freshPageInfo ?? pageInfo
    const targetCount = info?.totalOnPage || info?.checkedCount || 25
    console.log(LOG_PREFIX, "Scroll target count:", targetCount, "(totalOnPage:", info?.totalOnPage, "checkedCount:", info?.checkedCount, ")")

    const scrollResult = await sendToBackground({
      name: "scrollToBottom",
      body: { targetCount }
    })

    if (!scrollResult?.success) {
      console.error(LOG_PREFIX, "scrollToBottom failed:", scrollResult)
      setScrapeStatus("Failed to scroll page. Try again.")
      setWorkflowState("profiles_selected")
      return
    }

    console.log(
      LOG_PREFIX,
      "Scroll complete. Rows loaded:",
      scrollResult.totalRowsLoaded
    )
    setScrapeStatus("Extracting candidate data...")

    const scrapeResult = await sendToBackground({
      name: "getSelectedCandidates"
    })

    if (!scrapeResult) {
      console.error(LOG_PREFIX, "getSelectedCandidates failed")
      setScrapeStatus("Failed to extract candidates. Try again.")
      setWorkflowState("profiles_selected")
      return
    }

    console.log(
      LOG_PREFIX,
      "Scrape complete.",
      scrapeResult.scrapedCount,
      "candidates scraped"
    )

    setScrapedCandidates(scrapeResult.candidates)
    setScrapeStatus(
      `Scraped ${scrapeResult.scrapedCount} candidate${scrapeResult.scrapedCount !== 1 ? "s" : ""}`
    )
    setWorkflowState("scraped")
  }, [pageInfo, resetTransientState])

  const handleCsvFile = useCallback(
    (file: File) => {
      setCsvError("")
      setCsvFileName(file.name)
      console.log(LOG_PREFIX, "CSV file selected:", file.name)

      const reader = new FileReader()
      reader.onload = (e) => {
        const text = e.target?.result as string
        if (!text) {
          setCsvError("Could not read file")
          return
        }

        const csvRows = parseCsv(text)
        console.log(LOG_PREFIX, "CSV rows:", csvRows.length, "Scraped:", scrapedCandidates.length)

        if (csvRows.length < scrapedCandidates.length) {
          setCsvError(
            `CSV has fewer rows (${csvRows.length}) than scraped candidates (${scrapedCandidates.length}). Some candidates won't have a match.`
          )
        }

        const matched = matchCandidates(scrapedCandidates, csvRows)
        setMatchedCandidates(matched)
        setWorkflowState("csv_matched")

        const warnings = matched.filter((m) => m.status === "warning").length
        console.log(
          LOG_PREFIX,
          "Matching complete.",
          matched.length,
          "pairs,",
          warnings,
          "warnings"
        )
      }
      reader.readAsText(file)
    },
    [scrapedCandidates]
  )

  const toggleCandidate = useCallback((index: number) => {
    setMatchedCandidates((prev) =>
      prev.map((m, i) =>
        i === index ? { ...m, checked: !m.checked } : m
      )
    )
  }, [])

  const handleSend = useCallback(async () => {
    if (!middlewareUrl?.trim()) return

    const toSend = matchedCandidates.filter((m) => m.checked)
    if (toSend.length === 0) return

    console.log(LOG_PREFIX, `Sending batch of ${toSend.length} candidates to ${middlewareUrl}`)
    setWorkflowState("sending")
    setCandidateResults([])
    setJobs([])
    setRfIds([])
    setSelectedJobId(null)
    setJobAddResult("")
    setSendProgress(`Sending ${toSend.length} candidates...`)

    const payloads = toSend.map(buildPayload)
    const result = await sendCandidatesBatch(middlewareUrl, payloads, extensionSecret)

    if (!result.ok || !result.data) {
      setSendProgress(`Failed — ${result.error}`)
      setCandidateResults([])
      setWorkflowState("complete")
      return
    }

    const { data } = result
    console.log(LOG_PREFIX, `Created: ${data.created}, Updated: ${data.updated}, Skipped: ${data.skipped}, Errors: ${data.errors}`)

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
  }, [matchedCandidates, middlewareUrl, extensionSecret])

  const handleAddToJob = useCallback(async () => {
    if (!middlewareUrl?.trim() || !selectedJobId || rfIds.length === 0) return

    const job = jobs.find((j) => j.id === selectedJobId)
    console.log(LOG_PREFIX, `Adding ${rfIds.length} candidates to job ${selectedJobId} (${job?.name})`)
    setWorkflowState("adding_to_job")
    setJobAddResult("")

    const result = await addCandidatesToJob(middlewareUrl, rfIds, selectedJobId, extensionSecret)

    if (!result.ok || !result.data) {
      setJobAddResult(`Failed — ${result.error}`)
      setWorkflowState("complete")
      return
    }

    const { data } = result
    console.log(LOG_PREFIX, "Add to job raw response:", JSON.stringify(data))
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
    console.log(LOG_PREFIX, `Added: ${added}, Already in job: ${alreadyInJob}, Errors: ${errors}`)
    const jobName = job?.name ?? "job"
    const parts: string[] = []
    if (added) parts.push(`${added} added to ${jobName}`)
    if (alreadyInJob) parts.push(`${alreadyInJob} already in job`)
    if (errors) parts.push(`${errors} failed`)
    setJobAddResult(parts.join(", ") || `0 added to ${jobName}`)
    setWorkflowState("job_added")
  }, [middlewareUrl, extensionSecret, selectedJobId, rfIds, jobs])

  const handleReset = useCallback(() => {
    resetTransientState()
    setPageInfo(null)
    setWorkflowState("not_on_pipeline")
  }, [resetTransientState])

  const showResetButton =
    workflowState === "scraped" ||
    workflowState === "csv_matched" ||
    workflowState === "complete" ||
    workflowState === "job_added"

  const checkedCount = matchedCandidates.filter((m) => m.checked).length
  const canSend = !!middlewareUrl?.trim() && checkedCount > 0

  return (
    <div style={styles.container}>
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
        scrapeStatus={scrapeStatus}
        scrapedCount={scrapedCandidates.length}
      />

      {workflowState === "profiles_selected" && (
        <button onClick={handleScrape} style={styles.scrapeButton}>
          Scrape {pageInfo?.checkedCount} Selected Profile
          {pageInfo?.checkedCount !== 1 ? "s" : ""}
        </button>
      )}

      {workflowState === "scraped" && scrapedCandidates.length > 0 && (
        <>
          <CsvDropZone
            onFile={handleCsvFile}
            fileName={csvFileName}
            error={csvError}
          />
          <CandidateList candidates={scrapedCandidates} />
          <DebugJsonView
            label="scraped data"
            data={scrapedCandidates}
          />
        </>
      )}

      {workflowState === "csv_matched" && matchedCandidates.length > 0 && (
        <>
          <MiddlewareUrlInput url={middlewareUrl} onUrlChange={setMiddlewareUrl} secret={extensionSecret} onSecretChange={setExtensionSecret} />
          <ReviewTable
            matched={matchedCandidates}
            onToggle={toggleCandidate}
          />
          <button
            onClick={handleSend}
            disabled={!canSend}
            style={{
              ...styles.scrapeButton,
              backgroundColor: canSend ? "#27ae60" : "#ccc",
              cursor: canSend ? "pointer" : "not-allowed"
            }}>
            Send {checkedCount} Candidate{checkedCount !== 1 ? "s" : ""}
          </button>
          <DebugJsonView
            label="match debug"
            data={matchedCandidates.map((m, i) => ({
              index: i,
              scrapedName: m.normalizedScraped,
              csvName: m.normalizedCsv,
              status: m.status,
              profileUrl: m.csv.profileUrl
            }))}
          />
          <DebugJsonView
            label="full matched data"
            data={matchedCandidates}
          />
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
                style={{ ...styles.scrapeButton, backgroundColor: "#e67e22" }}>
                Retry
              </button>
              <button
                onClick={() => setWorkflowState("csv_matched")}
                style={{ ...styles.scrapeButton, backgroundColor: "#888" }}>
                Back to Review
              </button>
            </>
          )}
          {jobs.length > 0 && rfIds.length > 0 && (
            <button
              onClick={() => setShowJobModal(true)}
              style={{
                ...styles.scrapeButton,
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
              ...styles.scrapeButton,
              backgroundColor: "#0a66c2",
              marginTop: "12px"
            }}>
            OK
          </button>
        </div>
      )}
    </div>
  )
}

// --- Status Display ---

function StatusDisplay({
  state,
  pageInfo,
  scrapeStatus,
  scrapedCount
}: {
  state: WorkflowState
  pageInfo: PageInfo | null
  scrapeStatus: string
  scrapedCount: number
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
        <p style={styles.statusText}>Select profiles to scrape</p>
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
        <p style={styles.statusSubtext}>Ready to scrape</p>
      </div>
    )
  }

  if (state === "scraping") {
    return (
      <div style={styles.statusCentered}>
        <div style={styles.spinner} />
        <p style={styles.statusText}>Scraping profiles...</p>
        <p style={styles.statusSubtext}>{scrapeStatus}</p>
      </div>
    )
  }

  if (state === "scraped") {
    return (
      <div style={styles.statusCentered}>
        <div style={styles.statusIcon}>
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#27ae60" strokeWidth="1.5">
            <path d="M22 11.08V12a10 10 0 11-5.93-9.14" strokeLinecap="round" />
            <path d="M22 4L12 14.01l-3-3" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
        <p style={styles.statusText}>
          {scrapedCount} candidate{scrapedCount !== 1 ? "s" : ""} scraped
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
                    <span style={styles.tdName}>{m.scraped.fullName}</span>
                  </td>
                  <td style={styles.td}>
                    <span style={styles.tdDetail}>
                      {m.scraped.experience[0]?.title || m.scraped.headline}
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
                        title={`Scraped: "${m.normalizedScraped}" vs CSV: "${m.normalizedCsv}"`}>
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

// --- Middleware URL Input ---

function MiddlewareUrlInput({
  url,
  onUrlChange,
  secret,
  onSecretChange
}: {
  url: string
  onUrlChange: (url: string) => void
  secret: string
  onSecretChange: (secret: string) => void
}) {
  return (
    <div style={{ width: "100%" }}>
      <label style={styles.inputLabel}>Middleware URL</label>
      <input
        type="url"
        value={url ?? ""}
        onChange={(e) => onUrlChange(e.target.value)}
        placeholder="https://your-worker.example.com"
        style={styles.urlInput}
      />
      <label style={{ ...styles.inputLabel, marginTop: "8px" }}>Extension Secret</label>
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

function CandidateList({ candidates }: { candidates: ScrapedCandidate[] }) {
  return (
    <div style={styles.candidateList}>
      <p style={styles.sectionTitle}>Scraped Candidates</p>
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

// --- Debug JSON View ---

function DebugJsonView({ label, data }: { label: string; data: any }) {
  const [isOpen, setIsOpen] = useState(false)

  return (
    <div style={styles.debugContainer}>
      <button onClick={() => setIsOpen(!isOpen)} style={styles.debugToggle}>
        {isOpen ? "Hide" : "Show"} {label} (JSON)
      </button>
      {isOpen && (
        <pre style={styles.debugPre}>{JSON.stringify(data, null, 2)}</pre>
      )}
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
  scrapeButton: {
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
  debugContainer: {
    width: "100%",
    marginTop: "8px"
  },
  debugToggle: {
    background: "none",
    border: "1px solid #ddd",
    borderRadius: "6px",
    padding: "6px 12px",
    fontSize: "11px",
    color: "#666",
    cursor: "pointer",
    width: "100%"
  },
  debugPre: {
    marginTop: "8px",
    padding: "10px",
    backgroundColor: "#1e1e1e",
    color: "#d4d4d4",
    borderRadius: "6px",
    fontSize: "10px",
    overflow: "auto",
    maxHeight: "400px",
    whiteSpace: "pre-wrap" as const,
    wordBreak: "break-all" as const
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
