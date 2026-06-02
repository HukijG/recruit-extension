import { sendToBackground } from "@plasmohq/messaging"
import { useCallback, useEffect, useRef, useState } from "react"

import type { CallStreamState } from "~lib/types"

// Polling-based call-state hook against POST /extension-call-status.
// Spec: the middleware polling-update handover.
//
// State machine (3 values, internal-only):
//   idle    → button shows "Call"
//   calling → button shows "Calling…" (disabled)
//   active  → button shows "Hangup"  (red, enabled)
//
// The worker only reports two wire states (`in_progress`, `ended`); we
// translate those to transitions over the local 3-value status. Polling only
// runs while status !== "idle".
//
// Polling kicks off the instant status leaves idle (no initial delay), and
// a 10s wallclock from beginLocalCalling acts as a give-up — if we haven't
// seen `in_progress` in that window (whether the worker errored, returned
// no-active-call, or stayed silent), silently revert to idle so the user
// can retry. `in_progress` flips us to `active` and clears the watchdog.
//
// State persistence: every non-idle transition writes status + phoneNumber
// + savedAt to the side panel's localStorage; on hook mount we hydrate from
// there. Survives sidepanel close/reopen and tab switches so the Hangup
// button stays live when the user comes back mid-call. A 30-minute freshness
// TTL discards stale state from previous days; per-candidate phone-match
// logic in CallButton means the persisted state is only surfaced on the
// right candidate page.

// 500ms cadence — handover's recommended sweet spot. 250ms minimum (no
// benefit, burns quota); 1s maximum (sluggish hangup detection).
const POLL_INTERVAL_MS = 500

// 10s wallclock from beginLocalCalling. If polling hasn't seen
// `in_progress` by then, silently revert to idle. Silent revert by request;
// we never surface a "Failed — retry" label.
const CALLING_WATCHDOG_MS = 10_000

const PERSIST_KEY = "callStream:state"
const PERSIST_TTL_MS = 30 * 60 * 1000

interface PersistedCallState {
  status: "calling" | "active"
  phoneNumber: string | null
  savedAt: number
}

function readPersisted(): PersistedCallState | null {
  if (typeof window === "undefined") return null
  const raw = window.localStorage.getItem(PERSIST_KEY)
  if (!raw) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== "object") return null
  const obj = parsed as Partial<PersistedCallState>
  if (
    (obj.status !== "calling" && obj.status !== "active") ||
    typeof obj.savedAt !== "number"
  ) {
    return null
  }
  if (Date.now() - obj.savedAt > PERSIST_TTL_MS) {
    window.localStorage.removeItem(PERSIST_KEY)
    return null
  }
  return {
    status: obj.status,
    phoneNumber: typeof obj.phoneNumber === "string" ? obj.phoneNumber : null,
    savedAt: obj.savedAt
  }
}

function writePersisted(state: CallStreamState): void {
  if (typeof window === "undefined") return
  if (state.status === "idle") {
    window.localStorage.removeItem(PERSIST_KEY)
    return
  }
  window.localStorage.setItem(
    PERSIST_KEY,
    JSON.stringify({
      status: state.status,
      phoneNumber: state.phoneNumber,
      savedAt: Date.now()
    })
  )
}

export interface UseCallStreamReturn {
  state: CallStreamState
  beginLocalCalling: (phoneNumber: string) => void
  cancelLocalCalling: () => void
}

type WireState = "in_progress" | "ended"

interface ExtensionCallStatusOk {
  ok: true
  data: { state?: WireState }
}
interface ExtensionCallStatusErr {
  ok: false
  status?: number
  transient?: boolean
}
type ExtensionCallStatusResp = ExtensionCallStatusOk | ExtensionCallStatusErr

export function useCallStream(): UseCallStreamReturn {
  const [state, setState] = useState<CallStreamState>(() => {
    const persisted = readPersisted()
    if (persisted) {
      return { status: persisted.status, phoneNumber: persisted.phoneNumber }
    }
    return { status: "idle", phoneNumber: null }
  })

  // Latest state in a ref so the polling loop and watchdog can read the
  // current status without re-arming themselves on every state change.
  const stateRef = useRef(state)
  stateRef.current = state

  const watchdogRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  // Boolean coalescing flag. sendToBackground can't be aborted the way a
  // fetch+AbortController could; if a poll is in flight, skip new ones.
  // On unmount the interval is cleared and any in-flight messaging just
  // completes on its own (the response is dropped, nothing leaks).
  const inFlightRef = useRef(false)
  // setInterval captures poll at arming time; the ref lets the interval
  // call the LATEST poll closure without rearming the timer.
  const pollRef = useRef<() => Promise<void>>(async () => {})

  const clearWatchdog = useCallback(() => {
    if (watchdogRef.current) {
      clearTimeout(watchdogRef.current)
      watchdogRef.current = null
    }
  }, [])

  const stopPolling = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current)
      intervalRef.current = null
    }
    // No abort path — sendToBackground is not abortable. Any in-flight
    // messaging finishes on its own; inFlightRef resets in the poll's
    // finally block. The interval being cleared is enough.
  }, [])

  // Apply a wire response. in_progress flips calling→active and clears the
  // watchdog (we got the signal, no need to give up). active+in_progress is
  // a no-op; ended terminates active but is ignored while calling — the
  // watchdog owns the give-up decision in that state.
  const applyWireState = useCallback((wire: WireState) => {
    const prev = stateRef.current.status
    if (wire === "in_progress") {
      if (prev === "calling") {
        clearWatchdog()
        setState((s) => ({ status: "active", phoneNumber: s.phoneNumber }))
      }
      // active → no-op; idle → polling shouldn't be running, so unreachable.
      return
    }
    // wire === "ended"
    if (prev === "active") {
      stopPolling()
      setState({ status: "idle", phoneNumber: null })
    }
    // calling → ignore; idle → unreachable.
  }, [clearWatchdog, stopPolling])

  // The poll itself. Dispatches to the background handler so the access
  // token stays in the SW. Status-code-aware behavior moves into the
  // handler's response envelope: `transient: false` = terminal (stop),
  // `transient: true` = retry on next tick.
  const poll = useCallback(async () => {
    // Coalesce — never run two polls in flight. The interval may fire while
    // the previous request hasn't returned; in that case skip.
    if (inFlightRef.current) return
    inFlightRef.current = true
    try {
      const resp = (await sendToBackground<unknown, ExtensionCallStatusResp>({
        name: "extensionCallStatus"
      })) as ExtensionCallStatusResp

      if (resp.ok === false) {
        // Terminal auth/registry failure: stop the loop. The LoginScreen
        // takes over via <RequireAuth>; we just stop spamming.
        if (resp.transient === false) {
          console.warn(
            `[callStream] poll ${resp.status ?? "?"} — stopping (config issue)`
          )
          stopPolling()
          if (stateRef.current.status !== "idle") {
            clearWatchdog()
            setState({ status: "idle", phoneNumber: null })
          }
          return
        }
        // Transient (500/502/network blip) → keep loop alive; no backoff
        // (500ms is already polite). Next interval tick retries.
        return
      }

      if (resp.data.state === "in_progress" || resp.data.state === "ended") {
        applyWireState(resp.data.state)
      }
    } catch (err) {
      // sendToBackground rejection — treat as transient. Network blip,
      // SW restart, or messaging hiccup; keep loop alive.
      console.warn("[callStream] poll error:", (err as Error)?.message ?? err)
    } finally {
      inFlightRef.current = false
    }
  }, [applyWireState, clearWatchdog, stopPolling])

  // Keep pollRef pointing at the freshest poll closure so the interval
  // lambda below always calls the current one, regardless of which deps
  // changed.
  useEffect(() => {
    pollRef.current = poll
  }, [poll])

  // Drive the polling loop off status. Handover says: only poll while there's
  // something to poll for (status !== "idle"). When state goes back to idle,
  // stop. When state transitions out of idle, start.
  //
  // Kick off an immediate poll so the worst-case wait for in_progress is
  // bounded by network latency, not POLL_INTERVAL_MS + latency.
  useEffect(() => {
    if (state.status === "idle") {
      stopPolling()
      return
    }
    if (intervalRef.current) return // already polling
    void pollRef.current()
    intervalRef.current = setInterval(() => {
      void pollRef.current()
    }, POLL_INTERVAL_MS)
  }, [state.status, stopPolling])

  // Clean up timers + in-flight fetches on unmount. Note: stopPolling itself
  // is a stable callback, so the cleanup tracks unmount, not status changes.
  useEffect(() => {
    return () => {
      stopPolling()
      clearWatchdog()
    }
  }, [stopPolling, clearWatchdog])

  // Persist state changes to localStorage so a closed/reopened sidepanel
  // can hydrate the call state on next mount. Idle clears the entry.
  useEffect(() => {
    writePersisted(state)
  }, [state])

  // Mount-only: if we hydrated into `calling`, beginLocalCalling didn't run
  // so its watchdog wasn't armed. Arm a fresh 10s clock now so a stuck
  // hydrated-calling state can't sit forever waiting for an in_progress
  // that never lands.
  useEffect(() => {
    if (stateRef.current.status === "calling" && !watchdogRef.current) {
      watchdogRef.current = setTimeout(() => {
        watchdogRef.current = null
        if (stateRef.current.status === "calling") {
          setState({ status: "idle", phoneNumber: null })
        }
      }, CALLING_WATCHDOG_MS)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const beginLocalCalling = useCallback((phoneNumber: string) => {
    // Stamp the dialed phone so per-candidate views can phone-match
    // state.phoneNumber against their own number — only the candidate the
    // call is for shows Calling…/Hangup. The polling effect picks up the
    // calling status and starts hitting /extension-call-status immediately.
    setState({ status: "calling", phoneNumber })
    // 10s wallclock. If polling never observes `in_progress` in this
    // window — whether from worker errors, no-active-call responses, or
    // just silence — silently revert to idle so the user can retry.
    clearWatchdog()
    watchdogRef.current = setTimeout(() => {
      watchdogRef.current = null
      if (stateRef.current.status === "calling") {
        setState({ status: "idle", phoneNumber: null })
      }
    }, CALLING_WATCHDOG_MS)
  }, [clearWatchdog])

  const cancelLocalCalling = useCallback(() => {
    clearWatchdog()
    if (stateRef.current.status === "calling") {
      setState({ status: "idle", phoneNumber: null })
    }
  }, [clearWatchdog])

  return { state, beginLocalCalling, cancelLocalCalling }
}
