import { useEffect, useRef, useState } from "react"

// --- Settings Popover ---
//
// Universal access to consultantFirstName + extensionSecret. Reachable from
// every mode via a fixed-position gear icon top-right; previously these were
// only editable inline on the sync flow's not_on_pipeline + csv_matched
// states. Pattern mirrors text-popover.tsx (dimmed backdrop + animated card
// + Yes/No confirm split). Two-stage commit: typing only mutates draft state;
// Save opens an "Are you sure?" confirmation; X with unsaved changes opens
// "Discard unsaved changes?". No-op close paths fall through silently.

const SETTINGS_STYLE_ATTR = "data-lr-settings-styles"
if (
  typeof document !== "undefined" &&
  !document.querySelector(`[${SETTINGS_STYLE_ATTR}]`)
) {
  const styleEl = document.createElement("style")
  styleEl.setAttribute(SETTINGS_STYLE_ATTR, "")
  styleEl.textContent = `
    @keyframes lr-settings-pop-in {
      0%   { opacity: 0; transform: translateY(8px) scale(0.985); }
      100% { opacity: 1; transform: translateY(0) scale(1); }
    }
    @keyframes lr-settings-fade-in {
      from { opacity: 0; }
      to   { opacity: 1; }
    }

    /* ----- Gear icon (fixed top-right, sits above page content but
       below modal backdrops at z-index 200 so any open modal dims it
       just like the rest of the page). ----- */
    .lr-settings-icon-btn {
      position: fixed;
      top: 12px;
      right: 12px;
      z-index: 100;
      width: 30px;
      height: 30px;
      flex-shrink: 0;
      background-color: #ffffff;
      color: #3c4043;
      border: 1px solid #c2c8d0;
      border-radius: 50%;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      padding: 0;
      box-shadow: 0 1px 2px rgba(15,23,42,0.06);
      transition: background-color 120ms ease, border-color 120ms ease, color 120ms ease, box-shadow 120ms ease, transform 120ms ease;
    }
    .lr-settings-icon-btn:hover {
      background-color: #f4f6f8;
      border-color: #aab1bb;
      color: #15171a;
      box-shadow: 0 2px 6px rgba(15,23,42,0.12);
    }
    .lr-settings-icon-btn:active {
      transform: translateY(1px);
      box-shadow: 0 1px 2px rgba(15,23,42,0.06);
    }
    .lr-settings-icon-btn:focus-visible {
      outline: 2px solid #0a66c2;
      outline-offset: 2px;
    }

    /* ----- Backdrop + popover container (mirrors lr-text-*) ----- */
    .lr-settings-backdrop {
      position: fixed;
      inset: 0;
      background-color: rgba(15, 23, 42, 0.32);
      z-index: 200;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 16px;
      animation: lr-settings-fade-in 160ms ease-out;
    }
    .lr-settings-popover {
      width: 100%;
      max-width: 100%;
      background-color: #ffffff;
      border: 1px solid #e3e6ea;
      border-radius: 18px;
      box-shadow: 0 16px 40px rgba(15,23,42,0.22);
      padding: 26px 24px 26px;
      display: flex;
      flex-direction: column;
      animation: lr-settings-pop-in 220ms cubic-bezier(0.22, 1, 0.36, 1);
    }

    /* ----- X close button (matches lr-text-close-btn) ----- */
    .lr-settings-close-btn {
      width: 30px;
      height: 30px;
      flex-shrink: 0;
      background-color: transparent;
      color: #d23a2c;
      border: 1px solid #d23a2c;
      border-radius: 50%;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      padding: 0;
      transition: background-color 120ms ease, color 120ms ease, box-shadow 120ms ease, transform 120ms ease;
    }
    .lr-settings-close-btn:hover {
      background-color: #d23a2c;
      color: #ffffff;
      box-shadow: 0 2px 6px rgba(210,58,44,0.32);
    }
    .lr-settings-close-btn:active {
      transform: translateY(1px);
    }

    /* ----- Field stack ----- */
    .lr-settings-field {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .lr-settings-label {
      font-size: 12px;
      font-weight: 700;
      letter-spacing: 0.04em;
      color: #3c4043;
      text-transform: uppercase;
    }
    .lr-settings-input {
      width: 100%;
      box-sizing: border-box;
      padding: 11px 13px;
      font-size: 15px;
      line-height: 1.4;
      color: #15171a;
      background-color: #ffffff;
      border: 1px solid #d6dbe1;
      border-radius: 10px;
      outline: none;
      font-family: inherit;
      transition: border-color 120ms ease, box-shadow 120ms ease;
    }
    .lr-settings-input:focus {
      border-color: #0a66c2;
      box-shadow: 0 0 0 3px rgba(10,102,194,0.15);
    }
    .lr-settings-input::placeholder {
      color: #98a2ad;
      opacity: 1;
    }

    /* ----- Save button (mirrors lr-text-send-btn) ----- */
    .lr-settings-save-btn {
      width: 100%;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      padding: 13px 14px;
      background-color: #1f9d55;
      color: #ffffff;
      border: 1px solid #1f9d55;
      border-radius: 999px;
      font-size: 15px;
      font-weight: 600;
      cursor: pointer;
      transition: background-color 120ms ease, border-color 120ms ease, transform 120ms ease, box-shadow 120ms ease;
      box-shadow: 0 1px 0 rgba(0,0,0,0.04);
    }
    .lr-settings-save-btn:hover {
      background-color: #178044;
      border-color: #178044;
      box-shadow: 0 2px 6px rgba(31,157,85,0.32);
    }
    .lr-settings-save-btn:active { transform: translateY(1px); }
    .lr-settings-save-btn:disabled {
      background-color: #eef0f2;
      color: #98a2ad;
      border-color: #e3e6ea;
      cursor: not-allowed;
      box-shadow: none;
    }

    /* ----- Confirm split (mirrors lr-text-confirm-*) ----- */
    .lr-settings-confirm-no {
      flex: 1 1 0;
      min-width: 0;
      padding: 13px 14px;
      background-color: transparent;
      color: #2e3133;
      border: 1px solid #c2c8d0;
      border-radius: 999px;
      font-size: 15px;
      font-weight: 600;
      cursor: pointer;
      transition: background-color 120ms ease, border-color 120ms ease, transform 120ms ease;
    }
    .lr-settings-confirm-no:hover {
      background-color: #f4f6f8;
      border-color: #aab1bb;
    }
    .lr-settings-confirm-no:active { transform: translateY(1px); }

    .lr-settings-confirm-yes {
      flex: 1 1 0;
      min-width: 0;
      padding: 13px 14px;
      background-color: #1f9d55;
      color: #ffffff;
      border: 1px solid #1f9d55;
      border-radius: 999px;
      font-size: 15px;
      font-weight: 600;
      cursor: pointer;
      transition: background-color 120ms ease, border-color 120ms ease, transform 120ms ease, box-shadow 120ms ease;
      box-shadow: 0 1px 0 rgba(0,0,0,0.04);
    }
    .lr-settings-confirm-yes:hover {
      background-color: #178044;
      border-color: #178044;
      box-shadow: 0 2px 6px rgba(31,157,85,0.32);
    }
    .lr-settings-confirm-yes:active { transform: translateY(1px); }
  `
  document.head.appendChild(styleEl)
}

function GearIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  )
}

function CloseIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true">
      <line x1="6" y1="6" x2="18" y2="18" />
      <line x1="18" y1="6" x2="6" y2="18" />
    </svg>
  )
}

export function SettingsButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="lr-settings-icon-btn"
      aria-label="Open settings">
      <GearIcon />
    </button>
  )
}

type ConfirmKind = "save" | "discard" | null

export function SettingsPopover({
  initialName,
  initialSecret,
  onSave,
  onClose
}: {
  initialName: string
  initialSecret: string
  onSave: (name: string, secret: string) => void
  onClose: () => void
}) {
  // Drafts seeded once from the props the parent loaded out of storage. Parent
  // only mounts this popover after both values have resolved, so initial state
  // is always the truth-of-record at open time.
  const [draftName, setDraftName] = useState(initialName)
  const [draftSecret, setDraftSecret] = useState(initialSecret)
  const [confirming, setConfirming] = useState<ConfirmKind>(null)

  const nameInputRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    nameInputRef.current?.focus()
    nameInputRef.current?.select()
  }, [])

  const trimmedName = draftName.trim()
  const dirty = draftName !== initialName || draftSecret !== initialSecret
  // Empty name was rejected by the inline EditableNameHeading too; keep the
  // floor here so commits never write a blank consultantFirstName.
  const canSave = dirty && trimmedName.length > 0

  const handleSaveClick = () => {
    if (!canSave) return
    setConfirming("save")
  }

  const handleCloseClick = () => {
    if (dirty) {
      setConfirming("discard")
    } else {
      onClose()
    }
  }

  const handleConfirmYes = () => {
    if (confirming === "save") {
      onSave(trimmedName, draftSecret)
      onClose()
    } else if (confirming === "discard") {
      onClose()
    }
  }

  const handleConfirmNo = () => {
    setConfirming(null)
  }

  const confirmPrompt =
    confirming === "save"
      ? "Save these changes?"
      : confirming === "discard"
        ? "Discard unsaved changes?"
        : ""

  return (
    <div
      className="lr-settings-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="lr-settings-title">
      <div className="lr-settings-popover">
        <header style={popoverStyles.header}>
          <h2 id="lr-settings-title" style={popoverStyles.title}>
            Settings
          </h2>
          <button
            type="button"
            onClick={handleCloseClick}
            className="lr-settings-close-btn"
            aria-label="Close settings">
            <CloseIcon />
          </button>
        </header>

        <div style={popoverStyles.fields}>
          <div className="lr-settings-field">
            <label htmlFor="lr-settings-name" className="lr-settings-label">
              Your first name
            </label>
            <input
              ref={nameInputRef}
              id="lr-settings-name"
              type="text"
              className="lr-settings-input"
              value={draftName}
              onChange={(e) => setDraftName(e.target.value)}
              placeholder="e.g. Joel"
              autoComplete="off"
            />
          </div>
          <div className="lr-settings-field">
            <label htmlFor="lr-settings-secret" className="lr-settings-label">
              Extension secret
            </label>
            <input
              id="lr-settings-secret"
              type="password"
              className="lr-settings-input"
              value={draftSecret}
              onChange={(e) => setDraftSecret(e.target.value)}
              placeholder="Enter secret…"
              autoComplete="off"
            />
          </div>
        </div>

        <div style={popoverStyles.footer}>
          {confirming ? (
            <div style={popoverStyles.confirmBlock}>
              <p style={popoverStyles.confirmPrompt}>{confirmPrompt}</p>
              <div style={popoverStyles.confirmButtons}>
                <button
                  type="button"
                  onClick={handleConfirmNo}
                  className="lr-settings-confirm-no">
                  No
                </button>
                <button
                  type="button"
                  onClick={handleConfirmYes}
                  className="lr-settings-confirm-yes">
                  Yes
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={handleSaveClick}
              disabled={!canSave}
              className="lr-settings-save-btn">
              Save
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

const popoverStyles: Record<string, React.CSSProperties> = {
  header: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "12px",
    margin: "0 0 18px 0"
  },
  title: {
    margin: 0,
    fontSize: "19px",
    fontWeight: 700,
    lineHeight: 1,
    color: "#15171a",
    letterSpacing: "-0.01em"
  },
  fields: {
    display: "flex",
    flexDirection: "column",
    gap: "14px"
  },
  footer: {
    flexShrink: 0,
    margin: "20px 0 0 0",
    display: "flex",
    flexDirection: "column"
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
