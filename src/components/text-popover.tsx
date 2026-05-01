import { useEffect, useRef, useState } from "react"

import { useStorage } from "@plasmohq/storage/hook"

import { TemplateManager } from "~components/template-manager"
import { Select } from "~components/select"
import { localStore, TEMPLATES_STORAGE_KEY } from "~lib/constants"
import { substituteFirstName } from "~lib/templates"
import type { SmsTemplate } from "~lib/types"

// --- Text Popover ---
//
// Owns the SMS composer UI: action-row trigger button, dimmed-backdrop
// overlay, textarea, and the confirm-before-send split. Backend wiring is
// deferred — clicking "Yes" logs the payload and closes. When the middleware
// route lands, swap `handleYes` for a `sendToBackground({ name: ... })` call.
//
// CSS for hover/focus/animation lives here (not sidepanel.tsx) so the
// feature stays self-contained — sidepanel.tsx only orchestrates modes.

const TEXT_POPOVER_STYLE_ATTR = "data-lr-text-styles"
if (
  typeof document !== "undefined" &&
  !document.querySelector(`[${TEXT_POPOVER_STYLE_ATTR}]`)
) {
  const styleEl = document.createElement("style")
  styleEl.setAttribute(TEXT_POPOVER_STYLE_ATTR, "")
  styleEl.textContent = `
    @keyframes lr-text-pop-in {
      0%   { opacity: 0; transform: translateY(8px) scale(0.985); }
      100% { opacity: 1; transform: translateY(0) scale(1); }
    }
    @keyframes lr-text-fade-in {
      from { opacity: 0; }
      to   { opacity: 1; }
    }

    /* ----- Trigger button (lives on the candidate action row) ----- */
    .lr-text-btn {
      flex: 1 1 0;
      min-width: 0;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      padding: 10px 10px;
      background-color: #0a66c2;
      color: #ffffff;
      border: 1px solid #0a66c2;
      border-radius: 999px;
      font-size: 14px;
      font-weight: 600;
      cursor: pointer;
      transition: background-color 120ms ease, border-color 120ms ease, transform 120ms ease, box-shadow 120ms ease;
      box-shadow: 0 1px 0 rgba(0,0,0,0.04);
      white-space: nowrap;
    }
    .lr-text-btn:hover {
      background-color: #084e9c;
      border-color: #084e9c;
      box-shadow: 0 2px 6px rgba(10,102,194,0.32);
    }
    .lr-text-btn:active {
      transform: translateY(1px);
      box-shadow: 0 1px 0 rgba(0,0,0,0.04);
    }
    .lr-text-btn:disabled {
      background-color: #eef0f2;
      color: #98a2ad;
      border-color: #e3e6ea;
      cursor: not-allowed;
      box-shadow: none;
    }

    /* ----- Backdrop + popover container ----- */
    .lr-text-backdrop {
      position: fixed;
      inset: 0;
      background-color: rgba(15, 23, 42, 0.32);
      z-index: 200;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 16px;
      animation: lr-text-fade-in 160ms ease-out;
    }
    .lr-text-popover {
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
      animation: lr-text-pop-in 220ms cubic-bezier(0.22, 1, 0.36, 1);
    }

    /* ----- X close button (red circle, fills on hover) ----- */
    .lr-text-close-btn {
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
    .lr-text-close-btn:hover {
      background-color: #d23a2c;
      color: #ffffff;
      box-shadow: 0 2px 6px rgba(210,58,44,0.32);
    }
    .lr-text-close-btn:active {
      transform: translateY(1px);
    }

    .lr-text-edit-btn {
      width: 30px;
      height: 30px;
      flex-shrink: 0;
      background-color: transparent;
      color: #0a66c2;
      border: 1px solid #0a66c2;
      border-radius: 50%;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      padding: 0;
      transition: background-color 120ms ease, color 120ms ease, box-shadow 120ms ease, transform 120ms ease;
    }
    .lr-text-edit-btn:hover {
      background-color: #0a66c2;
      color: #ffffff;
      box-shadow: 0 2px 6px rgba(10,102,194,0.32);
    }
    .lr-text-edit-btn:active {
      transform: translateY(1px);
    }
    .lr-text-edit-btn:focus-visible {
      outline: none;
      box-shadow: 0 0 0 3px rgba(10,102,194,0.25);
    }

    /* ----- Textarea ----- */
    .lr-text-input {
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
    .lr-text-input:focus {
      border-color: #0a66c2;
      box-shadow: 0 0 0 3px rgba(10,102,194,0.15);
    }
    .lr-text-input::placeholder {
      color: #2e3133;
      opacity: 1;
    }

    /* ----- Send Text button (mirrors lr-call-btn, sized up slightly) ----- */
    .lr-text-send-btn {
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
    .lr-text-send-btn:hover {
      background-color: #178044;
      border-color: #178044;
      box-shadow: 0 2px 6px rgba(31,157,85,0.32);
    }
    .lr-text-send-btn:active { transform: translateY(1px); }
    .lr-text-send-btn:disabled {
      background-color: #eef0f2;
      color: #98a2ad;
      border-color: #e3e6ea;
      cursor: not-allowed;
      box-shadow: none;
    }

    /* ----- Confirm split: No (outlined) + Yes (green filled) ----- */
    .lr-text-confirm-no {
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
    .lr-text-confirm-no:hover {
      background-color: #f4f6f8;
      border-color: #aab1bb;
    }
    .lr-text-confirm-no:active { transform: translateY(1px); }

    .lr-text-confirm-yes {
      flex: 1 1 0;
      min-width: 0;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
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
    .lr-text-confirm-yes:hover {
      background-color: #178044;
      border-color: #178044;
      box-shadow: 0 2px 6px rgba(31,157,85,0.32);
    }
    .lr-text-confirm-yes:active { transform: translateY(1px); }
  `
  document.head.appendChild(styleEl)
}

function ChatBubbleIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true">
      <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
    </svg>
  )
}

function PaperPlaneIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true">
      <line x1="22" y1="2" x2="11" y2="13" />
      <polygon points="22 2 15 22 11 13 2 9 22 2" />
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

function PencilIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true">
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.121 2.121 0 1 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
    </svg>
  )
}

export function TextButton({
  phoneNumber,
  onClick
}: {
  phoneNumber: string | null
  onClick: () => void
}) {
  if (!phoneNumber) {
    return (
      <button
        type="button"
        disabled
        className="lr-text-btn"
        aria-label="Text (no phone on file)">
        <ChatBubbleIcon />
        Text
      </button>
    )
  }
  return (
    <button
      type="button"
      onClick={onClick}
      className="lr-text-btn"
      aria-label={`Text ${phoneNumber}`}>
      <ChatBubbleIcon />
      Text
    </button>
  )
}

export function TextPopover({
  fullName,
  phoneNumber,
  callerAliasId,
  onClose
}: {
  fullName: string
  phoneNumber: string | null
  callerAliasId?: string
  onClose: () => void
}) {
  const [text, setText] = useState("")
  const [confirming, setConfirming] = useState(false)
  const [managerOpen, setManagerOpen] = useState(false)
  const [selectedTemplateId, setSelectedTemplateId] = useState("")
  const [stored] = useStorage<SmsTemplate[]>(
    { key: TEMPLATES_STORAGE_KEY, instance: localStore },
    []
  )
  const templates = [...(stored ?? [])].sort((a, b) =>
    b.updatedAt.localeCompare(a.updatedAt)
  )
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // Autofocus on mount so the user can start typing without an extra click.
  useEffect(() => {
    textareaRef.current?.focus()
  }, [])

  const trimmed = text.trim()
  const canSend = trimmed.length > 0

  const handleSendClick = () => {
    if (!canSend) return
    setConfirming(true)
  }

  const handleNo = () => setConfirming(false)

  const handlePickTemplate = (templateId: string) => {
    const template = templates.find((t) => t.id === templateId)
    if (!template) return
    const firstName = (fullName ?? "").split(" ")[0] ?? ""
    setText(substituteFirstName(template.body, firstName))
    setSelectedTemplateId(templateId)
  }

  useEffect(() => {
    if (!selectedTemplateId) return
    if (!templates.some((t) => t.id === selectedTemplateId)) {
      setSelectedTemplateId("")
    }
  }, [templates, selectedTemplateId])

  const handleYes = () => {
    // Backend wiring deferred; surface the payload that will eventually go to
    // the middleware so we can sanity-check what it'll receive.
    // eslint-disable-next-line no-console
    console.log("[TextPopover] would send:", {
      fullName,
      phoneNumber,
      callerAliasId,
      text: trimmed
    })
    onClose()
  }

  // No backdrop click handler — the only close path is the X button, per
  // spec. Stop propagation isn't needed since we don't listen.
  return (
    <div
      className="lr-text-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="lr-text-title">
      <div className="lr-text-popover">
        <header style={popoverStyles.header}>
          <h2 id="lr-text-title" style={popoverStyles.title}>
            Text Candidate
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="lr-text-close-btn"
            aria-label="Close text composer">
            <CloseIcon />
          </button>
        </header>
        <div style={popoverStyles.pickerColumn}>
          <span style={popoverStyles.pickerLabel}>TEMPLATE</span>
          <div style={popoverStyles.pickerRow}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <Select<string>
                value={selectedTemplateId}
                onChange={handlePickTemplate}
                placeholder="Choose template…"
                options={templates.map((t) => ({ value: t.id, label: t.name }))}
              />
            </div>
            <button
              type="button"
              onClick={() => setManagerOpen(true)}
              className="lr-text-edit-btn"
              aria-label="Open template manager">
              <PencilIcon />
            </button>
          </div>
        </div>
        <textarea
          ref={textareaRef}
          className="lr-text-input"
          placeholder={`Message ${fullName.split(" ")[0] || "candidate"}…`}
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <div style={popoverStyles.footer}>
          {confirming ? (
            <div style={popoverStyles.confirmBlock}>
              <p style={popoverStyles.confirmPrompt}>Are you sure?</p>
              <div style={popoverStyles.confirmButtons}>
                <button
                  type="button"
                  onClick={handleNo}
                  className="lr-text-confirm-no">
                  No
                </button>
                <button
                  type="button"
                  onClick={handleYes}
                  className="lr-text-confirm-yes">
                  Yes
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={handleSendClick}
              disabled={!canSend}
              className="lr-text-send-btn">
              <PaperPlaneIcon />
              Send Text
            </button>
          )}
        </div>
      </div>
      {managerOpen && (
        <TemplateManager onClose={() => setManagerOpen(false)} />
      )}
    </div>
  )
}

const popoverStyles: Record<string, React.CSSProperties> = {
  header: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "12px",
    margin: "0 0 16px 0"
  },
  title: {
    margin: 0,
    fontSize: "19px",
    fontWeight: 700,
    lineHeight: 1.2,
    color: "#15171a",
    letterSpacing: "-0.01em"
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
  },
  pickerColumn: {
    display: "flex",
    flexDirection: "column",
    margin: "0 0 14px 0"
  },
  pickerLabel: {
    fontSize: "12px",
    fontWeight: 700,
    letterSpacing: "0.04em",
    color: "#3c4043",
    textTransform: "uppercase",
    margin: "0 0 6px 0"
  },
  pickerRow: {
    display: "flex",
    alignItems: "center",
    gap: "10px"
  }
}
