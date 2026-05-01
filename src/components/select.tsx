import { useEffect, useRef, useState } from "react"

// --- Custom dropdown (Select + Menu) ---
//
// Replaces native <select> wherever it appears. Two consumer-facing variants
// share one trigger/panel/keyboard implementation:
//
//   <Select> — value-bound. Closed state shows the selected option; open
//              state highlights it with a blue tint + checkmark.
//   <Menu>   — action-triggering. Closed state shows a fixed label
//              (e.g. "+ Add Variable"); clicking an option fires onSelect
//              and closes. No persistent "selected" state.

const SELECT_STYLE_ATTR = "data-lr-select-styles"
if (
  typeof document !== "undefined" &&
  !document.querySelector(`[${SELECT_STYLE_ATTR}]`)
) {
  const styleEl = document.createElement("style")
  styleEl.setAttribute(SELECT_STYLE_ATTR, "")
  styleEl.textContent = `
    @keyframes lr-select-pop-in {
      from { opacity: 0; transform: translateY(-4px); }
      to   { opacity: 1; transform: translateY(0); }
    }

    .lr-select-wrapper {
      position: relative;
      width: 100%;
    }
    .lr-select-wrapper--inline {
      width: auto;
      display: inline-block;
    }

    .lr-select-trigger {
      width: 100%;
      display: inline-flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      padding: 10px 12px;
      background-color: #ffffff;
      color: #15171a;
      border: 1px solid #d6dbe1;
      border-radius: 8px;
      font-size: 14px;
      font-weight: 500;
      cursor: pointer;
      transition: border-color 120ms ease, box-shadow 120ms ease, background-color 120ms ease;
      font-family: inherit;
      text-align: left;
    }
    .lr-select-trigger:hover {
      border-color: #aab1bb;
    }
    .lr-select-trigger[data-open="true"],
    .lr-select-trigger:focus-visible {
      outline: none;
      border-color: #0a66c2;
      box-shadow: 0 0 0 3px rgba(10,102,194,0.15);
    }
    .lr-select-trigger:disabled {
      background-color: #eef0f2;
      color: #98a2ad;
      border-color: #e3e6ea;
      cursor: not-allowed;
    }

    .lr-select-trigger--pill {
      width: auto;
      padding: 8px 14px;
      border-radius: 999px;
      border-color: #0a66c2;
      color: #0a66c2;
      font-size: 13px;
      font-weight: 600;
      gap: 6px;
    }
    .lr-select-trigger--pill:hover {
      background-color: #e6efff;
      border-color: #084e9c;
    }
    .lr-select-trigger--pill[data-open="true"] {
      background-color: #e6efff;
    }

    .lr-select-chevron {
      flex-shrink: 0;
      transition: transform 160ms ease;
      color: #5f6368;
    }
    .lr-select-chevron[data-open="true"] {
      transform: rotate(180deg);
    }
    .lr-select-trigger--pill .lr-select-chevron {
      color: #0a66c2;
    }

    .lr-select-panel {
      position: absolute;
      z-index: 500;
      margin-top: 6px;
      min-width: 100%;
      max-height: 240px;
      overflow-y: auto;
      background-color: #ffffff;
      border: 1px solid #e3e6ea;
      border-radius: 12px;
      box-shadow: 0 8px 20px rgba(15,23,42,0.12);
      padding: 6px;
      animation: lr-select-pop-in 140ms ease-out;
    }

    .lr-select-option {
      width: 100%;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      padding: 10px 12px;
      background-color: transparent;
      border: none;
      border-radius: 8px;
      font-size: 15px;
      font-weight: 500;
      color: #15171a;
      cursor: pointer;
      text-align: left;
      font-family: inherit;
      transition: background-color 80ms ease;
    }
    .lr-select-option[data-highlighted="true"] {
      background-color: #f4f6f8;
    }
    .lr-select-option[data-selected="true"] {
      background-color: #e6efff;
      color: #084e9c;
    }
    .lr-select-option[data-selected="true"][data-highlighted="true"] {
      background-color: #d8e7ff;
    }

    .lr-select-option-label {
      flex: 1;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .lr-select-option-hint {
      font-size: 12px;
      font-weight: 500;
      color: #5f6368;
      flex-shrink: 0;
    }
    .lr-select-option-check {
      flex-shrink: 0;
      color: #0a66c2;
    }
    .lr-select-placeholder {
      color: #5f6368;
    }
  `
  document.head.appendChild(styleEl)
}

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      className="lr-select-chevron"
      data-open={open}
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true">
      <polyline points="6 9 12 15 18 9" />
    </svg>
  )
}

function CheckIcon() {
  return (
    <svg
      className="lr-select-option-check"
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  )
}

export type SelectOption<T extends string> = {
  value: T
  label: string
  hint?: string
}

function useDropdown<T extends string>(
  containerRef: React.RefObject<HTMLDivElement>,
  optionCount: number,
  open: boolean,
  setOpen: (v: boolean) => void
) {
  const [highlighted, setHighlighted] = useState(0)

  useEffect(() => {
    if (open) setHighlighted(0)
  }, [open])

  useEffect(() => {
    if (!open) return
    const onDocPointerDown = (e: PointerEvent) => {
      if (!containerRef.current) return
      if (!containerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault()
        setOpen(false)
      } else if (e.key === "ArrowDown") {
        e.preventDefault()
        setHighlighted((h) => Math.min(h + 1, optionCount - 1))
      } else if (e.key === "ArrowUp") {
        e.preventDefault()
        setHighlighted((h) => Math.max(h - 1, 0))
      }
    }
    document.addEventListener("pointerdown", onDocPointerDown, true)
    document.addEventListener("keydown", onKey)
    return () => {
      document.removeEventListener("pointerdown", onDocPointerDown, true)
      document.removeEventListener("keydown", onKey)
    }
  }, [open, optionCount, setOpen, containerRef])

  return { highlighted, setHighlighted }
}

export function Select<T extends string>({
  options,
  value,
  onChange,
  placeholder
}: {
  options: SelectOption<T>[]
  value: T | ""
  onChange: (value: T) => void
  placeholder?: string
}) {
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const { highlighted, setHighlighted } = useDropdown<T>(
    containerRef,
    options.length,
    open,
    setOpen
  )

  const selected = options.find((o) => o.value === value)
  const triggerLabel = selected?.label ?? placeholder ?? "Choose…"
  const isPlaceholder = !selected

  const handleEnter = () => {
    if (!open) return
    const opt = options[highlighted]
    if (opt) {
      onChange(opt.value)
      setOpen(false)
    }
  }

  return (
    <div ref={containerRef} className="lr-select-wrapper">
      <button
        type="button"
        className="lr-select-trigger"
        data-open={open}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault()
            if (open) handleEnter()
            else setOpen(true)
          }
        }}
        aria-haspopup="listbox"
        aria-expanded={open}>
        <span
          className={
            "lr-select-option-label" +
            (isPlaceholder ? " lr-select-placeholder" : "")
          }>
          {triggerLabel}
        </span>
        <ChevronIcon open={open} />
      </button>
      {open && (
        <div className="lr-select-panel" role="listbox">
          {options.map((opt, i) => {
            const isSelected = opt.value === value
            const isHighlighted = i === highlighted
            return (
              <button
                key={opt.value}
                type="button"
                className="lr-select-option"
                data-selected={isSelected}
                data-highlighted={isHighlighted}
                onMouseEnter={() => setHighlighted(i)}
                onClick={() => {
                  onChange(opt.value)
                  setOpen(false)
                }}
                role="option"
                aria-selected={isSelected}>
                <span className="lr-select-option-label">{opt.label}</span>
                {opt.hint && (
                  <span className="lr-select-option-hint">{opt.hint}</span>
                )}
                {isSelected && <CheckIcon />}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

export function Menu<T extends string>({
  options,
  triggerLabel,
  onSelect,
  size = "default"
}: {
  options: SelectOption<T>[]
  triggerLabel: string
  onSelect: (value: T) => void
  size?: "pill" | "default"
}) {
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const { highlighted, setHighlighted } = useDropdown<T>(
    containerRef,
    options.length,
    open,
    setOpen
  )

  const handleEnter = () => {
    if (!open) return
    const opt = options[highlighted]
    if (opt) {
      onSelect(opt.value)
      setOpen(false)
    }
  }

  const triggerClass =
    size === "pill"
      ? "lr-select-trigger lr-select-trigger--pill"
      : "lr-select-trigger"
  const wrapperClass =
    size === "pill"
      ? "lr-select-wrapper lr-select-wrapper--inline"
      : "lr-select-wrapper"

  return (
    <div ref={containerRef} className={wrapperClass}>
      <button
        type="button"
        className={triggerClass}
        data-open={open}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault()
            if (open) handleEnter()
            else setOpen(true)
          }
        }}
        aria-haspopup="menu"
        aria-expanded={open}>
        <span className="lr-select-option-label">{triggerLabel}</span>
        <ChevronIcon open={open} />
      </button>
      {open && (
        <div className="lr-select-panel" role="menu">
          {options.map((opt, i) => (
            <button
              key={opt.value}
              type="button"
              className="lr-select-option"
              data-highlighted={i === highlighted}
              onMouseEnter={() => setHighlighted(i)}
              onClick={() => {
                onSelect(opt.value)
                setOpen(false)
              }}
              role="menuitem">
              <span className="lr-select-option-label">{opt.label}</span>
              {opt.hint && (
                <span className="lr-select-option-hint">{opt.hint}</span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
