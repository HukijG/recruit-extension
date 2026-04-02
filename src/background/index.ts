const LOG_PREFIX = "[LR-Scraper][Background]"

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

export {}
