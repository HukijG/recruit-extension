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
    // Vite 5+ blocks requests whose Host header isn't in the allowlist as
    // defense against DNS-rebinding attacks. Localhost / *.local / loopback
    // IPs are auto-allowed; we add Tailscale's magic-DNS suffix so any
    // device hitting `<machine>.<tailnet>.ts.net` works. Leading dot makes
    // this match every subdomain. HMR works through the same hostname.
    allowedHosts: [".ts.net"]
  }
})
