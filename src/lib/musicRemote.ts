import { useCallback, useEffect, useRef, useState } from "react"

import type {
  MusicWsStatus,
  NowPlayingSnapshot,
  NowPlayingTrack
} from "~lib/types"

// useMusicRemote — the side-panel DO WebSocket subscription for now-playing,
// plus a monotonic progress interpolator so the bar's scrubber advances
// smoothly between (sparse) snapshots.
//
// WS AUTH (frozen contract + escalation):
//   The bar talks to the WORKER only, reusing existing auth. A browser
//   WebSocket cannot set the X-Extension-Token / Access-JWT header, and
//   putting the secret in the wss:// query would leak it into Cloudflare,
//   worker, proxy, and devtools logs. So the handshake carries ZERO token in
//   the URL and relies on the Cloudflare Access same-origin cookie the
//   browser attaches automatically to the worker origin (same origin as
//   PLASMO_PUBLIC_MIDDLEWARE_URL, already in host_permissions). We never
//   self-select a query-param token path. If the worker side isn't serving
//   the cookie-authenticated WS yet, the socket simply fails the handshake
//   and the hook sits in `error`/backoff — it does not fall back to a
//   token-in-URL scheme.
//
// CONNECT GATING:
//   The socket only opens while the side panel is in candidate mode (the one
//   mode that mounts the MusicRemoteContext provider). The hook takes an
//   `enabled` flag; flipping it false closes the socket and cancels backoff.

const MIDDLEWARE_URL = process.env.PLASMO_PUBLIC_MIDDLEWARE_URL

// Path on the worker that upgrades to the DO now-playing socket. Part of the
// frozen contract's "now-playing via the worker's DO WS route".
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
  // The latest snapshot as streamed (isPlaying + the track), with positionMs
  // OVERRIDDEN by the interpolator so the bar always reads a live position.
  snapshot: NowPlayingSnapshot | null
  status: MusicWsStatus
}

// Derive the wss:// origin from the configured https worker origin. The WS
// shares the public middleware origin (frozen contract); we only swap the
// scheme. Returns null if the URL is unset/malformed so callers can no-op.
function buildWsUrl(): string | null {
  if (!MIDDLEWARE_URL) return null
  try {
    const u = new URL(MIDDLEWARE_URL)
    u.protocol = u.protocol === "http:" ? "ws:" : "wss:"
    // Normalise: drop any trailing slash on the base path, then append.
    const base = u.toString().replace(/\/+$/, "")
    return `${base}${WS_PATH}`
  } catch {
    return null
  }
}

// Narrowing parse of an inbound WS frame into a NowPlayingSnapshot. Rejects
// anything that doesn't match the frozen camelCase shape so a malformed frame
// can't poison the interpolator. Returns null on any mismatch.
function parseSnapshot(raw: unknown): NowPlayingSnapshot | null {
  if (!raw || typeof raw !== "object") return null
  const obj = raw as Record<string, unknown>
  if (typeof obj.isPlaying !== "boolean") return null
  if (typeof obj.positionMs !== "number") return null

  const rawTrack = obj.track
  let track: NowPlayingTrack | null = null
  if (rawTrack && typeof rawTrack === "object") {
    const t = rawTrack as Record<string, unknown>
    if (
      typeof t.loadId === "string" &&
      typeof t.title === "string" &&
      typeof t.artists === "string" &&
      typeof t.album === "string" &&
      typeof t.artUrl === "string" &&
      typeof t.durationMs === "number"
    ) {
      track = {
        loadId: t.loadId,
        title: t.title,
        artists: t.artists,
        album: t.album,
        artUrl: t.artUrl,
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

// Anchor for monotonic interpolation: the snapshot's position captured at a
// performance.now() instant. Between snapshots the displayed position is
// anchorPositionMs + (now - anchorClock) when playing, clamped to the track
// duration, and frozen when paused.
interface InterpAnchor {
  loadId: string | null
  anchorPositionMs: number
  anchorClock: number
  isPlaying: boolean
  durationMs: number
}

export function useMusicRemote(enabled: boolean): UseMusicRemoteReturn {
  const [snapshot, setSnapshot] = useState<NowPlayingSnapshot | null>(null)
  const [status, setStatus] = useState<MusicWsStatus>("idle")
  // The interpolated position, written every tick. Kept separate from the raw
  // snapshot so re-anchoring on each frame doesn't churn the whole snapshot
  // object identity.
  const [displayPositionMs, setDisplayPositionMs] = useState(0)

  const wsRef = useRef<WebSocket | null>(null)
  const reconnectRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const backoffRef = useRef(BACKOFF_BASE_MS)
  const anchorRef = useRef<InterpAnchor | null>(null)
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

  // Re-anchor the interpolator from a freshly streamed snapshot. On a load-id
  // change we FULLY reset (position jumps to the snapshot's position, no
  // monotonic carry-over from the previous track). Within the same track we
  // re-anchor to the snapshot's authoritative position — trusting the worker
  // over our own drift — but the per-tick clamp below keeps the DISPLAY
  // monotonic between re-anchors.
  const reanchor = useCallback((snap: NowPlayingSnapshot) => {
    const loadId = snap.track?.loadId ?? null
    const durationMs = snap.track?.durationMs ?? 0
    anchorRef.current = {
      loadId,
      anchorPositionMs: snap.positionMs,
      anchorClock: performance.now(),
      isPlaying: snap.isPlaying,
      durationMs
    }
    setDisplayPositionMs(
      Math.max(0, Math.min(snap.positionMs, durationMs || snap.positionMs))
    )
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
        parsed = JSON.parse(
          typeof event.data === "string" ? event.data : ""
        )
      } catch {
        return
      }
      const snap = parseSnapshot(parsed)
      if (!snap) return
      setStatus("open")
      setSnapshot(snap)
      reanchor(snap)
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
  }, [reanchor, teardownSocket, scheduleReconnect])

  // Keep connectRef pointing at the freshest connect closure so the
  // reconnect timer (scheduled via scheduleReconnect) always re-opens with
  // the current logic, regardless of which dep last changed connect's
  // identity.
  useEffect(() => {
    connectRef.current = connect
  }, [connect])

  // Open the socket only while enabled (candidate mode). Disabling closes it
  // and cancels any pending reconnect; the snapshot is cleared so a re-entry
  // doesn't flash a stale track before the first fresh frame.
  useEffect(() => {
    if (!enabled) {
      activeRef.current = false
      clearReconnect()
      teardownSocket()
      anchorRef.current = null
      setStatus("idle")
      setSnapshot(null)
      setDisplayPositionMs(0)
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

  // Monotonic interpolation tick. Each tick advances the displayed position
  // from the current anchor on the performance clock. Paused → frozen at the
  // anchor. The clamp is monotonic-within-track: the display never goes
  // backwards except on an explicit re-anchor or a load-id reset (both routed
  // through reanchor()).
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

  // Surface the snapshot with the interpolated position spliced in so the bar
  // reads one coherent object. Identity changes each tick while playing,
  // which is intended — the scrubber needs to advance.
  const merged: NowPlayingSnapshot | null = snapshot
    ? { ...snapshot, positionMs: displayPositionMs }
    : null

  return { snapshot: merged, status }
}
