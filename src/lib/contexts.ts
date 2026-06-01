import { createContext } from "react"

import type {
  CallConfig,
  CallerIdPickerSlot,
  CallStreamSlot,
  MusicRemoteSlot,
  TextSlot
} from "~lib/types"

export const CallConfigContext = createContext<CallConfig>({})

export const CallerIdPickerContext = createContext<CallerIdPickerSlot>(null)

export const TextSlotContext = createContext<TextSlot>(null)

export const CallStreamContext = createContext<CallStreamSlot>(null)

// Exposed at sidepanel level by the useCallStats hook so CallButton's
// hangup-success handler can fire an immediate badge refresh without
// having to thread props through CandidateView / TestCallView.
export const CallStatsRefreshContext = createContext<(() => void) | null>(null)

// Carries the now-playing snapshot, socket status, and a `suppressed` flag
// (computed in sidepanel from the open-overlay locals) into the music bar.
// Unlike the candidate-only slots above, the bar is base-page chrome, so the
// Provider wraps ALL three modes — the slot is non-null on every surface. The
// `null` default exists only for a future editor-style surface that mounts the
// bar without a Provider (the bar self-hides then); the live tree never relies
// on it.
export const MusicRemoteContext = createContext<MusicRemoteSlot>(null)
