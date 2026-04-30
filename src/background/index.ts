import { Storage } from "@plasmohq/storage"

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

chrome.runtime.onInstalled.addListener(async (details) => {
  if (details.reason !== "install" && details.reason !== "update") return
  await migrateSyncToLocal()
})

export {}
