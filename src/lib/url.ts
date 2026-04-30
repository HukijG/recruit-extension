export type LinkedInMode = "sync" | "candidate"

export interface ParsedLinkedInTalentUrl {
  mode: LinkedInMode
  urlId: string | null
}

const TALENT_PREFIX = "https://www.linkedin.com/talent/"
const PROFILE_RE = /\/profile\/([^/?#]+)/

// Returns mode === "candidate" only when the URL is a LinkedIn Recruiter talent
// URL containing a /profile/<urlId> segment (i.e. a candidate sidepanel is open
// over the pipeline list). Anything else maps to "sync".
export function parseLinkedInTalentUrl(
  url: string | undefined | null
): ParsedLinkedInTalentUrl {
  if (!url || !url.startsWith(TALENT_PREFIX)) {
    return { mode: "sync", urlId: null }
  }
  const match = url.match(PROFILE_RE)
  if (match && match[1]) {
    return { mode: "candidate", urlId: match[1] }
  }
  return { mode: "sync", urlId: null }
}
