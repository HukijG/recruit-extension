import type { CapacitorConfig } from "@capacitor/cli"

// Capacitor wraps the Vite-built `dist/` into a real Android shell. The
// JS bundle ships inside the APK; the only network calls at runtime are
// the middleware fetches. VITE_MIDDLEWARE_URL is baked into the bundle
// at `npm run build` time, so set `mobile/.env` before each rebuild.
//
// Bundle ID is just a reverse-domain identifier — pick anything unique;
// changing it later orphans previous installs since Android treats it
// as a different app.

const config: CapacitorConfig = {
  appId: "com.haines.recruiterpipeline",
  appName: "Recruiter Pipeline",
  webDir: "dist",
  android: {
    // Default `https` scheme matters: the middleware is HTTPS-only and an
    // `http` scheme would trigger Android's mixed-content blocking on the
    // worker's outbound calls. Don't change.
    allowMixedContent: false
  },
  plugins: {
    // Patches `fetch` + `XMLHttpRequest` on native (Android/iOS) to route
    // through Capacitor's native HTTP plugin. On native we bypass the
    // WebView entirely — no CORS, no preflight quirks. On web/dev (Vite)
    // this flag is a no-op; the browser's regular fetch is used and the
    // worker's `Access-Control-Allow-Origin: *` handles CORS. Means the
    // app's existing fetch-based code paths (api.ts, callStream.ts) work
    // identically on both targets without per-platform branching.
    CapacitorHttp: {
      enabled: true
    }
  }
}

export default config
