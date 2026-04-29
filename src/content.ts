import type { PlasmoCSConfig } from "plasmo"

export const config: PlasmoCSConfig = {
  matches: ["https://www.linkedin.com/talent/*"]
}

const LOG_PREFIX = "[LR-Sync][Content]"

console.log(LOG_PREFIX, "Content script loaded on:", window.location.href)

// --- Types ---

interface GetPageInfoResponse {
  isPipelinePage: boolean
  totalOnPage: number
  checkedCount: number
}

interface ScrollToBottomResponse {
  success: boolean
  totalRowsLoaded: number
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

interface GetSelectedCandidatesResponse {
  candidates: Candidate[]
  count: number
}

// --- Page info helpers ---

function isPipelinePage(): boolean {
  return !!document.querySelector("[data-test-show-all-filters-button]")
}

function getTotalOnPage(): number {
  const a11yText = document.querySelector(
    ".profile-list__select-all .a11y-text"
  )
  if (a11yText) {
    const match = a11yText.textContent?.match(/(\d+)/)
    if (match) return parseInt(match[1], 10)
  }
  return 0
}

function getCheckedCount(): number {
  const selectedText = document.querySelector(
    "[data-test-profile-list-num-selected]"
  )
  if (selectedText) {
    const match = selectedText.textContent?.match(/(\d+)/)
    if (match) return parseInt(match[1], 10)
  }
  return 0
}

// --- Scroll to bottom ---

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function countPopulatedRows(): number {
  // A row is "populated" if LinkedIn has rendered its content (not just the shell)
  const rows = document.querySelectorAll(
    "li[data-test-paginated-profile-list-item-container]"
  )
  let count = 0
  for (const li of rows) {
    const name = li.querySelector("[data-test-row-lockup-full-name]")
    if (name && name.textContent?.trim()) {
      count++
    }
  }
  return count
}

async function scrollToLoadAllProfiles(
  targetCount: number
): Promise<ScrollToBottomResponse> {
  // Sync jump to top so the scroll-down loop always covers the whole list
  // regardless of where the user (or LinkedIn's pagination) left the scroll.
  window.scrollTo(0, 0)

  const rows = document.querySelectorAll(
    "li[data-test-paginated-profile-list-item-container]"
  )

  if (rows.length === 0) {
    console.warn(LOG_PREFIX, "scrollToLoadAllProfiles: No profile rows found")
    return { success: false, totalRowsLoaded: 0 }
  }

  const SCROLL_STEP = window.innerHeight * 0.8
  const SCROLL_DELAY_MS = 300
  const MAX_SCROLLS = 50
  const STALL_LIMIT = 3

  // Never try to populate more rows than actually exist in the DOM
  const effectiveTarget = Math.min(targetCount, rows.length)

  console.log(
    LOG_PREFIX,
    "scrollToLoadAllProfiles: Starting.",
    "Total shells:", rows.length,
    "Requested target:", targetCount,
    "Effective target:", effectiveTarget,
    "Initial populated:", countPopulatedRows()
  )

  // Always run the loop — it exits at iter 0 if everything's already populated.
  // The prior "skip if alreadyPopulated >= target" shortcut would falsely fire
  // after pagination when LinkedIn left stale content in the DOM, capturing the
  // old page's data; running through the loop costs nothing in the happy case.
  // lastPopulated init -1 so the first measurement isn't counted as a stall.
  let stalls = 0
  let lastPopulated = -1

  for (let i = 0; i < MAX_SCROLLS; i++) {
    const populated = countPopulatedRows()
    if (populated >= effectiveTarget) break

    if (populated === lastPopulated) {
      stalls++
      if (stalls >= STALL_LIMIT) {
        console.log(
          LOG_PREFIX,
          "scrollToLoadAllProfiles: Stalled after",
          stalls,
          "iterations with no new rows. Populated:",
          populated,
          "of",
          effectiveTarget
        )
        break
      }
    } else {
      stalls = 0
      lastPopulated = populated
    }

    window.scrollBy({ top: SCROLL_STEP, behavior: "smooth" })
    await sleep(SCROLL_DELAY_MS)
  }

  // Scroll back to top
  window.scrollTo(0, 0)
  await sleep(300)

  const finalCount = countPopulatedRows()
  console.log(
    LOG_PREFIX,
    "scrollToLoadAllProfiles: Done. Populated:",
    finalCount, "of", effectiveTarget
  )

  return { success: finalCount >= effectiveTarget, totalRowsLoaded: finalCount }
}

// --- Candidate extraction ---

function extractText(
  container: Element,
  selector: string
): string {
  const el = container.querySelector(selector)
  return el?.textContent?.trim() ?? ""
}

function extractHref(
  container: Element,
  selector: string
): string {
  const el = container.querySelector(selector) as HTMLAnchorElement | null
  return el?.href ?? ""
}

function extractSrc(
  container: Element,
  selector: string
): string {
  const el = container.querySelector(selector) as HTMLImageElement | null
  return el?.src ?? ""
}

function parseConnectionDegree(container: Element): number | null {
  const degreeEl = container.querySelector(".artdeco-entity-lockup__degree")
  if (!degreeEl) return null
  const text = degreeEl.textContent?.trim() ?? ""
  // e.g. "· 2nd" or "· 3rd" or "· 1st"
  const match = text.match(/(\d+)/)
  return match ? parseInt(match[1], 10) : null
}

function parsePipelineStatus(container: Element): string {
  const statusEl = container.querySelector(
    "[data-test-profile-pipeline-status]"
  )
  if (!statusEl) return ""
  const text = statusEl.textContent?.trim() ?? ""
  // e.g. "In uncontacted" → "uncontacted"
  const match = text.match(/^In\s+(.+)$/i)
  return match ? match[1].trim() : text
}

function parseIndustry(container: Element): string {
  const el = container.querySelector("[data-test-current-employer-industry]")
  if (!el) return ""
  let text = el.textContent?.trim() ?? ""
  // Strip leading "· " or "·"
  text = text.replace(/^·\s*/, "")
  return text
}

function parseHistoryGroup(
  container: Element,
  groupName: string
): { entries: Element[]; expandableButton: Element | null } {
  const groups = container.querySelectorAll("[data-test-history-group]")
  for (const group of groups) {
    const defEl = group.querySelector("[data-test-history-group-definition]")
    if (defEl && defEl.textContent?.trim() === groupName) {
      const entries = Array.from(
        group.querySelectorAll("li[data-test-description-description]")
      )
      const expandableButton = group.querySelector(
        "[data-test-expandable-list-button]"
      )
      return { entries, expandableButton }
    }
  }
  return { entries: [], expandableButton: null }
}

function parseDateDuration(
  entry: Element
): { startYear: number | null; endYear: number | null; isCurrent: boolean } {
  const dateDuration = entry.querySelector(
    "[data-test-description-entry-date-duration]"
  )
  if (!dateDuration) {
    return { startYear: null, endYear: null, isCurrent: false }
  }

  const timeElements = dateDuration.querySelectorAll("time")
  const fullText = dateDuration.textContent?.trim() ?? ""
  const isCurrent = /present/i.test(fullText)

  let startYear: number | null = null
  let endYear: number | null = null

  if (timeElements.length >= 1) {
    const parsed = parseInt(timeElements[0].textContent?.trim() ?? "", 10)
    if (!isNaN(parsed)) startYear = parsed
  }
  if (timeElements.length >= 2) {
    const parsed = parseInt(timeElements[1].textContent?.trim() ?? "", 10)
    if (!isNaN(parsed)) endYear = parsed
  }

  if (isCurrent) {
    endYear = null
  }

  return { startYear, endYear, isCurrent }
}

function parseExperienceEntries(container: Element): {
  experience: ExperienceEntry[]
  totalExperienceCount: number
} {
  const { entries, expandableButton } = parseHistoryGroup(
    container,
    "Experience"
  )

  const experience: ExperienceEntry[] = entries.map((entry) => {
    // First <span> child text: "Role at Company"
    const firstSpan = entry.querySelector("span")
    const spanText = firstSpan?.textContent?.trim() ?? ""

    let title = spanText
    let company = ""
    // Split on " at " — take the last occurrence in case the title contains " at "
    const atIndex = spanText.lastIndexOf(" at ")
    if (atIndex !== -1) {
      title = spanText.substring(0, atIndex)
      company = spanText.substring(atIndex + 4)
    }

    const { startYear, endYear, isCurrent } = parseDateDuration(entry)

    return { title, company, startYear, endYear, isCurrent }
  })

  // Total experience count from "Show all (N)" button
  let totalExperienceCount = experience.length
  if (expandableButton) {
    const btnText = expandableButton.textContent?.trim() ?? ""
    const match = btnText.match(/\((\d+)\)/)
    if (match) {
      totalExperienceCount = parseInt(match[1], 10)
    }
  }

  return { experience, totalExperienceCount }
}

function parseEducationEntries(container: Element): EducationEntry[] {
  const { entries } = parseHistoryGroup(container, "Education")

  return entries.map((entry) => {
    // First <span> child text: "Institution, Degree"
    const firstSpan = entry.querySelector("span")
    const spanText = firstSpan?.textContent?.trim() ?? ""

    let institution = spanText
    let degree = ""
    // Split on ", " — take the first occurrence
    const commaIndex = spanText.indexOf(", ")
    if (commaIndex !== -1) {
      institution = spanText.substring(0, commaIndex)
      degree = spanText.substring(commaIndex + 2)
    }

    const { startYear, endYear } = parseDateDuration(entry)

    return { institution, degree, startYear, endYear }
  })
}

function captureCandidate(li: Element): Candidate | null {
  const row = li.querySelector(".standard-profile-row")
  if (!row) {
    console.warn(LOG_PREFIX, "captureCandidate: No .standard-profile-row found")
    return null
  }

  const fullName = extractText(row, "[data-test-row-lockup-full-name] a")
  const internalTalentUrl = extractHref(
    row,
    "a[data-test-link-to-profile-link]"
  )
  const headline = extractText(row, "[data-test-row-lockup-headline]")
  const location = extractText(row, "[data-test-row-lockup-location]")
  const industry = parseIndustry(row)
  const photoUrl = extractSrc(row, "[data-test-lockup-image]")
  const connectionDegree = parseConnectionDegree(row)
  const pipelineStatus = parsePipelineStatus(row)
  const { experience, totalExperienceCount } = parseExperienceEntries(row)
  const education = parseEducationEntries(row)

  const candidate: Candidate = {
    fullName,
    internalTalentUrl,
    headline,
    location,
    industry,
    photoUrl,
    connectionDegree,
    pipelineStatus,
    experience,
    totalExperienceCount,
    education
  }

  console.log(LOG_PREFIX, "Captured candidate", {
    experienceCount: experience.length,
    totalExperienceCount,
    educationCount: education.length
  })

  return candidate
}

function getSelectedCandidates(): GetSelectedCandidatesResponse {
  const allRows = document.querySelectorAll(
    "li[data-test-paginated-profile-list-item-container]"
  )

  console.log(LOG_PREFIX, "getSelectedCandidates: Total rows in DOM:", allRows.length)

  const candidates: Candidate[] = []

  for (const li of allRows) {
    const checkbox = li.querySelector(
      'input[type="checkbox"]'
    ) as HTMLInputElement | null
    if (!checkbox?.checked) continue

    const candidate = captureCandidate(li)
    if (candidate) {
      candidates.push(candidate)
    }
  }

  console.log(
    LOG_PREFIX,
    "getSelectedCandidates: captured",
    candidates.length,
    "selected candidates"
  )

  return { candidates, count: candidates.length }
}

// --- Message listener ---

let lastLoggedResponse = ""

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === "getPageInfo") {
    const onPipeline = isPipelinePage()
    const total = onPipeline ? getTotalOnPage() : 0
    const checked = onPipeline ? getCheckedCount() : 0

    const response: GetPageInfoResponse = {
      isPipelinePage: onPipeline,
      totalOnPage: total,
      checkedCount: checked
    }

    const responseKey = JSON.stringify(response)
    if (responseKey !== lastLoggedResponse) {
      console.log(LOG_PREFIX, "getPageInfo:", response)
      lastLoggedResponse = responseKey
    }

    sendResponse(response)
    return true
  }

  if (message.type === "scrollToBottom") {
    const targetCount = message.targetCount ?? 25
    console.log(LOG_PREFIX, "scrollToLoadAllProfiles: Received request, target:", targetCount)
    scrollToLoadAllProfiles(targetCount).then((response) => {
      sendResponse(response)
    })
    return true // keep message channel open for async response
  }

  if (message.type === "getSelectedCandidates") {
    console.log(LOG_PREFIX, "getSelectedCandidates: Received request")
    const response = getSelectedCandidates()
    sendResponse(response)
    return true
  }
})

export {}
