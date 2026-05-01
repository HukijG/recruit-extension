import { Storage } from "@plasmohq/storage"

export const localStore = new Storage({ area: "local" })

// The activity `type` value the middleware uses for cold calls. Confirm with the
// middleware-side agent and update this constant when finalized.
export const COLD_CALL_TYPE = "cold_call"

export const UNDO_DELAY_MS = 5000

export const TEMPLATES_STORAGE_KEY = "lrSmsTemplates"
