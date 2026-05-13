// --- SMS template storage ---
//
// Local-first persistence. chrome.storage.local (via Plasmo) is the
// authoritative source — every read in the UI goes through useStorage
// against TEMPLATES_STORAGE_KEY. Cloud is a fire-and-forget backup:
// after each local mutation, we kick a background message that PUTs/
// DELETEs the change against the middleware. Cloud failures don't roll
// back local — local already reflects the user's intent and cloud will
// catch up on the next successful sync. The reverse direction (cloud →
// local) only happens once per sidepanel open, and only if local is
// empty (see useTemplateHydration).

import { sendToBackground } from "@plasmohq/messaging"

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

function fireCloudUpsert(template: SmsTemplate): void {
  void sendToBackground({
    name: "syncTemplateUpsert",
    body: { template }
  }).catch(() => {
    // Swallowed by design — cloud is best-effort backup. Failures here
    // are not user-facing: local already committed and that's the truth.
  })
}

function fireCloudDelete(id: string): void {
  void sendToBackground({
    name: "syncTemplateDelete",
    body: { id }
  }).catch(() => {})
}

export async function saveTemplate(input: {
  id?: string
  name: string
  body: string
}): Promise<SmsTemplate> {
  const existing = await readArray()
  const now = new Date().toISOString()
  const trimmedName = input.name.trim().slice(0, 80)

  let saved: SmsTemplate

  if (input.id) {
    const idx = existing.findIndex((t) => t.id === input.id)
    if (idx >= 0) {
      saved = {
        ...existing[idx],
        name: trimmedName,
        body: input.body,
        updatedAt: now
      }
      const next = [
        ...existing.slice(0, idx),
        saved,
        ...existing.slice(idx + 1)
      ]
      await localStore.set(TEMPLATES_STORAGE_KEY, next)
    } else {
      // input.id provided but not found locally — treat as create-with-id
      // (matches previous behavior; rare path but used by tests / sync flows
      // where the caller already minted an ID).
      saved = {
        id: input.id,
        name: trimmedName,
        body: input.body,
        createdAt: now,
        updatedAt: now
      }
      await localStore.set(TEMPLATES_STORAGE_KEY, [...existing, saved])
    }
  } else {
    saved = {
      id: crypto.randomUUID(),
      name: trimmedName,
      body: input.body,
      createdAt: now,
      updatedAt: now
    }
    await localStore.set(TEMPLATES_STORAGE_KEY, [...existing, saved])
  }

  fireCloudUpsert(saved)
  return saved
}

export async function deleteTemplate(id: string): Promise<void> {
  const existing = await readArray()
  const next = existing.filter((t) => t.id !== id)
  if (next.length === existing.length) return
  await localStore.set(TEMPLATES_STORAGE_KEY, next)
  fireCloudDelete(id)
}

export function substituteFirstName(body: string, firstName: string): string {
  const replacement = firstName.trim() || "there"
  return body.replace(/\{\{firstName\}\}/g, replacement)
}
