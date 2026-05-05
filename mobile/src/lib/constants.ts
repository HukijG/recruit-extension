import { storage } from "~/lib/storage"

// Async-shaped wrapper that mirrors @plasmohq/storage's get/set API. Lets
// templates.ts (and any other "non-hook" caller from the extension) be
// copied across unchanged.
export const localStore = {
  async get<T = unknown>(key: string): Promise<T | null> {
    return storage.get<T | null>(key, null)
  },
  async set(key: string, value: unknown): Promise<void> {
    storage.set(key, value)
  }
}

// Activity `type` value the middleware uses for cold calls.
export const COLD_CALL_TYPE = "cold_call"

export const UNDO_DELAY_MS = 5000

export const TEMPLATES_STORAGE_KEY = "lrSmsTemplates"
