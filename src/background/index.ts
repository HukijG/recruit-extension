import { Storage } from "@plasmohq/storage"

import { parseLinkedInTalentUrl } from "~lib/url"

chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true })

// One-shot migration: copy any existing extensionSecret from chrome.storage.sync
// (the @plasmohq/storage default before v1.0.0 of this extension) into
// chrome.storage.local, then clear the sync copy. Idempotent via migration_v1_done flag.
async function migrateSyncToLocal() {
  const localStore = new Storage({ area: "local" })
  const syncStore = new Storage({ area: "sync" })

  try {
    const done = await localStore.get("migration_v1_done")
    if (done) return

    const oldSecret = await syncStore.get("extensionSecret")
    if (oldSecret) {
      const existingLocal = await localStore.get("extensionSecret")
      if (!existingLocal) {
        await localStore.set("extensionSecret", oldSecret)
      }
      await syncStore.remove("extensionSecret")
    }

    await syncStore.remove("middlewareUrl")
    await localStore.remove("middlewareUrl")

    await localStore.set("migration_v1_done", true)
  } catch {
    // If sync isn't accessible (rare — e.g. user not signed into Chrome) or any
    // read/write fails, leave the done-flag unset so the next onInstalled retries.
  }
}

// One-shot migration v2: wipe identity keys made obsolete by the OAuth flip.
// Removes the legacy extensionSecret + consultantFirstName fields and the
// dialpadUserContext cache entries that were keyed by consultantFirstName.
// Idempotent via migration_v2_done flag.
async function migrateV2WipeStaleKeys() {
  const localStore = new Storage({ area: "local" })
  try {
    const done = await localStore.get("migration_v2_done")
    if (done) return

    await localStore.remove("extensionSecret")
    await localStore.remove("consultantFirstName")

    const all = (await (chrome.storage.local.get(null) as unknown as Promise<Record<string, unknown>>)) ?? {}
    const orphans = Object.keys(all).filter((k) => k.startsWith("dialpadUserContext:"))
    if (orphans.length) await chrome.storage.local.remove(orphans)

    const syncStore = new Storage({ area: "sync" })
    await syncStore.remove("extensionSecret").catch(() => {})
    await syncStore.remove("consultantFirstName").catch(() => {})

    await localStore.set("migration_v2_done", true)
  } catch {
    // If anything fails, leave the flag unset so onInstalled retries on next update.
  }
}

chrome.runtime.onInstalled.addListener(async (details) => {
  if (details.reason !== "install" && details.reason !== "update") return
  await migrateSyncToLocal()
  await migrateV2WipeStaleKeys()
})

// --- URL watcher: drives sidepanel mode ---
//
// Sends a `lr-mode-changed` runtime message whenever the active tab's URL
// transitions between sync and candidate modes (or between candidate URLs).
// Sidepanel listens; if it isn't open, the message is harmless (silent failure).

interface ModeBroadcast {
  type: "lr-mode-changed"
  mode: "sync" | "candidate"
  urlId: string | null
  url: string
  tabId: number
}

let lastBroadcast: {
  mode: "sync" | "candidate"
  urlId: string | null
  tabId: number | null
} = {
  mode: "sync",
  urlId: null,
  tabId: null
}

async function checkActiveTabAndBroadcast() {
  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true })
    const tab = tabs[0]
    const url = tab?.url ?? ""
    const tabId = tab?.id ?? -1
    const parsed = parseLinkedInTalentUrl(url)

    if (
      lastBroadcast.mode === parsed.mode &&
      lastBroadcast.urlId === parsed.urlId &&
      lastBroadcast.tabId === tabId
    ) {
      return
    }

    lastBroadcast = { mode: parsed.mode, urlId: parsed.urlId, tabId }

    const message: ModeBroadcast = {
      type: "lr-mode-changed",
      mode: parsed.mode,
      urlId: parsed.urlId,
      url,
      tabId
    }
    // sendMessage rejects if no listener is open; we don't care.
    chrome.runtime.sendMessage(message).catch(() => {})
  } catch {
    // Non-fatal — sidepanel will seed initial state on mount via getActiveTabContext.
  }
}

// SPA pushState — primary signal. Filtered to the LinkedIn talent host so we
// don't get spammed by every site's history changes.
chrome.webNavigation.onHistoryStateUpdated.addListener(
  () => {
    checkActiveTabAndBroadcast()
  },
  { url: [{ hostEquals: "www.linkedin.com", pathPrefix: "/talent/" }] }
)

// Full-page navigation backstop.
chrome.tabs.onUpdated.addListener((_tabId, changeInfo) => {
  if (changeInfo.url || changeInfo.status === "complete") {
    checkActiveTabAndBroadcast()
  }
})

// Tab switch backstop.
chrome.tabs.onActivated.addListener(() => {
  checkActiveTabAndBroadcast()
})

// --- Keyboard command relay ---
//
// chrome.commands fire here in the worker, but their actions (click the call
// button, speak the candidate name) live in the side-panel DOM, which the
// worker can't touch. Relay each command verbatim as a { type } message; the
// panel listens via useCommandHotkeys. Harmless if the panel is closed —
// sendMessage just rejects with no receiver.
chrome.commands.onCommand.addListener((command) => {
  chrome.runtime.sendMessage({ type: command }).catch(() => {})
})

export {}
