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
    port: 5174
  }
})
