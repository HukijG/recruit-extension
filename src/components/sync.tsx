import { sendToBackground } from "@plasmohq/messaging"
import { useStorage } from "@plasmohq/storage/hook"
import Papa from "papaparse"
import { useCallback, useEffect, useRef, useState } from "react"

import { localStore } from "~lib/constants"
import { welcomeStyles } from "~lib/styles/welcome"
import type {
  AddToJobResponse,
  Candidate,
  CandidatePayload,
  CandidateResult,
  CsvRow,
  MatchedCandidate,
  MatchStatus,
  PageInfo,
  RFJob,
  SendCandidatesResponse,
  WorkflowState
} from "~lib/types"

// --- Normalization ---

export function normalize(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // strip combining marks
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ")
}

// --- CSV Parsing ---

export function parseCsv(text: string): CsvRow[] {
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

export function matchCandidates(
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

export function buildPayload(m: MatchedCandidate): CandidatePayload {
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

export async function sendCandidatesBatch(
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

export async function addCandidatesToJob(
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

// --- Greeting heading with inline editable name ---

export function EditableNameHeading({
  name,
  onChange
}: {
  name: string
  onChange: (next: string) => void
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState("")
  const [nameHover, setNameHover] = useState(false)
  const [inputFocus, setInputFocus] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const startEdit = () => {
    setDraft(name)
    setEditing(true)
    setTimeout(() => inputRef.current?.focus(), 0)
  }

  const confirmEdit = () => {
    const trimmed = draft.trim()
    if (!trimmed) {
      // empty submission reverts to the prior name with no change
      setEditing(false)
      return
    }
    onChange(trimmed)
    setEditing(false)
  }

  const cancelEdit = () => {
    setEditing(false)
    setDraft("")
  }

  if (editing) {
    return (
      <h1 style={styles.greetingTitle}>
        <span>Hi, </span>
        <input
          ref={inputRef}
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") confirmEdit()
            else if (e.key === "Escape") cancelEdit()
          }}
          onFocus={() => setInputFocus(true)}
          onBlur={() => {
            setInputFocus(false)
            confirmEdit()
          }}
          style={{
            ...styles.greetingNameInput,
            borderBottomColor: inputFocus ? "#0a66c2" : "#9bb6dc"
          }}
        />
        <span>!</span>
      </h1>
    )
  }

  return (
    <h1 style={styles.greetingTitle}>
      <span>Hi, </span>
      <span
        onClick={startEdit}
        onMouseEnter={() => setNameHover(true)}
        onMouseLeave={() => setNameHover(false)}
        style={{
          ...styles.greetingName,
          backgroundColor: nameHover ? "#c5d8f1" : "#e8f0fe"
        }}
        title="Click to edit your name">
        {name}
      </span>
      <span>!</span>
    </h1>
  )
}

// --- First-time setup greeting (when consultant name is unset) ---

export function NameSetupGreeting({
  onSetName
}: {
  onSetName: (name: string) => void
}) {
  const [draft, setDraft] = useState("")
  const [inputFocus, setInputFocus] = useState(false)
  const [buttonHover, setButtonHover] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const canSubmit = draft.trim().length > 0
  const submit = () => {
    if (!canSubmit) return
    onSetName(draft.trim())
  }

  return (
    <div style={welcomeStyles.greetingHero}>
      <span style={{ ...welcomeStyles.wave, ...welcomeStyles.waveLarge }} aria-hidden="true">
        👋
      </span>
      <h1 style={welcomeStyles.welcomeTitle}>
        Welcome <span style={welcomeStyles.welcomeAccent}>aboard</span>
      </h1>
      <p style={welcomeStyles.greetingBody}>
        Tell us your first name so the candidates you sync get attributed to{" "}you in <em style={welcomeStyles.greetingEmphasis}>Recruiterflow.</em>
      </p>
      <div style={styles.nameSetupRow}>
        <input
          ref={inputRef}
          type="text"
          placeholder="First name"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && canSubmit) submit()
          }}
          onFocus={() => setInputFocus(true)}
          onBlur={() => setInputFocus(false)}
          style={{
            ...styles.nameSetupInput,
            borderColor: inputFocus ? "#0a66c2" : "#d8dee5",
            boxShadow: inputFocus ? "0 0 0 3px rgba(10, 102, 194, 0.15)" : "none"
          }}
        />
        <button
          onClick={submit}
          disabled={!canSubmit}
          onMouseEnter={() => setButtonHover(true)}
          onMouseLeave={() => setButtonHover(false)}
          style={{
            ...styles.nameSetupButton,
            opacity: canSubmit ? 1 : 0.5,
            cursor: canSubmit ? "pointer" : "not-allowed",
            backgroundColor:
              canSubmit && buttonHover ? "#084e9c" : "#0a66c2",
            transform: canSubmit && buttonHover ? "translateY(-1px)" : "none",
            boxShadow:
              canSubmit && buttonHover
                ? "0 4px 10px rgba(10, 102, 194, 0.25)"
                : "0 1px 3px rgba(10, 102, 194, 0.18)"
          }}>
          Set
        </button>
      </div>
      <p style={welcomeStyles.greetingHint}>You can change this anytime.</p>
    </div>
  )
}

// --- Status Display ---

export function StatusDisplay({
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
  const [name, setName] = useStorage<string>(
    { key: "consultantFirstName", instance: localStore },
    ""
  )
  const trimmedName = (name ?? "").trim()

  if (state === "not_on_pipeline") {
    if (!trimmedName) {
      return <NameSetupGreeting onSetName={setName} />
    }
    return (
      <div style={welcomeStyles.greetingHero}>
        <span style={welcomeStyles.wave} aria-hidden="true">👋</span>
        <EditableNameHeading name={trimmedName} onChange={setName} />
        <p style={welcomeStyles.greetingBody}>
          Open a LinkedIn Recruiter project to sync profiles to{" "}
          <em style={welcomeStyles.greetingEmphasis}>Recruiterflow</em>.
        </p>
      </div>
    )
  }

  if (state === "no_selection") {
    return (
      <div style={{ ...styles.statusCentered, marginTop: "70px" }}>
        <div style={styles.statusIcon}>
          <svg
            width="48"
            height="48"
            viewBox="0 0 48 48"
            fill="none"
            stroke="#0a66c2"
            strokeWidth="1.5"
            overflow="visible">
            {/* sparks layer — anchored at the box centre, each rotated to its angle */}
            <g transform="translate(24, 24)">
              {[0, 45, 90, 135, 180, 225, 270, 315].map((angle) => (
                <g key={angle} transform={`rotate(${angle})`}>
                  <line
                    className="lr-spark"
                    x1="0"
                    y1="-15"
                    x2="0"
                    y2="-21"
                    stroke="#0a66c2"
                    strokeWidth="1.6"
                    strokeLinecap="round"
                  />
                </g>
              ))}
            </g>
            {/* checkbox + checkmark, top-left of box at (12, 12) */}
            <g transform="translate(12, 12)">
              <rect
                className="lr-checkbox-rect"
                x="0"
                y="0"
                width="24"
                height="24"
                rx="4"
              />
              <path
                className="lr-checkmark-path"
                d="M5.5 12.5 L10 17 L19 7"
                fill="none"
                strokeWidth="2.4"
                strokeLinecap="round"
                strokeLinejoin="round"
                pathLength="30"
              />
            </g>
          </svg>
        </div>
        <p style={styles.statusText}>Select profiles to sync</p>
      </div>
    )
  }

  if (state === "profiles_selected") {
    return (
      <div style={{ ...styles.statusCentered, marginTop: "70px" }}>
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

export function CsvDropZone({
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

export function ReviewTable({
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

export function AuthSecretInput({
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

export function CandidateResultsList({ results }: { results: CandidateResult[] }) {
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

export function JobDropdown({
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

export function JobModal({
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

export function CandidateList({ candidates }: { candidates: Candidate[] }) {
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

export const styles: Record<string, React.CSSProperties> = {
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
  greetingTitle: {
    fontSize: "26px",
    fontWeight: 600,
    color: "#0d0d0d",
    margin: "2px 0",
    lineHeight: 1.25,
    letterSpacing: "-0.02em",
    fontFamily:
      'ui-rounded, "SF Pro Rounded", "SF Pro Display", -apple-system, BlinkMacSystemFont, "Segoe UI Variable Display", "Segoe UI", system-ui, sans-serif',
    display: "inline-flex",
    alignItems: "center",
    flexWrap: "wrap",
    justifyContent: "center",
    gap: "0px"
  },
  greetingSubtle: {
    fontSize: "14px",
    color: "#1b1b1b",
    lineHeight: 1.55,
    margin: 0,
    maxWidth: "260px",
    fontStyle: "italic"
  },
  greetingName: {
    display: "inline-block",
    cursor: "pointer",
    color: "#0d0d0d",
    fontWeight: 800,
    padding: "1px 8px",
    margin: "0 1px",
    borderRadius: "8px",
    transition: "background-color 0.15s ease"
  },
  greetingNameInput: {
    fontSize: "26px",
    fontWeight: 800,
    color: "#0d0d0d",
    border: "none",
    borderBottom: "2px solid #9bb6dc",
    background: "transparent",
    outline: "none",
    width: "120px",
    padding: "1px 4px",
    margin: "0 1px",
    fontFamily: "inherit",
    textAlign: "center",
    letterSpacing: "-0.02em",
    transition: "border-bottom-color 0.15s ease"
  },
  greetingEditIcon: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: "26px",
    height: "26px",
    marginLeft: "8px",
    color: "#0a66c2",
    cursor: "pointer",
    borderRadius: "50%",
    transition: "opacity 0.18s ease, transform 0.18s ease, background-color 0.15s",
    backgroundColor: "rgba(10, 102, 194, 0.10)"
  },
  nameSetupRow: {
    display: "flex",
    gap: "8px",
    marginTop: "16px",
    width: "100%",
    maxWidth: "300px"
  },
  nameSetupInput: {
    flex: 1,
    padding: "11px 16px",
    fontSize: "14px",
    border: "1px solid #d8dee5",
    borderRadius: "10px",
    outline: "none",
    textAlign: "left",
    fontFamily: "inherit",
    boxSizing: "border-box",
    color: "#1a1a1a",
    transition: "border-color 0.15s ease, box-shadow 0.15s ease"
  },
  nameSetupButton: {
    padding: "11px 22px",
    backgroundColor: "#0a66c2",
    color: "#fff",
    border: "none",
    borderRadius: "10px",
    fontSize: "14px",
    fontWeight: 600,
    letterSpacing: "0.01em",
    transition: "background-color 0.15s ease, transform 0.15s ease, box-shadow 0.15s ease"
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
    padding: "10px 10px",
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
  devTestCallButton: {
    padding: "8px 14px",
    backgroundColor: "transparent",
    color: "#7a5b00",
    border: "1px dashed #f1c34c",
    borderRadius: "999px",
    fontSize: "12px",
    fontWeight: 600,
    letterSpacing: "0.02em",
    cursor: "pointer",
    marginTop: "12px"
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
