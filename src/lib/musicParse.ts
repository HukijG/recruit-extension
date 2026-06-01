import type { MusicPlaylistResult, MusicSongResult } from "~lib/types"

// Shared, reality-tolerant normalisers for the worker's /music search +
// playlist-contents responses. The three search-style handlers
// (musicSearch / musicPlaylistSearch / musicPlaylistContents) all funnel
// through these so the tolerant shape logic lives in one place.
//
// WHY TOLERANT: the upstream catalogue (the dashboard's Deezer adapter) ships
// a Paged envelope `{ items, total, offset, limit }` whose rows use serde
// field names that differ from the bar's stored shape — songs carry
// `track`/`artist`/`coverUrl`, playlists carry `name`/`ownerName`/`coverUrl`,
// cover/duration are nullable. The frozen contract names the bar-side fields
// `title`/`artists`/`artUrl`. The worker is a pass-through proxy, so we accept
// BOTH the dashboard field names and the contract names, unwrap the Paged
// envelope, and normalise nullable/array fields — otherwise every real row is
// dropped at the type guard.
//
// IDS: the frozen contract says Deezer ids are numeric. Search/contents PARSING
// stays tolerant (pickId accepts a JSON number OR string and carries a string
// for stable React identity); the OUTBOUND action payloads are the strict half
// — coerceTrackId narrows the carried id back to the contract's JSON NUMBER
// before play/enqueue/playlist-play post it.

// Unwrap a list from either a bare array, the dashboard's `{ items: [...] }`
// Paged envelope, or a legacy `{ results: [...] }` wrapper (defensive
// fallback). Returns [] for anything else.
function unwrapList(raw: unknown): unknown[] {
  if (Array.isArray(raw)) return raw
  if (raw && typeof raw === "object") {
    const obj = raw as Record<string, unknown>
    if (Array.isArray(obj.items)) return obj.items
    if (Array.isArray(obj.results)) return obj.results
  }
  return []
}

// First defined string among the given candidate fields, else null.
function pickStr(r: Record<string, unknown>, ...keys: string[]): string | null {
  for (const k of keys) {
    if (typeof r[k] === "string") return r[k] as string
  }
  return null
}

// An optional cover/art url: a string, or null/undefined → "". A field that's
// present-but-wrong-typed (e.g. a number) returns null so the row is rejected.
function pickArtUrl(r: Record<string, unknown>, ...keys: string[]): string | null {
  for (const k of keys) {
    const v = r[k]
    if (typeof v === "string") return v
    if (v === null || v === undefined) continue
    return null
  }
  return ""
}

// Parsed-row ids are kept as STRINGS in the bar (stable React key; tolerant of
// a numeric- or string-shaped wire). Accept a JSON number too and stringify it,
// in case an upstream emits a numeric id.
function pickId(r: Record<string, unknown>): string | null {
  const v = r.id
  if (typeof v === "string" && v.length > 0) return v
  if (typeof v === "number" && Number.isFinite(v)) return String(v)
  return null
}

// Coerce a bar-side string id (or an already-numeric id off the message bus)
// down to the JSON NUMBER the frozen contract puts on the wire for song /
// playlist actions (`songs::{play,enqueue}` / `playlists::play` deserialize
// `id: u64`). Deezer track/playlist ids are integers that fit in a u64; we
// reject anything non-integer, non-finite, or negative so a malformed id can't
// reach the worker as a string (which serde u64 would refuse). Returns null on
// any invalid input so the caller can surface "invalid id" instead of posting.
export function coerceTrackId(raw: unknown): number | null {
  if (typeof raw === "number") {
    return Number.isInteger(raw) && raw >= 0 ? raw : null
  }
  if (typeof raw === "string") {
    const trimmed = raw.trim()
    // Strict integer string only — Number("") is 0 and Number("12x") is NaN,
    // so guard the shape before coercing to avoid silently accepting junk.
    if (!/^\d+$/.test(trimmed)) return null
    const n = Number(trimmed)
    return Number.isInteger(n) && n >= 0 ? n : null
  }
  return null
}

// `artists` may arrive as a JSON array (`Vec<String>`), a single joined
// string, or a single-`artist` string (the dashboard's flattened SearchResult).
// Returns a comma-joined display string, or null if absent/malformed.
function pickArtists(r: Record<string, unknown>): string | null {
  if (Array.isArray(r.artists)) {
    const names = r.artists.filter((a): a is string => typeof a === "string")
    if (names.length !== r.artists.length) return null
    return names.join(", ")
  }
  return pickStr(r, "artists", "artist")
}

// Optional non-negative integer (durationMs / trackCount). Missing → fallback.
function pickNum(r: Record<string, unknown>, key: string, fallback: number): number {
  const v = r[key]
  if (typeof v === "number" && Number.isFinite(v)) return v
  return fallback
}

export function parseSongs(raw: unknown): MusicSongResult[] {
  const out: MusicSongResult[] = []
  for (const item of unwrapList(raw)) {
    if (!item || typeof item !== "object") continue
    const r = item as Record<string, unknown>
    const id = pickId(r)
    const title = pickStr(r, "title", "track")
    const artists = pickArtists(r)
    const artUrl = pickArtUrl(r, "artUrl", "coverUrl")
    if (id === null || title === null || artists === null || artUrl === null) {
      continue
    }
    out.push({
      id,
      title,
      artists,
      album: pickStr(r, "album") ?? "",
      artUrl,
      durationMs: pickNum(r, "durationMs", 0)
    })
  }
  return out
}

export function parsePlaylists(raw: unknown): MusicPlaylistResult[] {
  const out: MusicPlaylistResult[] = []
  for (const item of unwrapList(raw)) {
    if (!item || typeof item !== "object") continue
    const r = item as Record<string, unknown>
    const id = pickId(r)
    const title = pickStr(r, "title", "name")
    const artUrl = pickArtUrl(r, "artUrl", "coverUrl")
    if (id === null || title === null || artUrl === null) continue
    out.push({
      id,
      title,
      creator: pickStr(r, "creator", "ownerName") ?? "",
      artUrl,
      trackCount: pickNum(r, "trackCount", 0)
    })
  }
  return out
}
