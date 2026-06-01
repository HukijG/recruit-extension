import { useCallback, useEffect, useRef, useState } from "react"

import type {
  MusicWsStatus,
  NowPlayingSnapshot,
  NowPlayingTrack
} from "~lib/types"

// useMusicRemote — the side-panel DO WebSocket subscription for now-playing.
// It owns ONLY the WS lifecycle and the latest RAW snapshot/status; it does
// NOT tick. The monotonic progress interpolator (the 4Hz clock) is a separate
// hook, `useInterpolatedPosition`, run inside the bar subtree so playback only
// re-renders the bar — never the orchestrator that hosts this subscription.
// Hoisting the clock here would re-render every mode subtree at 4Hz during
// playback, defeating the bar's "self-contained" mandate.
//
// WS AUTH — OPEN CONTRACT GAP, ESCALATED (do NOT treat as resolved):
//   The frozen contract says now-playing rides the worker's DO WS route using
//   "existing auth (X-Extension-Token / Access JWT)". But a browser WebSocket
//   CANNOT set a custom request header, so neither named scheme can be carried
//   on the handshake, and a token in the wss:// query would leak into
//   Cloudflare / worker / proxy / devtools logs. The contract-faithful
//   resolutions (a short-lived ticket minted via an authed HTTP call then
//   passed as a one-time path segment or subprotocol; OR the worker accepting
//   the Access cookie, documented in the contract) BOTH require a worker-side
//   contract decision — and the worker's /music WS route does not exist yet,
//   so neither can be implemented or verified here. We do NOT unilaterally
//   invent a ticket endpoint or pin cookie-auth as the answer.
//
//   As-is behaviour (the only thing a browser WS can do without a worker
//   contract): open the handshake with no token in the URL. If the worker
//   origin is behind Cloudflare Access, the browser attaches the same-origin
//   Access cookie automatically and the upgrade may authenticate; if not (a
//   legacy X-Extension-Token-only user, or a worker that authenticates the
//   upgrade on a header), the handshake fails and the hook sits in
//   error/backoff. The legacy X-Extension-Token-only path has NO working WS
//   auth until the worker contract names a header-free scheme. This is an
//   escalation, not a shipped decision.
//
// CONNECT GATING (demand-gate):
//   The socket opens whenever the side panel is OPEN, on every surface except
//   the template editor — i.e. all three modes. The bar's WS is the system's
//   demand-gate: the worker's upstream DO socket lives exactly while someone
//   has the panel open, so we do NOT scope the connection to a single mode
//   (doing so would collapse the gate to "a recruiter is viewing one specific
//   candidate"). The hook takes an `enabled` flag (panel-open); flipping it
//   false closes the socket and cancels backoff.

// The now-playing WS rides the NEW, DEDICATED music worker (separate from the
// Recruiterflow/Dialpad middleware), per the frozen cross-repo contract. Both
// the /music/* HTTP control routes and this WS target PLASMO_PUBLIC_MUSIC_URL.
const MUSIC_URL = process.env.PLASMO_PUBLIC_MUSIC_URL

// Path on the music worker that upgrades to the DO now-playing socket. Part of
// the frozen contract's "now-playing via the worker's DO WS route".
const WS_PATH = "/music/now-playing"

// Interpolation tick. 250ms is smooth enough for a thin progress bar without
// burning a frame budget; the underlying clock is performance.now() so the
// displayed position is monotonic and immune to wall-clock jumps.
const TICK_MS = 250

// Reconnect backoff: start small, double, cap near 15s so a worker outage
// doesn't hammer the edge but recovery is still prompt once it returns.
const BACKOFF_BASE_MS = 1_000
const BACKOFF_CAP_MS = 15_000

export interface UseMusicRemoteReturn {
  // The latest RAW snapshot as streamed (isPlaying + the track + the
  // snapshot's own positionMs). Identity changes only when a fresh frame
  // arrives — NOT every tick — so hosting this in the orchestrator does not
  // re-render the app at 4Hz. The bar splices a live position over positionMs
  // via useInterpolatedPosition.
  snapshot: NowPlayingSnapshot | null
  status: MusicWsStatus
}

// Derive the wss:// origin from the configured https music-worker origin. The
// WS shares the music worker's origin (frozen contract — same base as the
// /music/* HTTP routes); we only swap the scheme. Returns null if the URL is
// unset/malformed so callers can no-op.
function buildWsUrl(): string | null {
  if (!MUSIC_URL) return null
  try {
    const u = new URL(MUSIC_URL)
    u.protocol = u.protocol === "http:" ? "ws:" : "wss:"
    // Normalise: drop any trailing slash on the base path, then append.
    const base = u.toString().replace(/\/+$/, "")
    return `${base}${WS_PATH}`
  } catch {
    return null
  }
}

// Normalise the wire's `artists` (the dashboard ships `Vec<String>` — a JSON
// array) down to one display string. Accepts a single string too, in case the
// worker pre-joins. Anything else → null (the field is required on a track).
function normalizeArtists(raw: unknown): string | null {
  if (typeof raw === "string") return raw
  if (Array.isArray(raw)) {
    const names = raw.filter((a): a is string => typeof a === "string")
    if (names.length !== raw.length) return null
    return names.join(", ")
  }
  return null
}

// Narrowing parse of an inbound WS frame into a NowPlayingSnapshot. Accepts the
// real dashboard wire types — `loadId` is a u64 NUMBER, `artists` a STRING
// ARRAY, `artUrl` a NULLABLE string — and normalises them to the bar's stored
// shape (joined artist string, "" for a missing cover). Returns null only on a
// frame that's genuinely malformed, so a track with no art still renders.
function parseSnapshot(raw: unknown): NowPlayingSnapshot | null {
  if (!raw || typeof raw !== "object") return null
  const obj = raw as Record<string, unknown>
  if (typeof obj.isPlaying !== "boolean") return null
  if (typeof obj.positionMs !== "number") return null

  const rawTrack = obj.track
  let track: NowPlayingTrack | null = null
  if (rawTrack && typeof rawTrack === "object") {
    const t = rawTrack as Record<string, unknown>
    const artists = normalizeArtists(t.artists)
    // art_url is Option<String>: a string, or null/undefined → "".
    const artUrlOk =
      typeof t.artUrl === "string" ||
      t.artUrl === null ||
      t.artUrl === undefined
    if (
      typeof t.loadId === "number" &&
      typeof t.title === "string" &&
      artists !== null &&
      typeof t.album === "string" &&
      artUrlOk &&
      typeof t.durationMs === "number"
    ) {
      track = {
        loadId: t.loadId,
        title: t.title,
        artists,
        album: t.album,
        artUrl: typeof t.artUrl === "string" ? t.artUrl : "",
        durationMs: t.durationMs
      }
    } else {
      // A present-but-malformed track is treated as "no track" rather than a
      // dropped frame — better to clear the bar than to keep a stale title.
      track = null
    }
  } else if (rawTrack !== null && rawTrack !== undefined) {
    return null
  }

  return {
    isPlaying: obj.isPlaying,
    positionMs: obj.positionMs,
    track
  }
}

export function useMusicRemote(enabled: boolean): UseMusicRemoteReturn {
  const [snapshot, setSnapshot] = useState<NowPlayingSnapshot | null>(null)
  const [status, setStatus] = useState<MusicWsStatus>("idle")

  const wsRef = useRef<WebSocket | null>(null)
  const reconnectRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const backoffRef = useRef(BACKOFF_BASE_MS)
  // Guards async close callbacks from scheduling reconnects after the hook
  // has been disabled/unmounted.
  const activeRef = useRef(false)
  // connect() and scheduleReconnect() are mutually recursive (a drop schedules
  // a reconnect, which calls connect, which may schedule again). A ref breaks
  // the declaration-order cycle: scheduleReconnect is defined first and calls
  // the latest connect through this ref, kept current by an effect below.
  const connectRef = useRef<() => void>(() => {})

  const clearReconnect = useCallback(() => {
    if (reconnectRef.current) {
      clearTimeout(reconnectRef.current)
      reconnectRef.current = null
    }
  }, [])

  const teardownSocket = useCallback(() => {
    const ws = wsRef.current
    if (ws) {
      // Detach handlers before closing so the close event doesn't re-trigger
      // backoff against a socket we're intentionally dropping.
      ws.onopen = null
      ws.onmessage = null
      ws.onerror = null
      ws.onclose = null
      try {
        ws.close()
      } catch {
        // Closing an already-closing socket throws in some engines — ignore.
      }
      wsRef.current = null
    }
  }, [])

  const scheduleReconnect = useCallback(() => {
    if (!activeRef.current) return
    clearReconnect()
    const delay = backoffRef.current
    backoffRef.current = Math.min(backoffRef.current * 2, BACKOFF_CAP_MS)
    reconnectRef.current = setTimeout(() => {
      reconnectRef.current = null
      connectRef.current()
    }, delay)
  }, [clearReconnect])

  const connect = useCallback(() => {
    if (!activeRef.current) return
    const url = buildWsUrl()
    if (!url) {
      setStatus("error")
      return
    }

    teardownSocket()
    setStatus("connecting")

    let ws: WebSocket
    try {
      ws = new WebSocket(url)
    } catch {
      // Construction itself can throw on a malformed URL / CSP block. Treat
      // as a drop and schedule a backoff reconnect.
      scheduleReconnect()
      return
    }
    wsRef.current = ws

    ws.onopen = () => {
      // Reset backoff on a clean open so the NEXT drop starts from the floor.
      backoffRef.current = BACKOFF_BASE_MS
      // Stay "connecting" until the first snapshot arrives — an open socket
      // with no data yet isn't usefully "open" for the bar.
    }

    ws.onmessage = (event) => {
      let parsed: unknown
      try {
        parsed = JSON.parse(typeof event.data === "string" ? event.data : "")
      } catch {
        return
      }
      const snap = parseSnapshot(parsed)
      if (!snap) return
      setStatus("open")
      setSnapshot(snap)
    }

    ws.onerror = () => {
      // onerror is always followed by onclose; let onclose own the reconnect
      // so we don't double-schedule.
      setStatus("error")
    }

    ws.onclose = () => {
      wsRef.current = null
      if (!activeRef.current) {
        setStatus("closed")
        return
      }
      setStatus("error")
      scheduleReconnect()
    }
  }, [teardownSocket, scheduleReconnect])

  // Keep connectRef pointing at the freshest connect closure so the
  // reconnect timer (scheduled via scheduleReconnect) always re-opens with
  // the current logic, regardless of which dep last changed connect's
  // identity.
  useEffect(() => {
    connectRef.current = connect
  }, [connect])

  // Open the socket only while enabled (panel-open, any non-editor mode).
  // Disabling closes it and cancels any pending reconnect; the snapshot is
  // cleared so a re-entry doesn't flash a stale track before the first fresh
  // frame.
  useEffect(() => {
    if (!enabled) {
      activeRef.current = false
      clearReconnect()
      teardownSocket()
      setStatus("idle")
      setSnapshot(null)
      return
    }
    activeRef.current = true
    backoffRef.current = BACKOFF_BASE_MS
    connect()
    return () => {
      activeRef.current = false
      clearReconnect()
      teardownSocket()
    }
  }, [enabled, connect, clearReconnect, teardownSocket])

  // The RAW snapshot — its positionMs is the last-streamed value, advanced
  // smoothly by useInterpolatedPosition inside the bar (NOT here). Identity is
  // stable between frames, so the orchestrator that hosts this hook re-renders
  // only when a fresh frame lands, never on the interpolation clock.
  return { snapshot, status }
}

// Anchor for monotonic interpolation: a snapshot's position captured at a
// performance.now() instant. Between snapshots the displayed position is
// anchorPositionMs + (now - anchorClock) when playing, clamped to the track
// duration, and frozen when paused.
interface InterpAnchor {
  anchorPositionMs: number
  anchorClock: number
  isPlaying: boolean
  durationMs: number
}

// useInterpolatedPosition — the 4Hz progress clock, run INSIDE the bar subtree.
//
// Given the raw snapshot (whose positionMs only changes when a fresh frame
// lands) it returns a live position in ms that advances ~4×/s while playing.
// Because the per-tick setState lives in whatever component calls this hook
// (the bar), only that subtree re-renders on the clock — the orchestrator that
// owns the WS subscription is untouched. This is the whole point of the split:
// the music feature's high-frequency clock must not leak app-wide.
//
// Re-anchoring: every snapshot is authoritative, so the display adopts its
// position directly — a new-track frame (position ~0) hard-resets, a same-track
// seek/drift-resync corrects in EITHER direction (a backward seek moves the bar
// back). The per-tick clamp keeps the DISPLAY monotonic only BETWEEN re-anchors
// (so interpolation jitter never stutters backward), never overriding an
// authoritative snapshot. `enabled` gates the tick so a hidden bar burns no
// interval.
export function useInterpolatedPosition(
  snapshot: NowPlayingSnapshot | null,
  enabled: boolean
): number {
  const [displayPositionMs, setDisplayPositionMs] = useState(0)
  const anchorRef = useRef<InterpAnchor | null>(null)

  // Re-anchor whenever a fresh snapshot lands (new object identity from the
  // subscription) and adopt its authoritative position directly — the worker
  // only pushes on a material change or sparse resync, so it's always the truth.
  useEffect(() => {
    if (!snapshot) {
      anchorRef.current = null
      setDisplayPositionMs(0)
      return
    }
    const durationMs = snapshot.track?.durationMs ?? 0
    anchorRef.current = {
      anchorPositionMs: snapshot.positionMs,
      anchorClock: performance.now(),
      isPlaying: snapshot.isPlaying,
      durationMs
    }
    const anchored = Math.max(
      0,
      Math.min(snapshot.positionMs, durationMs || snapshot.positionMs)
    )
    // The snapshot is authoritative on every re-anchor — the worker pushes only
    // on a MATERIAL change (track / play-pause / seek / stop) plus a sparse
    // drift-resync, so adopting its position directly is correct in both
    // directions. A backward `Seeked` MUST move the bar back; clamping to
    // Math.max(prev, anchored) would freeze the fill until playback caught up.
    // Monotonicity is the TICK's job (smoothing interpolation between
    // snapshots), not the re-anchor's — so we never carry a stale forward
    // position across an authoritative correction. (A load-id change is a
    // hard-reset; a same-track frame is the seek/resync case — both just take
    // `anchored`, since the snapshot is the source of truth either way.)
    setDisplayPositionMs(anchored)
  }, [snapshot])

  // Monotonic interpolation tick. Advances the displayed position from the
  // current anchor on the performance clock; paused → frozen at the anchor.
  useEffect(() => {
    if (!enabled) return
    const id = setInterval(() => {
      const anchor = anchorRef.current
      if (!anchor) return
      if (!anchor.isPlaying) {
        setDisplayPositionMs(anchor.anchorPositionMs)
        return
      }
      const elapsed = performance.now() - anchor.anchorClock
      const raw = anchor.anchorPositionMs + elapsed
      const ceil = anchor.durationMs > 0 ? anchor.durationMs : raw
      const next = Math.max(0, Math.min(raw, ceil))
      setDisplayPositionMs((prev) => (next > prev ? next : prev))
    }, TICK_MS)
    return () => clearInterval(id)
  }, [enabled])

  return displayPositionMs
}
