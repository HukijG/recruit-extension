import type { DialpadCallerIdOption } from "~/lib/dialpad"
import type { OutcomeTone } from "~/lib/types"

// --- Date / phone formatting ---

export function formatActivityDate(iso: string): string {
  const d = new Date(iso)
  if (isNaN(d.getTime())) return iso
  return d.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric"
  })
}

export function formatPhoneDisplay(raw: string): string {
  const digits = raw.replace(/\D/g, "")
  if (digits.length === 11 && digits.startsWith("1")) {
    return `+1 (${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`
  }
  if (digits.length === 10) {
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`
  }
  return raw
}

export function formatRelativeTime(iso: string | null): string {
  if (!iso) return "—"
  const t = new Date(iso).getTime()
  if (!Number.isFinite(t)) return "—"
  const ms = Date.now() - t
  if (ms < 0) return "just now"
  const min = 60_000
  const hour = 60 * min
  const day = 24 * hour
  if (ms < hour) {
    const m = Math.max(1, Math.round(ms / min))
    return `${m}m ago`
  }
  if (ms < day) return `${Math.round(ms / hour)}h ago`
  if (ms < 30 * day) return `${Math.round(ms / day)}d ago`
  if (ms < 365 * day) return `${Math.round(ms / (30 * day))}mo ago`
  return `${Math.round(ms / (365 * day))}y ago`
}

// --- Outcome ---

export function formatOutcome(
  outcome: string | null
): { label: string; tone: OutcomeTone } | null {
  if (!outcome) return null
  const code = outcome.toLowerCase().trim()
  const map: Record<string, { label: string; tone: OutcomeTone }> = {
    connected: { label: "Connected", tone: "positive" },
    interested: { label: "Interested", tone: "positive" },
    voicemail: { label: "Voicemail", tone: "neutral" },
    no_answer: { label: "No answer", tone: "neutral" },
    callback: { label: "Callback requested", tone: "neutral" },
    busy: { label: "Busy", tone: "neutral" },
    not_interested: { label: "Not interested", tone: "negative" },
    declined: { label: "Declined", tone: "negative" },
    wrong_number: { label: "Wrong number", tone: "negative" }
  }
  if (map[code]) return map[code]
  const label = outcome
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase())
  return { label, tone: "neutral" }
}

export function outcomeDotColor(tone: OutcomeTone): string {
  if (tone === "positive") return "#1f9d55"
  if (tone === "negative") return "#d23a2c"
  return "#9aa0a6"
}

export function outcomeTextColor(tone: OutcomeTone): string {
  if (tone === "positive") return "#157040"
  if (tone === "negative") return "#a82a20"
  return "#3c4043"
}

// --- Stage chip ---

export function stageChipStyle(
  stage: string
): { color: string; backgroundColor: string; borderColor: string } {
  const s = stage.toLowerCase()
  if (/replied|interested|connect|engaged/.test(s)) {
    return {
      color: "#157040",
      backgroundColor: "#e6f4ec",
      borderColor: "#cfe7d8"
    }
  }
  if (/declin|not interest|reject|archiv/.test(s)) {
    return {
      color: "#a82a20",
      backgroundColor: "#fdecea",
      borderColor: "#f6c2bd"
    }
  }
  if (/contact|reach|sent|outreach/.test(s)) {
    return {
      color: "#0a66c2",
      backgroundColor: "#e6efff",
      borderColor: "#c9dcff"
    }
  }
  return { color: "#3c4043", backgroundColor: "#eef0f2", borderColor: "#dfe2e6" }
}

// --- Caller ID display ---

export function formatCallerOption(
  c: DialpadCallerIdOption,
  all: DialpadCallerIdOption[]
): string {
  const country =
    c.country === "UK" ? "UK" : c.country === "US" ? "US" : "International"
  const sameCountry = all.filter((o) => o.country === c.country)
  const indexSuffix =
    sameCountry.length > 1 ? ` ${sameCountry.indexOf(c) + 1}` : ""
  const defaultSuffix = c.isDefault ? " (default)" : ""
  return `${country} Number${indexSuffix}${defaultSuffix}`
}
