import { useStorage } from "@plasmohq/storage/hook"
import { useCallback, useEffect, useRef, useState } from "react"

import { localStore } from "~lib/constants"
import type { CallStreamState } from "~lib/types"

// Polling-based call-state hook against POST /extension-call-status.
// Spec: the middleware polling-update handover.
//
// State machine (3 values, internal-only):
//   idle    → button shows "Call"
//   calling → button shows "Calling…" (disabled, brief)
//   active  → button shows "Hangup"  (red, enabled)
//
// The worker only reports two wire states (`in_progress`, `ended`); we
// translate those to transitions over the local 3-value status. Polling only
// runs while status !== "idle"; on sidepanel reopen we never rehydrate "a
// call is in progress elsewhere" — by handover, cross-navigation is
// deliberately not durable.
//
// Polling kicks off the instant status leaves idle (no initial delay), and
// after 2s of `calling` we optimistically flip to `active` regardless of
// whether `in_progress` has landed — the worker's call discovery often
// takes longer than the user is willing to look at a grey button, and a
// real Hangup affordance is more useful than an honest one. Polling will
// flip to `active` earlier if `in_progress` arrives sooner. Once in
// `active`, only an `ended` wire event (or cancelLocalCalling) leaves.

const MIDDLEWARE_URL = process.env.PLASMO_PUBLIC_MIDDLEWARE_URL
const ROUTE_PATH = "/extension-call-status"

// 500ms cadence — handover's recommended sweet spot. 250ms minimum (no
// benefit, burns quota); 1s maximum (sluggish hangup detection).
const POLL_INTERVAL_MS = 500

// 2s after beginLocalCalling, optimistically promote calling→active so
// the user gets a usable Hangup button even before the worker has confirmed
// the call_id via Dialpad's call-list.
const OPTIMISTIC_ACTIVE_MS = 2_000

export interface UseCallStreamReturn {
  state: CallStreamState
  beginLocalCalling: (phoneNumber: string) => void
  cancelLocalCalling: () => void
}

type WireState = "in_progress" | "ended"

export function useCallStream(): UseCallStreamReturn {
  const [consultantFirstName] = useStorage<string>(
    { key: "consultantFirstName", instance: localStore },
    ""
  )
  const [extensionSecret] = useStorage<string>(
    { key: "extensionSecret", instance: localStore },
    ""
  )

  const [state, setState] = useState<CallStreamState>({
    status: "idle",
    phoneNumber: null
  })

  // Latest state in a ref so the polling loop can read the current status
  // without re-arming itself on every state change.
  const stateRef = useRef(state)
  stateRef.current = state

  const optimisticRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const inFlightRef = useRef<AbortController | null>(null)
  // setInterval captures poll at arming time, but poll's identity changes
  // when consultantFirstName / extensionSecret resolve from useStorage. The
  // ref lets the interval call the LATEST poll without rearming the timer.
  const pollRef = useRef<() => Promise<void>>(async () => {})

  const clearOptimistic = useCallback(() => {
    if (optimisticRef.current) {
      clearTimeout(optimisticRef.current)
      optimisticRef.current = null
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
  // pending optimistic timer (we got the real signal). active+in_progress
  // is a no-op; ended terminates active but is ignored while calling — the
  // optimistic timer owns the calling→active transition.
  const applyWireState = useCallback((wire: WireState) => {
    const prev = stateRef.current.status
    if (wire === "in_progress") {
      if (prev === "calling") {
        clearOptimistic()
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
  }, [clearOptimistic, stopPolling])

  // The poll itself. Direct fetch from the hook (matches the prior SSE
  // pattern; avoids 180-per-call background-messaging round trips).
  const poll = useCallback(async () => {
    if (!MIDDLEWARE_URL || !consultantFirstName) return
    // Coalesce — never run two polls in flight. The interval may fire while
    // the previous request hasn't returned; in that case skip.
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

      // Auth/registry failures are terminal — keep polling won't help. Log and
      // stop so the user isn't silently spamming 401/403.
      if (resp.status === 401 || resp.status === 403) {
        console.warn(
          `[callStream] poll ${resp.status} — stopping (config issue)`
        )
        stopPolling()
        clearOptimistic()
        if (stateRef.current.status !== "idle") {
          setState({ status: "idle", phoneNumber: null })
        }
        return
      }

      // Transient discovery / upstream failures — handover says keep polling;
      // don't backoff (500ms is already polite). Next interval tick retries.
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
    } catch (err: any) {
      // Aborted = unmount/state-cleared; not an error.
      if (err?.name === "AbortError") return
      // Network blip — keep loop alive.
      console.warn("[callStream] poll error:", err?.message ?? err)
    } finally {
      if (inFlightRef.current === controller) {
        inFlightRef.current = null
      }
    }
  }, [applyWireState, clearOptimistic, consultantFirstName, extensionSecret, stopPolling])

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
      clearOptimistic()
    }
  }, [stopPolling, clearOptimistic])

  const beginLocalCalling = useCallback((phoneNumber: string) => {
    // Stamp the dialed phone so per-candidate views can phone-match
    // state.phoneNumber against their own number — only the candidate the
    // call is for shows Calling…/Hangup. The polling effect picks up the
    // calling status and starts hitting /extension-call-status immediately.
    setState({ status: "calling", phoneNumber })
    // 2s optimistic flip — promote calling→active even if `in_progress`
    // hasn't been observed yet. Polling will overtake this if it lands
    // first; once active, only `ended` or cancel returns to idle.
    clearOptimistic()
    optimisticRef.current = setTimeout(() => {
      optimisticRef.current = null
      if (stateRef.current.status === "calling") {
        setState((s) => ({ status: "active", phoneNumber: s.phoneNumber }))
      }
    }, OPTIMISTIC_ACTIVE_MS)
  }, [clearOptimistic])

  const cancelLocalCalling = useCallback(() => {
    clearOptimistic()
    if (stateRef.current.status === "calling") {
      setState({ status: "idle", phoneNumber: null })
    }
  }, [clearOptimistic])

  return { state, beginLocalCalling, cancelLocalCalling }
}
