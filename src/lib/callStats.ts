import { sendToBackground } from "@plasmohq/messaging"
import { useCallback, useEffect, useRef, useState } from "react"

import { useAuth } from "~auth/AuthProvider"

// Daily-calls counter hook.
//
// Refresh triggers — covers ~all paths the count could change behind the badge:
//   1. Mount         — sidepanel opens, badge is current immediately.
//   2. Visibility    — sidepanel becomes visible after being hidden (Chrome
//                      caches the side panel DOM between opens; this catches
//                      stats that updated while the panel was closed).
//   3. Tab URL       — full navigation in any tab (Recruiter SPA also fires
//                      this when initial load completes).
//   4. SPA pushState — chrome.webNavigation.onHistoryStateUpdated, scoped to
//                      LinkedIn so we don't burn refreshes on unrelated tabs.
//   5. Manual        — call-start (sidepanel wraps beginLocalCalling) and
//                      post-hangup (CallButton via CallStatsRefreshContext).
//   6. 10-min loop   — fallback for hangups that bypassed the extension
//                      entirely (user hung up from the Dialpad mobile app).
//
// All triggers coalesce through inFlightRef — concurrent triggers (e.g.
// visibility + URL change firing within the same tick) collapse to a single
// network call. Failed fetches don't blow away the existing count so the
// badge never flickers to "—" once it has a real value.

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

  // Mount + auth-resolution.
  useEffect(() => {
    void fetchStats()
  }, [fetchStats])

  // 10-min fallback timer for hangups that never touched the extension.
  useEffect(() => {
    const id = setInterval(() => {
      void fetchStats()
    }, REFRESH_INTERVAL_MS)
    return () => clearInterval(id)
  }, [fetchStats])

  // Re-fetch when the sidepanel becomes visible. Chrome keeps the panel DOM
  // alive across opens, so visibilitychange is the closest signal to "user
  // just looked at the badge" without a heavier focus/blur watch.
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === "visible") void fetchStats()
    }
    document.addEventListener("visibilitychange", onVisibility)
    return () => document.removeEventListener("visibilitychange", onVisibility)
  }, [fetchStats])

  // URL change — chrome.tabs.onUpdated catches real page loads;
  // webNavigation.onHistoryStateUpdated catches Recruiter's SPA pushState
  // navigations between profiles. webNavigation filter scopes the listener
  // to linkedin.com so we don't refresh on every site the user touches.
  useEffect(() => {
    const onTab = (
      _tabId: number,
      changeInfo: chrome.tabs.TabChangeInfo
    ) => {
      if (changeInfo.url) void fetchStats()
    }
    const onHistory = () => {
      void fetchStats()
    }
    chrome.tabs.onUpdated.addListener(onTab)
    chrome.webNavigation.onHistoryStateUpdated.addListener(onHistory, {
      url: [{ hostSuffix: "linkedin.com" }]
    })
    return () => {
      chrome.tabs.onUpdated.removeListener(onTab)
      chrome.webNavigation.onHistoryStateUpdated.removeListener(onHistory)
    }
  }, [fetchStats])

  const refresh = useCallback(() => {
    void fetchStats()
  }, [fetchStats])

  return { daily, refresh }
}
