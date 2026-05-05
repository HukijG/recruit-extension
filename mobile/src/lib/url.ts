// Kept for parity with the extension; not used in mobile (no LinkedIn DOM
// to read). Safe to delete if/when the codebase shrinks.

export type LinkedInMode = "sync" | "candidate"

export interface ParsedLinkedInTalentUrl {
  mode: LinkedInMode
  urlId: string | null
}

const TALENT_PREFIX = "https://www.linkedin.com/talent/"
const PROFILE_RE = /\/profile\/([^/?#]+)/

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
