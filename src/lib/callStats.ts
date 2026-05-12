import { sendToBackground } from "@plasmohq/messaging"
import { useCallback, useEffect, useRef, useState } from "react"

import { useAuth } from "~auth/AuthProvider"

// Daily-calls counter hook.
//
// Three refresh triggers — covers ~99% of changes the user could see:
//   1. Mount       — sidepanel opens, badge is current immediately.
//   2. Manual call — CallButton hits this via context after a successful
//                    /dialpad-hangup so the count ticks up post-call
//                    without waiting for the timer.
//   3. 10-min loop — fallback for hangups that bypassed the extension
//                    (e.g. user hung up from the Dialpad mobile app).
//
// Failed fetches don't blow away the existing count — we'd rather show a
// slightly-stale value than flicker to "—". `daily === null` only persists
// until the first successful response.

const REFRESH_INTERVAL_MS = 10 * 60 * 1000

interface CallStatsResp {
  ok: boolean
  data?: { daily: number }
  error?: string
  status?: number
}

export interface UseCallStatsReturn {
  daily: number | null
  refresh: () => void
}

export function useCallStats(): UseCallStatsReturn {
  const { isAuthenticated } = useAuth()
  const [daily, setDaily] = useState<number | null>(null)
  const inFlightRef = useRef(false)

  const fetchStats = useCallback(async () => {
    if (inFlightRef.current) return
    if (!isAuthenticated) return
    inFlightRef.current = true
    try {
      const resp = await sendToBackground<unknown, CallStatsResp>({
        name: "getCallStats"
      }).catch((err): CallStatsResp => ({
        ok: false,
        error: err?.message ?? "Network error"
      }))
      if (resp?.ok && resp.data && typeof resp.data.daily === "number") {
        setDaily(resp.data.daily)
      } else if (resp && !resp.ok) {
        console.warn("[callStats] fetch failed:", resp.error)
      }
    } finally {
      inFlightRef.current = false
    }
  }, [isAuthenticated])

  // Mount + auth-resolution: fetch as soon as the user is authenticated.
  // Also re-fires on sign-out → sign-in (fetchStats's identity changes with
  // isAuthenticated), so a fresh sign-in repopulates the badge immediately.
  useEffect(() => {
    void fetchStats()
  }, [fetchStats])

  // 10-min fallback timer. setInterval ticks regardless of inFlightRef —
  // fetchStats's own coalescing guards against overlap.
  useEffect(() => {
    const id = setInterval(() => {
      void fetchStats()
    }, REFRESH_INTERVAL_MS)
    return () => clearInterval(id)
  }, [fetchStats])

  const refresh = useCallback(() => {
    void fetchStats()
  }, [fetchStats])

  return { daily, refresh }
}
