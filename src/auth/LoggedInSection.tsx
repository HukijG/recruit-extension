// src/auth/LoggedInSection.tsx
//
// Settings-popover body for the authenticated state. Renders
// "Signed in as <email>" + a Log out button with a Yes/No confirm
// flow. The popover shell stays in settings-popover.tsx; new CSS
// classes are appended to that file's existing style block.

import { useState } from "react"

import { useAuth } from "~auth/AuthProvider"

type Phase = "idle" | "confirming"

export function LoggedInSection({ onAfterSignOut }: { onAfterSignOut: () => void }) {
  const { user, signOut } = useAuth()
  const [phase, setPhase] = useState<Phase>("idle")

  if (!user) return null  // <RequireAuth> already gates; this is a defensive null.

  const onLogoutClick = () => setPhase("confirming")
  const onCancel = () => setPhase("idle")
  const onConfirm = async () => {
    await signOut()
    onAfterSignOut()
  }

  return (
    <div style={sectionStyles.root}>
      <div className="lr-settings-field">
        <span className="lr-settings-label">Signed in as</span>
        <span style={sectionStyles.email}>{user.email}</span>
      </div>

      {phase === "idle" && (
        <button
          type="button"
          className="lr-settings-logout-btn"
          onClick={onLogoutClick}>
          Log out
        </button>
      )}

      {phase === "confirming" && (
        <div style={sectionStyles.confirmBlock}>
          <p style={sectionStyles.confirmPrompt}>Log out of this extension?</p>
          <div style={sectionStyles.confirmButtons}>
            <button
              type="button"
              className="lr-settings-confirm-no"
              onClick={onCancel}>
              No
            </button>
            <button
              type="button"
              className="lr-settings-confirm-yes-destructive"
              onClick={onConfirm}>
              Yes
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

const sectionStyles: Record<string, React.CSSProperties> = {
  root: {
    display: "flex",
    flexDirection: "column",
    gap: "18px"
  },
  email: {
    fontSize: "15px",
    fontWeight: 500,
    color: "#15171a",
    wordBreak: "break-all"
  },
  confirmBlock: {
    display: "flex",
    flexDirection: "column",
    alignItems: "stretch",
    gap: "10px"
  },
  confirmPrompt: {
    margin: 0,
    fontSize: "15px",
    fontWeight: 600,
    color: "#15171a",
    textAlign: "center",
    letterSpacing: "0.01em"
  },
  confirmButtons: {
    display: "flex",
    flexDirection: "row",
    alignItems: "stretch",
    gap: "10px"
  }
}
