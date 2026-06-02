import { sendToBackground } from "@plasmohq/messaging"
import { useEffect, useRef } from "react"

import { useAuth } from "~auth/AuthProvider"
import { localStore, TEMPLATES_STORAGE_KEY } from "~lib/constants"
import type { SmsTemplate } from "~lib/types"

// Cloud → local one-shot hydration. Fires once per sidepanel mount (i.e.
// "every time the extension is opened" per the local-first spec). Only
// pulls from cloud when local storage is empty — the common case is a
// fresh install or a machine the user has never opened the extension on
// before. After hydration completes the ref-guard prevents any further
// cloud → local writes for the lifetime of this mount, so the user's
// own mutations are never clobbered.

interface ListCloudResp {
  ok: boolean
  templates?: SmsTemplate[]
  error?: string
}

async function readLocalArray(): Promise<SmsTemplate[]> {
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

export function useTemplateHydration(): void {
  const { isAuthenticated } = useAuth()
  const ranRef = useRef(false)

  useEffect(() => {
    if (ranRef.current) return
    if (!isAuthenticated) return
    ranRef.current = true

    const run = async () => {
      const existing = await readLocalArray()
      if (existing.length > 0) return

      const resp = await sendToBackground<unknown, ListCloudResp>({
        name: "listCloudTemplates"
      }).catch((err): ListCloudResp => ({
        ok: false,
        error: err?.message ?? "Network error"
      }))

      if (!resp?.ok || !resp.templates || resp.templates.length === 0) {
        if (resp && !resp.ok) {
          console.warn("[templateHydration] cloud fetch failed:", resp.error)
        }
        return
      }

      // Race-check: between the readLocalArray() above and now the user
      // could have manually created a template. If they did, don't
      // overwrite. Cloud will catch up via fireCloudUpsert on their save.
      const stillEmpty = await readLocalArray()
      if (stillEmpty.length > 0) return

      await localStore.set(TEMPLATES_STORAGE_KEY, resp.templates)
    }

    void run()
  }, [isAuthenticated])
}
