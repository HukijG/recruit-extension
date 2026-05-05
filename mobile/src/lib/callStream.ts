import { useCallback, useEffect, useRef, useState } from "react"

import { useStorage } from "~/lib/storage"
import type { CallStreamState } from "~/lib/types"

// Polling-based call-state hook against POST /extension-call-status.
// Same state machine as the extension's hook; only the dependencies that
// touched Plasmo (storage hook + env var) are swapped for the PWA equivalents.
//
// State machine (3 values, internal-only):
//   idle    → button shows "Call"
//   calling → button shows "Calling…" (disabled)
//   active  → button shows "Hangup"  (red, enabled)
//
// Polling kicks off the instant status leaves idle (no initial delay), and
// a 10s wallclock from beginLocalCalling acts as a give-up — if we haven't
// seen `in_progress` in that window (whether the worker errored, returned
// no-active-call, or stayed silent), silently revert to idle so the user
// can retry. `in_progress` flips us to `active` and clears the watchdog.

const MIDDLEWARE_URL = import.meta.env.VITE_MIDDLEWARE_URL
const ROUTE_PATH = "/extension-call-status"

const POLL_INTERVAL_MS = 500
const CALLING_WATCHDOG_MS = 10_000

export interface UseCallStreamReturn {
  state: CallStreamState
  beginLocalCalling: (phoneNumber: string) => void
  cancelLocalCalling: () => void
}

type WireState = "in_progress" | "ended"

export function useCallStream(): UseCallStreamReturn {
  const [consultantFirstName] = useStorage<string>("consultantFirstName", "")
  const [extensionSecret] = useStorage<string>("extensionSecret", "")

  const [state, setState] = useState<CallStreamState>({
    status: "idle",
    phoneNumber: null
  })

  const stateRef = useRef(state)
  stateRef.current = state

  const watchdogRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const inFlightRef = useRef<AbortController | null>(null)
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
    if (inFlightRef.current) {
      inFlightRef.current.abort()
      inFlightRef.current = null
    }
  }, [])

  // Apply a wire response. in_progress flips calling→active and clears the
  // watchdog (we got the signal, no need to give up). active+in_progress is
  // a no-op; ended terminates active but is ignored while calling — the
  // watchdog owns the give-up decision in that state.
  const applyWireState = useCallback(
    (wire: WireState) => {
      const prev = stateRef.current.status
      if (wire === "in_progress") {
        if (prev === "calling") {
          clearWatchdog()
          setState((s) => ({ status: "active", phoneNumber: s.phoneNumber }))
        }
        return
      }
      // wire === "ended"
      if (prev === "active") {
        stopPolling()
        setState({ status: "idle", phoneNumber: null })
      }
    },
    [clearWatchdog, stopPolling]
  )

  const poll = useCallback(async () => {
    if (!MIDDLEWARE_URL || !consultantFirstName) return
    if (inFlightRef.current) return

    const controller = new AbortController()
    inFlightRef.current = controller

    try {
      const url = `${MIDDLEWARE_URL.replace(/\/+$/, "")}${ROUTE_PATH}`
      const headers: Record<string, string> = {
        "Content-Type": "application/json"
      }
      if (extensionSecret) headers["X-Extension-Token"] = extensionSecret

      const resp = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify({ consultantFirstName }),
        signal: controller.signal
      })

      if (resp.status === 401 || resp.status === 403) {
        console.warn(
          `[callStream] poll ${resp.status} — stopping (config issue)`
        )
        stopPolling()
        if (stateRef.current.status !== "idle") {
          clearWatchdog()
          setState({ status: "idle", phoneNumber: null })
        }
        return
      }

      if (resp.status === 500 || resp.status === 502) return

      if (!resp.ok) {
        console.warn(
          `[callStream] poll unexpected ${resp.status} — keeping loop alive`
        )
        return
      }

      const body = (await resp.json().catch(() => null)) as {
        state?: WireState
      } | null
      if (body?.state === "in_progress" || body?.state === "ended") {
        applyWireState(body.state)
      }
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") return
      console.warn(
        "[callStream] poll error:",
        err instanceof Error ? err.message : err
      )
    } finally {
      if (inFlightRef.current === controller) {
        inFlightRef.current = null
      }
    }
  }, [
    applyWireState,
    clearWatchdog,
    consultantFirstName,
    extensionSecret,
    stopPolling
  ])

  useEffect(() => {
    pollRef.current = poll
  }, [poll])

  // Kick off polling the instant status leaves idle. The first `void
  // pollRef.current()` fires synchronously so the worst-case wait to see
  // `in_progress` is one network round-trip, not POLL_INTERVAL_MS + RTT.
  // setInterval then maintains the 500ms cadence until status returns to
  // idle (cancel, ended, watchdog, or auth failure).
  useEffect(() => {
    if (state.status === "idle") {
      stopPolling()
      return
    }
    if (intervalRef.current) return
    void pollRef.current()
    intervalRef.current = setInterval(() => {
      void pollRef.current()
    }, POLL_INTERVAL_MS)
  }, [state.status, stopPolling])

  useEffect(() => {
    return () => {
      stopPolling()
      clearWatchdog()
    }
  }, [stopPolling, clearWatchdog])

  const beginLocalCalling = useCallback(
    (phoneNumber: string) => {
      // Stamp the dialed phone so per-candidate views can phone-match
      // state.phoneNumber and only show Calling…/Hangup on the right
      // profile. The polling effect picks up the calling status and starts
      // hitting /extension-call-status immediately.
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
    },
    [clearWatchdog]
  )

  const cancelLocalCalling = useCallback(() => {
    clearWatchdog()
    if (stateRef.current.status === "calling") {
      setState({ status: "idle", phoneNumber: null })
    }
  }, [clearWatchdog])

  return { state, beginLocalCalling, cancelLocalCalling }
}
