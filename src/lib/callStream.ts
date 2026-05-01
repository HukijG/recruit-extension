import { useStorage } from "@plasmohq/storage/hook"
import { useCallback, useEffect, useRef, useState } from "react"

import { localStore } from "~lib/constants"
import type { CallStreamState, CallStreamStatus } from "~lib/types"

// Single long-lived SSE stream against the middleware that pushes per-
// consultant call-state transitions. Spec:
// dialpad-call-event-hangup-handling.md (idle | calling | active | ended).
// EventSource is opened once per sidepanel mount and shared across both
// candidate-mode and test_call-mode via CallStreamContext, so a multi-tab
// consultant sees one unified Call/Hangup state.

const MIDDLEWARE_URL = process.env.PLASMO_PUBLIC_MIDDLEWARE_URL
const ROUTE_PATH = "/extension-call-stream"

// 15s — if /dialpad-call returns 200 but Dialpad never fires the matching
// `calling` event, SSE will never push us to `active`. Worker-side the watch
// KV expires after 90s, but the user needs the button re-enabled much sooner.
// The revert is silent — by request, we never surface a "Failed — retry"
// label; the button just goes back to "Call" so the user can try again.
const CALLING_WATCHDOG_MS = 15_000

export interface UseCallStreamReturn {
  state: CallStreamState
  beginLocalCalling: (phoneNumber: string) => void
  cancelLocalCalling: () => void
}

export function useCallStream(): UseCallStreamReturn {
  const [consultantFirstName] = useStorage<string>(
    { key: "consultantFirstName", instance: localStore },
    ""
  )

  const [state, setState] = useState<CallStreamState>({
    status: "idle",
    phoneNumber: null
  })

  // Latest state held in a ref so the watchdog timeout can read the current
  // status without restarting itself on every state change.
  const stateRef = useRef(state)
  stateRef.current = state

  const watchdogRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const clearWatchdog = useCallback(() => {
    if (watchdogRef.current) {
      clearTimeout(watchdogRef.current)
      watchdogRef.current = null
    }
  }, [])

  const startWatchdog = useCallback(() => {
    clearWatchdog()
    watchdogRef.current = setTimeout(() => {
      watchdogRef.current = null
      // Only revert if we're still in `calling` — SSE may have already moved
      // us to active/ended/idle in the meantime. Silent revert by design.
      if (stateRef.current.status === "calling") {
        setState({ status: "idle", phoneNumber: null })
      }
    }, CALLING_WATCHDOG_MS)
  }, [clearWatchdog])

  // Helper: apply a new status, managing the watchdog as a side effect of
  // entering/leaving the `calling` state.
  const transitionTo = useCallback(
    (next: CallStreamState) => {
      const prevStatus = stateRef.current.status
      if (prevStatus !== "calling" && next.status === "calling") {
        startWatchdog()
      } else if (prevStatus === "calling" && next.status !== "calling") {
        clearWatchdog()
      }
      setState(next)
    },
    [startWatchdog, clearWatchdog]
  )

  // SSE subscription — opens once we have a consultantFirstName and a
  // configured middleware URL. EventSource auto-reconnects on transport
  // failures; the DO replays current state on reconnect, so we never poll.
  useEffect(() => {
    if (!MIDDLEWARE_URL || !consultantFirstName) return

    const url = new URL(`${MIDDLEWARE_URL.replace(/\/+$/, "")}${ROUTE_PATH}`)
    url.searchParams.set("consultantFirstName", consultantFirstName)

    const es = new EventSource(url.toString())

    const onState = (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data) as {
          state: CallStreamStatus
          phoneNumber?: string | null
        }
        transitionTo({
          status: data.state,
          phoneNumber: data.phoneNumber ?? null
        })
      } catch (err) {
        console.warn("[callStream] failed to parse state event", err)
      }
    }

    es.addEventListener("state", onState)
    // `hello` fires once on connect — just confirms the stream is live; no
    // extra handling needed beyond letting EventSource swallow it.

    return () => {
      es.removeEventListener("state", onState)
      es.close()
    }
  }, [consultantFirstName, transitionTo])

  useEffect(() => () => clearWatchdog(), [clearWatchdog])

  const beginLocalCalling = useCallback(
    (phoneNumber: string) => {
      // Stamp the phone we're dialing so per-candidate views can phone-match
      // against state.phoneNumber and only render Calling…/Hangup when we're
      // looking at the candidate the call is for.
      transitionTo({ status: "calling", phoneNumber })
    },
    [transitionTo]
  )

  const cancelLocalCalling = useCallback(() => {
    if (stateRef.current.status === "calling") {
      transitionTo({ status: "idle", phoneNumber: null })
    } else {
      clearWatchdog()
    }
  }, [transitionTo, clearWatchdog])

  return { state, beginLocalCalling, cancelLocalCalling }
}
