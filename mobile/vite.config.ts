import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"
import path from "node:path"

// `~` alias mirrors the extension's tsconfig path so files can be copied
// across without rewriting imports.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "~": path.resolve(__dirname, "src")
    }
  },
  server: {
    host: true,
    port: 5174,
    // Bypass Vite's DNS-rebinding allowlist entirely. Default-allowed hosts
    // (localhost, *.local, loopback) don't cover Tailscale magic-DNS or
    // raw Tailscale IPs, and we want both to work without per-tailnet
    // hardcoding. The threat model is thin here: dev server only serves
    // the bundled JS, the actual data lives behind X-Extension-Token on
    // the worker, and the dev box is on a private tailnet.
    allowedHosts: true
  }
})
