import { createContext } from "react"

import type { CallConfig, CallerIdPickerSlot } from "~lib/types"

export const CallConfigContext = createContext<CallConfig>({})

export const CallerIdPickerContext = createContext<CallerIdPickerSlot>(null)
