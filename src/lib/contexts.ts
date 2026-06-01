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
// Mirrors the nullable cross-mode slots above: candidate mode supplies it via
// a Provider; other modes leave it `null` and the bar self-hides.
export const MusicRemoteContext = createContext<MusicRemoteSlot>(null)
