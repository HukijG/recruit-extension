// --- SMS template storage ---
//
// Local-only for now (chrome.storage.local via Plasmo). Future remote-sync
// will wrap these helpers — components keep calling the same functions.

import { localStore, TEMPLATES_STORAGE_KEY } from "~lib/constants"
import type { SmsTemplate } from "~lib/types"

async function readArray(): Promise<SmsTemplate[]> {
  const raw = await localStore.get(TEMPLATES_STORAGE_KEY)
  if (!raw) return []
  try {
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw
    if (!Array.isArray(parsed)) return []
    return parsed as SmsTemplate[]
  } catch {
    return []
  }
}

function sortDesc(arr: SmsTemplate[]): SmsTemplate[] {
  return [...arr].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
}

export async function listTemplates(): Promise<SmsTemplate[]> {
  return sortDesc(await readArray())
}

export async function saveTemplate(input: {
  id?: string
  name: string
  body: string
}): Promise<SmsTemplate> {
  const existing = await readArray()
  const now = new Date().toISOString()
  const trimmedName = input.name.trim().slice(0, 80)

  if (input.id) {
    const idx = existing.findIndex((t) => t.id === input.id)
    if (idx >= 0) {
      const updated: SmsTemplate = {
        ...existing[idx],
        name: trimmedName,
        body: input.body,
        updatedAt: now
      }
      const next = [
        ...existing.slice(0, idx),
        updated,
        ...existing.slice(idx + 1)
      ]
      await localStore.set(TEMPLATES_STORAGE_KEY, next)
      return updated
    }
  }

  const created: SmsTemplate = {
    id: input.id ?? crypto.randomUUID(),
    name: trimmedName,
    body: input.body,
    createdAt: now,
    updatedAt: now
  }
  await localStore.set(TEMPLATES_STORAGE_KEY, [...existing, created])
  return created
}

export async function deleteTemplate(id: string): Promise<void> {
  const existing = await readArray()
  const next = existing.filter((t) => t.id !== id)
  if (next.length === existing.length) return
  await localStore.set(TEMPLATES_STORAGE_KEY, next)
}

export function substituteFirstName(body: string, firstName: string): string {
  const replacement = firstName.trim() || "there"
  return body.replace(/\{\{firstName\}\}/g, replacement)
}
