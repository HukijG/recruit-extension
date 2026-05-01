import { createContext } from "react"

import type { CallConfig, CallerIdPickerSlot, TextSlot } from "~lib/types"

export const CallConfigContext = createContext<CallConfig>({})

export const CallerIdPickerContext = createContext<CallerIdPickerSlot>(null)

export const TextSlotContext = createContext<TextSlot>(null)
