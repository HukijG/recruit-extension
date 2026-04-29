import { Storage } from "@plasmohq/storage"

const LOG_PREFIX = "[LR-Sync][Background]"

// Open the side panel when the extension icon is clicked
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true })
  .then(() => {
    console.log(LOG_PREFIX, "Side panel configured to open on action click")
  })
  .catch((err) => {
    console.error(LOG_PREFIX, "Failed to configure side panel behavior:", err)
  })

// Log when the service worker starts
console.log(LOG_PREFIX, "Background service worker started")

// Build-time configuration sanity check. Logs once on every service-worker boot
// so a misconfigured production build is visible from the very first console
// session, in addition to the prebuild script and the runtime guards in handlers.
if (!process.env.PLASMO_PUBLIC_MIDDLEWARE_URL) {
  console.error(LOG_PREFIX, "PLASMO_PUBLIC_MIDDLEWARE_URL is unset — rebuild with .env.production configured")
}

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

    // Also clear the old middlewareUrl key — no longer used after Task 6.
    await syncStore.remove("middlewareUrl")
    await localStore.remove("middlewareUrl")

    await localStore.set("migration_v1_done", true)
    console.log(LOG_PREFIX, "Storage migration v1 complete")
  } catch (err) {
    // If sync isn't accessible (rare — e.g. user not signed into Chrome) or any
    // read/write fails, leave the done-flag unset so the next onInstalled retries.
    console.warn(LOG_PREFIX, "Storage migration deferred:", err)
  }
}

chrome.runtime.onInstalled.addListener(async (details) => {
  if (details.reason !== "install" && details.reason !== "update") return
  await migrateSyncToLocal()
})

export {}
