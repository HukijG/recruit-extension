import { useEffect } from "react"

// Keyboard-command bridge for the side panel.
//
// chrome.commands fire in the background worker, but the actions they trigger
// live in the side-panel context — the call button + candidate <h2> in the DOM
// and the panel's speechSynthesis — which the worker can't reach. So the worker
// relays each command as a raw { type } runtime message (see
// background/index.ts) and this hook, mounted once by the panel, runs the
// action. Command strings match the manifest `commands` keys.

const COMMANDS = ["toggle-call", "speak-name"] as const
type Command = (typeof COMMANDS)[number]

function isCommand(value: unknown): value is Command {
  return (
    typeof value === "string" && (COMMANDS as readonly string[]).includes(value)
  )
}

function toggleCall() {
  // Call and hangup are the same element — hangup only adds a
  // .lr-call-btn--hangup modifier, never a second button — so a single click on
  // .lr-call-btn flips whichever state is live. No-op when absent (e.g. sync).
  document.querySelector<HTMLElement>(".lr-call-btn")?.click()
}

function speakName() {
  // The candidate <h2> carries no class of its own, so anchor off the call
  // button it shares a <header> with. First whitespace token = first name.
  const header = document.querySelector(".lr-call-btn")?.closest("header")
  const first =
    (header?.querySelector("h2")?.textContent ?? "").trim().split(/\s+/)[0] ?? ""

  // Cold-call count is the "(N)" in the section toggle label, e.g.
  // "Cold calls (12)". Absent (no calls / sync mode) → simply omitted.
  const toggleText =
    document.querySelector(".lr-coldcall-section-toggle")?.textContent ?? ""
  const count = toggleText.match(/\((\d+)\)/)?.[1] ?? ""

  const phrase = [first, count].filter(Boolean).join(", ")
  if (!phrase) return

  // Cancel any in-flight utterance so a rapid second press interrupts rather
  // than queuing behind the first.
  speechSynthesis.cancel()
  speechSynthesis.speak(new SpeechSynthesisUtterance(phrase))
}

function run(command: Command) {
  if (command === "toggle-call") toggleCall()
  else if (command === "speak-name") speakName()
}

export function useCommandHotkeys() {
  useEffect(() => {
    const listener = (message: unknown) => {
      const type = (message as { type?: unknown } | null)?.type
      if (isCommand(type)) run(type)
    }
    chrome.runtime.onMessage.addListener(listener)
    return () => chrome.runtime.onMessage.removeListener(listener)
  }, [])
}
