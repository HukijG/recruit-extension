// src/auth/AuthProvider.tsx
//
// React context + useAuth() hook + <RequireAuth> wrapper. The auth state
// is read reactively from chrome.storage.local via @plasmohq/storage's
// useStorage hook. Writes go through messages to the background SW.

import { sendToBackground } from "@plasmohq/messaging"
import { useStorage } from "@plasmohq/storage/hook"
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  type ReactNode
} from "react"

import type {
  AuthSession,
  AuthTransient,
  AuthTransientError,
  AuthUser
} from "~auth/storage"
import {
  AUTH_SESSION_KEY,
  AUTH_TRANSIENT_KEY,
  localStore,
  NEEDS_RECONNECT_BROADCAST
} from "~lib/constants"

type SignInResp =
  | { ok: true }
  | { ok: false; error: "auth_cancelled" | "auth_failed" }

type SignOutResp = { ok: true }

type AuthCtx = {
  user: AuthUser | null
  isAuthenticated: boolean
  isLoading: boolean
  error: AuthTransientError | null
  signIn: () => Promise<void>
  signOut: () => Promise<void>
}

const Ctx = createContext<AuthCtx | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, , { isLoading: sessionLoading }] = useStorage<AuthSession>(
    { key: AUTH_SESSION_KEY, instance: localStore },
    null
  )
  const [transient, , { isLoading: transientLoading }] = useStorage<AuthTransient>(
    { key: AUTH_TRANSIENT_KEY, instance: localStore },
    null
  )

  const isLoading = sessionLoading || transientLoading
  const hasValidSession = !!session && session.expiresAt > Date.now()
  const error = transient?.error ?? null
  const isAuthenticated = hasValidSession && error !== "needs_reconnect"

  const signIn = useCallback(async () => {
    await sendToBackground<unknown, SignInResp>({ name: "auth-sign-in" })
    // Resolution is enough — background has already written session/transient.
  }, [])

  const signOut = useCallback(async () => {
    await sendToBackground<unknown, SignOutResp>({ name: "auth-sign-out" })
  }, [])

  const value = useMemo<AuthCtx>(
    () => ({
      user: session?.user ?? null,
      isAuthenticated,
      isLoading,
      error,
      signIn,
      signOut
    }),
    [session, isAuthenticated, isLoading, error, signIn, signOut]
  )

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useAuth(): AuthCtx {
  const v = useContext(Ctx)
  if (!v) throw new Error("useAuth must be used inside <AuthProvider>")
  return v
}

export function RequireAuth({
  fallback,
  children
}: {
  fallback: ReactNode
  children: ReactNode
}) {
  const { isLoading, isAuthenticated } = useAuth()
  if (isLoading) return <FullPageSpinner />
  if (!isAuthenticated) return <>{fallback}</>
  return <>{children}</>
}

// Tiny full-bleed spinner — sized for the sidepanel.
function FullPageSpinner() {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        minHeight: "240px",
        padding: "48px 16px"
      }}>
      <div
        style={{
          width: 24,
          height: 24,
          border: "2px solid #d6dbe1",
          borderTopColor: "#0a66c2",
          borderRadius: "50%",
          animation: "spin 800ms linear infinite"
        }}
      />
    </div>
  )
}

// Listen for the lr-needs-reconnect broadcast. This is a belt-and-suspenders
// nudge — useStorage already re-renders on storage change. Importing this
// just lets us tear down stale UI faster than the storage-change event
// would otherwise arrive in some Chrome versions.
export function useNeedsReconnectListener(onReconnect: () => void) {
  useEffect(() => {
    const listener = (message: unknown) => {
      if (
        message &&
        typeof message === "object" &&
        (message as { type?: string }).type === NEEDS_RECONNECT_BROADCAST
      ) {
        onReconnect()
      }
    }
    chrome.runtime.onMessage.addListener(listener)
    return () => chrome.runtime.onMessage.removeListener(listener)
  }, [onReconnect])
}
