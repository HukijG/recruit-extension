import { useEffect, useRef, useState } from "react"

import { Menu } from "~components/select"
import { saveTemplate } from "~lib/templates"
import type { SmsTemplate, TemplateVariable } from "~lib/types"

// --- Template Editor ---
//
// Modal popover layered above the template manager (z-index 400). Dimmed
// backdrop covers the manager content; only the X-close button (or post-
// save / post-discard) tears the modal down — backdrop clicks are inert.

const EDITOR_STYLE_ATTR = "data-lr-template-editor-styles"
if (
  typeof document !== "undefined" &&
  !document.querySelector(`[${EDITOR_STYLE_ATTR}]`)
) {
  const styleEl = document.createElement("style")
  styleEl.setAttribute(EDITOR_STYLE_ATTR, "")
  styleEl.textContent = `
    @keyframes lr-tmpl-pop-in {
      0%   { opacity: 0; transform: translateY(8px) scale(0.985); }
      100% { opacity: 1; transform: translateY(0) scale(1); }
    }
    @keyframes lr-tmpl-fade-in {
      from { opacity: 0; }
      to   { opacity: 1; }
    }

    .lr-tmpl-backdrop {
      position: fixed;
      inset: 0;
      background-color: rgba(15, 23, 42, 0.32);
      z-index: 400;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 16px;
      animation: lr-tmpl-fade-in 160ms ease-out;
    }
    .lr-tmpl-popover {
      width: 100%;
      max-width: 100%;
      height: 45vh;
      min-height: 360px;
      background-color: #ffffff;
      border: 1px solid #e3e6ea;
      border-radius: 18px;
      box-shadow: 0 16px 40px rgba(15,23,42,0.22);
      padding: 26px 24px 26px;
      display: flex;
      flex-direction: column;
      animation: lr-tmpl-pop-in 220ms cubic-bezier(0.22, 1, 0.36, 1);
    }

    .lr-tmpl-close-btn {
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
    .lr-tmpl-close-btn:hover {
      background-color: #d23a2c;
      color: #ffffff;
      box-shadow: 0 2px 6px rgba(210,58,44,0.32);
    }
    .lr-tmpl-close-btn:active { transform: translateY(1px); }

    .lr-tmpl-name-input {
      width: 100%;
      box-sizing: border-box;
      padding: 13px 16px;
      font-size: 15px;
      font-weight: 500;
      color: #15171a;
      background-color: #ffffff;
      border: 1px solid #d6dbe1;
      border-radius: 12px;
      outline: none;
      font-family: inherit;
      transition: border-color 120ms ease, box-shadow 120ms ease;
    }
    .lr-tmpl-name-input:focus {
      border-color: #0a66c2;
      box-shadow: 0 0 0 3px rgba(10,102,194,0.15);
    }
    .lr-tmpl-name-input::placeholder {
      color: #2e3133;
      opacity: 1;
    }
    .lr-tmpl-name-input--error {
      border-color: #d23a2c;
    }
    .lr-tmpl-name-input--error:focus {
      border-color: #d23a2c;
      box-shadow: 0 0 0 3px rgba(210,58,44,0.15);
    }

    .lr-tmpl-body-input {
      flex: 1 1 0;
      min-height: 0;
      width: 100%;
      box-sizing: border-box;
      padding: 14px 16px;
      font-size: 15px;
      line-height: 1.5;
      color: #15171a;
      background-color: #ffffff;
      border: 1px solid #d6dbe1;
      border-radius: 14px;
      outline: none;
      resize: none;
      font-family: inherit;
      transition: border-color 120ms ease, box-shadow 120ms ease;
    }
    .lr-tmpl-body-input:focus {
      border-color: #0a66c2;
      box-shadow: 0 0 0 3px rgba(10,102,194,0.15);
    }
    .lr-tmpl-body-input::placeholder {
      color: #2e3133;
      opacity: 1;
    }
    .lr-tmpl-body-input--error {
      border-color: #d23a2c;
    }
    .lr-tmpl-body-input--error:focus {
      border-color: #d23a2c;
      box-shadow: 0 0 0 3px rgba(210,58,44,0.15);
    }

    .lr-tmpl-save-btn {
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
      font-family: inherit;
      transition: background-color 120ms ease, border-color 120ms ease, transform 120ms ease, box-shadow 120ms ease;
      box-shadow: 0 1px 0 rgba(0,0,0,0.04);
    }
    .lr-tmpl-save-btn:hover {
      background-color: #178044;
      border-color: #178044;
      box-shadow: 0 2px 6px rgba(31,157,85,0.32);
    }
    .lr-tmpl-save-btn:active { transform: translateY(1px); }

    .lr-tmpl-confirm-no {
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
      font-family: inherit;
      transition: background-color 120ms ease, border-color 120ms ease, transform 120ms ease;
    }
    .lr-tmpl-confirm-no:hover {
      background-color: #f4f6f8;
      border-color: #aab1bb;
    }
    .lr-tmpl-confirm-no:active { transform: translateY(1px); }

    .lr-tmpl-confirm-yes {
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
      font-family: inherit;
      transition: background-color 120ms ease, border-color 120ms ease, transform 120ms ease, box-shadow 120ms ease;
      box-shadow: 0 1px 0 rgba(0,0,0,0.04);
    }
    .lr-tmpl-confirm-yes:hover {
      background-color: #178044;
      border-color: #178044;
      box-shadow: 0 2px 6px rgba(31,157,85,0.32);
    }
    .lr-tmpl-confirm-yes:active { transform: translateY(1px); }

    .lr-tmpl-discard-yes {
      flex: 1 1 0;
      min-width: 0;
      padding: 13px 14px;
      background-color: #d23a2c;
      color: #ffffff;
      border: 1px solid #d23a2c;
      border-radius: 999px;
      font-size: 15px;
      font-weight: 600;
      cursor: pointer;
      font-family: inherit;
      transition: background-color 120ms ease, border-color 120ms ease, transform 120ms ease, box-shadow 120ms ease;
      box-shadow: 0 1px 0 rgba(0,0,0,0.04);
    }
    .lr-tmpl-discard-yes:hover {
      background-color: #b8302a;
      border-color: #b8302a;
      box-shadow: 0 2px 6px rgba(210,58,44,0.32);
    }
    .lr-tmpl-discard-yes:active { transform: translateY(1px); }
  `
  document.head.appendChild(styleEl)
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

function SaveIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  )
}

const VARIABLE_OPTIONS: { value: TemplateVariable; label: string }[] = [
  { value: "firstName", label: "First Name" }
]

export function TemplateEditor({
  initial,
  onClose
}: {
  initial: SmsTemplate | null
  onClose: () => void
}) {
  const isEdit = initial !== null
  const initialState = useRef({
    name: initial?.name ?? "",
    body: initial?.body ?? ""
  })
  const [name, setName] = useState(initialState.current.name)
  const [body, setBody] = useState(initialState.current.body)
  const [attemptedSave, setAttemptedSave] = useState(false)
  const [confirmingSave, setConfirmingSave] = useState(false)
  const [confirmingDiscard, setConfirmingDiscard] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const bodyRef = useRef<HTMLTextAreaElement>(null)
  const nameRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    nameRef.current?.focus()
  }, [])

  const dirty =
    name !== initialState.current.name || body !== initialState.current.body
  const nameError = attemptedSave && name.trim().length === 0
  const bodyError = attemptedSave && body.trim().length === 0

  const handleSaveClick = () => {
    setErrorMessage(null)
    if (name.trim().length === 0 || body.trim().length === 0) {
      setAttemptedSave(true)
      return
    }
    setAttemptedSave(true)
    setConfirmingSave(true)
  }

  const handleConfirmYes = async () => {
    try {
      await saveTemplate({
        id: initial?.id,
        name: name.trim(),
        body
      })
      onClose()
    } catch (e) {
      setConfirmingSave(false)
      setErrorMessage("Couldn't save — try again")
    }
  }

  const handleClose = () => {
    if (!dirty) {
      onClose()
      return
    }
    setConfirmingSave(false)
    setConfirmingDiscard(true)
  }

  const insertVariable = (variable: TemplateVariable) => {
    const token = `{{${variable}}}`
    const ta = bodyRef.current
    if (!ta) {
      setBody((prev) => prev + token)
      return
    }
    const start = ta.selectionStart
    const end = ta.selectionEnd
    const next = body.slice(0, start) + token + body.slice(end)
    setBody(next)
    requestAnimationFrame(() => {
      ta.focus()
      ta.setSelectionRange(start + token.length, start + token.length)
    })
  }

  return (
    <div
      className="lr-tmpl-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="lr-tmpl-title">
      <div className="lr-tmpl-popover">
        <header style={editorStyles.header}>
          <h2 id="lr-tmpl-title" style={editorStyles.title}>
            {isEdit ? "Edit template" : "New template"}
          </h2>
          <button
            type="button"
            onClick={handleClose}
            className="lr-tmpl-close-btn"
            aria-label="Close template editor">
            <CloseIcon />
          </button>
        </header>

        <div style={editorStyles.variableRow}>
          <Menu<TemplateVariable>
            options={VARIABLE_OPTIONS}
            triggerLabel="+ Add Variable"
            onSelect={insertVariable}
            size="pill"
          />
        </div>

        <span style={editorStyles.fieldLabel}>TEMPLATE NAME</span>
        <input
          ref={nameRef}
          type="text"
          className={
            "lr-tmpl-name-input" +
            (nameError ? " lr-tmpl-name-input--error" : "")
          }
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Initial outreach"
          maxLength={80}
          aria-invalid={nameError}
        />
        {nameError && <p style={editorStyles.errorText}>Name is required</p>}

        <textarea
          ref={bodyRef}
          className={
            "lr-tmpl-body-input" +
            (bodyError ? " lr-tmpl-body-input--error" : "")
          }
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Hi {{firstName}}, …"
          aria-invalid={bodyError}
          style={editorStyles.bodyInputWrap}
        />
        {bodyError && <p style={editorStyles.errorText}>Body is required</p>}

        <div style={editorStyles.footer}>
          {confirmingDiscard ? (
            <div style={editorStyles.confirmBlock}>
              <p style={editorStyles.confirmPrompt}>
                You have unsaved changes — discard?
              </p>
              <div style={editorStyles.confirmButtons}>
                <button
                  type="button"
                  onClick={() => setConfirmingDiscard(false)}
                  className="lr-tmpl-confirm-no">
                  No
                </button>
                <button
                  type="button"
                  onClick={onClose}
                  className="lr-tmpl-discard-yes">
                  Yes, discard
                </button>
              </div>
            </div>
          ) : confirmingSave ? (
            <div style={editorStyles.confirmBlock}>
              <p style={editorStyles.confirmPrompt}>Are you sure?</p>
              <div style={editorStyles.confirmButtons}>
                <button
                  type="button"
                  onClick={() => setConfirmingSave(false)}
                  className="lr-tmpl-confirm-no">
                  No
                </button>
                <button
                  type="button"
                  onClick={handleConfirmYes}
                  className="lr-tmpl-confirm-yes">
                  Yes
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={handleSaveClick}
              className="lr-tmpl-save-btn">
              <SaveIcon />
              Save Template
            </button>
          )}
        </div>
        {errorMessage && (
          <p style={editorStyles.errorBelowFooter}>{errorMessage}</p>
        )}
      </div>
    </div>
  )
}

const editorStyles: Record<string, React.CSSProperties> = {
  header: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "12px",
    margin: "0 0 12px 0"
  },
  title: {
    margin: 0,
    fontSize: "19px",
    fontWeight: 700,
    lineHeight: 1.2,
    color: "#15171a",
    letterSpacing: "-0.01em"
  },
  variableRow: {
    display: "flex",
    alignItems: "center",
    margin: "0 0 14px 0"
  },
  fieldLabel: {
    fontSize: "12px",
    fontWeight: 700,
    letterSpacing: "0.04em",
    color: "#3c4043",
    textTransform: "uppercase",
    margin: "0 0 6px 0",
    display: "block"
  },
  bodyInputWrap: {
    margin: "14px 0 0 0"
  },
  errorText: {
    margin: "6px 0 0 0",
    fontSize: "12px",
    fontWeight: 500,
    color: "#a82a20"
  },
  errorBelowFooter: {
    margin: "8px 0 0 0",
    fontSize: "12px",
    fontWeight: 500,
    color: "#a82a20",
    textAlign: "center"
  },
  footer: {
    flexShrink: 0,
    margin: "16px 0 0 0",
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
