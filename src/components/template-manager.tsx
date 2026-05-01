import { useStorage } from "@plasmohq/storage/hook"
import { useState } from "react"

import { TemplateEditor } from "~components/template-editor"
import { localStore, TEMPLATES_STORAGE_KEY } from "~lib/constants"
import { deleteTemplate } from "~lib/templates"
import type { SmsTemplate } from "~lib/types"

// --- Template Manager ---
//
// Full-screen opaque overlay (z-300) layered above the compose popover.
// Hosts the template list, the Add / Edit / Delete affordances, and mounts
// the editor modal as a child when the user creates or edits a template.
//
// State preservation: the compose popover and candidate view stay mounted
// underneath this overlay. Closing the manager (← Back) just unmounts this
// component; nothing else touches.

const MANAGER_STYLE_ATTR = "data-lr-template-mgr-styles"
if (
  typeof document !== "undefined" &&
  !document.querySelector(`[${MANAGER_STYLE_ATTR}]`)
) {
  const styleEl = document.createElement("style")
  styleEl.setAttribute(MANAGER_STYLE_ATTR, "")
  styleEl.textContent = `
    .lr-tmgr-overlay {
      position: fixed;
      inset: 0;
      background-color: #ffffff;
      z-index: 300;
      display: flex;
      flex-direction: column;
      padding: 16px;
    }

    .lr-tmgr-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      padding: 0 0 14px 0;
      margin-bottom: 14px;
      border-bottom: 1px solid #e3e6ea;
    }
    .lr-tmgr-title {
      flex: 1;
      text-align: center;
      margin: 0;
      font-size: 22px;
      font-weight: 700;
      color: #15171a;
      letter-spacing: -0.01em;
      font-family: 'ui-rounded', 'SF Pro Rounded', 'SF Pro Display', system-ui, sans-serif;
    }

    .lr-tmgr-back-btn {
      flex-shrink: 0;
      padding: 10px 14px;
      background-color: transparent;
      color: #0a66c2;
      border: 1px solid #0a66c2;
      border-radius: 999px;
      font-size: 14px;
      font-weight: 600;
      cursor: pointer;
      font-family: inherit;
      transition: background-color 120ms ease;
    }
    .lr-tmgr-back-btn:hover {
      background-color: #e6efff;
    }
    .lr-tmgr-back-btn:active {
      transform: translateY(1px);
    }
    .lr-tmgr-back-btn:focus-visible {
      outline: none;
      box-shadow: 0 0 0 3px rgba(10,102,194,0.15);
    }

    .lr-tmgr-add-btn {
      flex-shrink: 0;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 10px 14px;
      background-color: #0a66c2;
      color: #ffffff;
      border: 1px solid #0a66c2;
      border-radius: 999px;
      font-size: 14px;
      font-weight: 600;
      cursor: pointer;
      font-family: inherit;
      transition: background-color 120ms ease, border-color 120ms ease, transform 120ms ease, box-shadow 120ms ease;
      box-shadow: 0 1px 0 rgba(0,0,0,0.04);
    }
    .lr-tmgr-add-btn:hover {
      background-color: #084e9c;
      border-color: #084e9c;
      box-shadow: 0 2px 6px rgba(10,102,194,0.32);
    }
    .lr-tmgr-add-btn:active {
      transform: translateY(1px);
    }
    .lr-tmgr-add-btn:focus-visible {
      outline: none;
      box-shadow: 0 2px 6px rgba(10,102,194,0.32), 0 0 0 3px rgba(10,102,194,0.15);
    }

    .lr-tmgr-list {
      flex: 1;
      overflow-y: auto;
      display: flex;
      flex-direction: column;
      gap: 12px;
      padding-bottom: 12px;
    }

    .lr-tmgr-empty {
      flex: 1;
      display: flex;
      align-items: center;
      justify-content: center;
      text-align: center;
      font-size: 15px;
      font-weight: 500;
      color: #5f6368;
      padding: 24px;
    }

    .lr-tmgr-card {
      background-color: #ffffff;
      border: 1px solid #e3e6ea;
      border-radius: 12px;
      padding: 14px 16px;
      box-shadow: 0 1px 2px rgba(15,23,42,0.04);
      display: flex;
      align-items: center;
      gap: 12px;
      position: relative;
    }
    .lr-tmgr-card-name {
      flex: 1;
      min-width: 0;
      font-size: 17px;
      font-weight: 600;
      color: #15171a;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .lr-tmgr-card-actions {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-shrink: 0;
    }

    .lr-tmgr-icon-btn {
      width: 30px;
      height: 30px;
      background-color: transparent;
      border-radius: 50%;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      padding: 0;
      transition: background-color 120ms ease, color 120ms ease, box-shadow 120ms ease, transform 120ms ease;
    }
    .lr-tmgr-icon-btn--edit {
      color: #0a66c2;
      border: 1px solid #0a66c2;
    }
    .lr-tmgr-icon-btn--edit:hover {
      background-color: #0a66c2;
      color: #ffffff;
      box-shadow: 0 2px 6px rgba(10,102,194,0.32);
    }
    .lr-tmgr-icon-btn--delete {
      color: #d23a2c;
      border: 1px solid #d23a2c;
    }
    .lr-tmgr-icon-btn--delete:hover {
      background-color: #d23a2c;
      color: #ffffff;
      box-shadow: 0 2px 6px rgba(210,58,44,0.32);
    }
    .lr-tmgr-icon-btn:active {
      transform: translateY(1px);
    }
    .lr-tmgr-icon-btn--edit:focus-visible {
      outline: none;
      box-shadow: 0 0 0 3px rgba(10,102,194,0.25);
    }
    .lr-tmgr-icon-btn--delete:focus-visible {
      outline: none;
      box-shadow: 0 0 0 3px rgba(210,58,44,0.25);
    }

    .lr-tmgr-card-confirm {
      position: absolute;
      inset: 0;
      background-color: rgba(210, 58, 44, 0.08);
      border: 1px solid #d23a2c;
      border-radius: 12px;
      padding: 14px 16px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
    }
    .lr-tmgr-card-confirm-text {
      flex: 1;
      min-width: 0;
      margin: 0;
      font-size: 14px;
      font-weight: 600;
      color: #a82a20;
      line-height: 1.3;
    }
    .lr-tmgr-card-confirm-buttons {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-shrink: 0;
    }
    .lr-tmgr-confirm-no {
      padding: 8px 14px;
      background-color: transparent;
      color: #2e3133;
      border: 1px solid #c2c8d0;
      border-radius: 999px;
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;
      font-family: inherit;
      transition: background-color 120ms ease, border-color 120ms ease, transform 120ms ease;
    }
    .lr-tmgr-confirm-no:hover {
      background-color: #f4f6f8;
      border-color: #aab1bb;
    }
    .lr-tmgr-confirm-no:active { transform: translateY(1px); }

    .lr-tmgr-confirm-yes {
      padding: 8px 14px;
      background-color: #d23a2c;
      color: #ffffff;
      border: 1px solid #d23a2c;
      border-radius: 999px;
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;
      font-family: inherit;
      transition: background-color 120ms ease, border-color 120ms ease, transform 120ms ease, box-shadow 120ms ease;
      box-shadow: 0 1px 0 rgba(0,0,0,0.04);
    }
    .lr-tmgr-confirm-yes:hover {
      background-color: #b8302a;
      border-color: #b8302a;
      box-shadow: 0 2px 6px rgba(210,58,44,0.32);
    }
    .lr-tmgr-confirm-yes:active { transform: translateY(1px); }
  `
  document.head.appendChild(styleEl)
}

function PlusIcon() {
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
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
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

function TrashIcon() {
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
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
      <path d="M10 11v6M14 11v6" />
      <path d="M9 6V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2" />
    </svg>
  )
}

type EditorMode =
  | { kind: "closed" }
  | { kind: "create" }
  | { kind: "edit"; template: SmsTemplate }

export function TemplateManager({ onClose }: { onClose: () => void }) {
  const [stored] = useStorage<SmsTemplate[]>(
    { key: TEMPLATES_STORAGE_KEY, instance: localStore },
    []
  )
  const templates = [...(stored ?? [])].sort((a, b) =>
    b.updatedAt.localeCompare(a.updatedAt)
  )

  const [editorMode, setEditorMode] = useState<EditorMode>({ kind: "closed" })
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(
    null
  )

  const handleDelete = async (id: string) => {
    await deleteTemplate(id)
    setConfirmingDeleteId(null)
  }

  return (
    <div className="lr-tmgr-overlay" role="dialog" aria-modal="true">
      <header className="lr-tmgr-header">
        <button
          type="button"
          className="lr-tmgr-back-btn"
          onClick={onClose}
          aria-label="Back to compose">
          ← Back
        </button>
        <h2 className="lr-tmgr-title">Text Templates</h2>
        <button
          type="button"
          className="lr-tmgr-add-btn"
          onClick={() => setEditorMode({ kind: "create" })}
          aria-label="Create new template">
          <PlusIcon />
          Add
        </button>
      </header>

      {templates.length === 0 ? (
        <div className="lr-tmgr-empty">
          No templates yet — hit Add to create one.
        </div>
      ) : (
        <div className="lr-tmgr-list">
          {templates.map((t) => {
            const confirming = confirmingDeleteId === t.id
            return (
              <div key={t.id} className="lr-tmgr-card">
                <span className="lr-tmgr-card-name">{t.name}</span>
                <div className="lr-tmgr-card-actions">
                  <button
                    type="button"
                    className="lr-tmgr-icon-btn lr-tmgr-icon-btn--edit"
                    onClick={() =>
                      setEditorMode({ kind: "edit", template: t })
                    }
                    aria-label={`Edit template ${t.name}`}>
                    <PencilIcon />
                  </button>
                  <button
                    type="button"
                    className="lr-tmgr-icon-btn lr-tmgr-icon-btn--delete"
                    onClick={() => setConfirmingDeleteId(t.id)}
                    aria-label={`Delete template ${t.name}`}>
                    <TrashIcon />
                  </button>
                </div>
                {confirming && (
                  <div className="lr-tmgr-card-confirm">
                    <p className="lr-tmgr-card-confirm-text">
                      Are you sure you want to delete this template?
                    </p>
                    <div className="lr-tmgr-card-confirm-buttons">
                      <button
                        type="button"
                        className="lr-tmgr-confirm-no"
                        onClick={() => setConfirmingDeleteId(null)}>
                        No
                      </button>
                      <button
                        type="button"
                        className="lr-tmgr-confirm-yes"
                        onClick={() => handleDelete(t.id)}>
                        Yes, delete
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {editorMode.kind !== "closed" && (
        <TemplateEditor
          initial={editorMode.kind === "edit" ? editorMode.template : null}
          onClose={() => setEditorMode({ kind: "closed" })}
        />
      )}
    </div>
  )
}
