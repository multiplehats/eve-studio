import { defineConfig } from "vitest/config"
import { devtools } from "@tanstack/devtools-vite"
import { tanstackStart } from "@tanstack/react-start/plugin/vite"
import viteReact from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"

const config = defineConfig({
  resolve: { tsconfigPaths: true },
  plugins: [devtools(), tailwindcss(), tanstackStart({ spa: { enabled: true } }), viteReact()],
  server: {
    port: 43120,
    strictPort: true,
    // Same-origin in dev AND prod: the collector (43110) never needs CORS.
    proxy: {
      "/api": { target: "http://127.0.0.1:43110", changeOrigin: true },
      "/health": { target: "http://127.0.0.1:43110", changeOrigin: true },
    },
  },
  test: { environment: "jsdom" },
})

export default config
