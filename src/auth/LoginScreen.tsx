// src/auth/LoginScreen.tsx
//
// Full-page welcome shown when <RequireAuth> falls back. Reuses the
// welcome-hero styling from sync.tsx's onboarding (lifted to
// lib/styles/welcome.ts). Per CLAUDE.md design rules, errs on the side
// of bigger text / more space / darker colours.

import { useState } from "react"

import { useAuth } from "~auth/AuthProvider"
import { welcomeStyles } from "~lib/styles/welcome"

const LOGIN_STYLE_ATTR = "data-lr-login-styles"

if (
  typeof document !== "undefined" &&
  !document.querySelector(`[${LOGIN_STYLE_ATTR}]`)
) {
  const el = document.createElement("style")
  el.setAttribute(LOGIN_STYLE_ATTR, "")
  el.textContent = `
    .lr-login-btn {
      width: 100%;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      padding: 13px 16px;
      background-color: #0a66c2;
      color: #ffffff;
      border: 1px solid #0a66c2;
      border-radius: 999px;
      font-size: 15px;
      font-weight: 600;
      cursor: pointer;
      transition: background-color 120ms ease, border-color 120ms ease,
                  transform 120ms ease, box-shadow 120ms ease;
      box-shadow: 0 1px 3px rgba(10,102,194,0.18);
    }
    .lr-login-btn:hover {
      background-color: #084e9c;
      border-color: #084e9c;
      box-shadow: 0 4px 10px rgba(10,102,194,0.25);
      transform: translateY(-1px);
    }
    .lr-login-btn:active { transform: translateY(0); box-shadow: 0 1px 3px rgba(10,102,194,0.18); }
    .lr-login-btn:disabled {
      background-color: #aab1bb;
      border-color: #aab1bb;
      cursor: not-allowed;
      box-shadow: none;
      transform: none;
    }
    .lr-login-error {
      margin: 14px 0 0 0;
      text-align: center;
      font-size: 13px;
      font-weight: 500;
      color: #a82a20;
    }
    .lr-login-spinner {
      width: 16px;
      height: 16px;
      border: 2px solid rgba(255,255,255,0.5);
      border-top-color: #ffffff;
      border-radius: 50%;
      animation: spin 800ms linear infinite;
    }
  `
  document.head.appendChild(el)
}

function errorCopy(error: string | null): string | null {
  switch (error) {
    case "auth_failed":
      return "Sign-in didn't complete. Try again."
    case "auth_cancelled":
      return "Sign-in was cancelled. You can try again whenever you're ready."
    case "needs_reconnect":
      return "Your session expired — please sign in again."
    default:
      return null
  }
}

export function LoginScreen() {
  const { signIn, error } = useAuth()
  const [pending, setPending] = useState(false)

  const onClick = async () => {
    if (pending) return
    setPending(true)
    try {
      await signIn()
    } finally {
      setPending(false)
    }
  }

  const copy = errorCopy(error)

  return (
    <div style={welcomeStyles.greetingHero}>
      <span
        style={{ ...welcomeStyles.wave, ...welcomeStyles.waveLarge }}
        aria-hidden="true">
        👋
      </span>
      <h1 style={welcomeStyles.welcomeTitle}>
        Welcome <span style={welcomeStyles.welcomeAccent}>aboard</span>
      </h1>
      <p style={welcomeStyles.greetingBody}>
        Sign in with your Cognatio team account to start syncing
        candidates from LinkedIn Recruiter.
      </p>
      <div style={{ width: "100%", maxWidth: 320, marginTop: 18 }}>
        <button
          type="button"
          className="lr-login-btn"
          onClick={onClick}
          disabled={pending}
          aria-label="Sign in">
          {pending ? (
            <>
              <span className="lr-login-spinner" aria-hidden="true" />
              <span>Signing in…</span>
            </>
          ) : (
            "Sign in"
          )}
        </button>
        {copy && <p className="lr-login-error">{copy}</p>}
      </div>
    </div>
  )
}
