import { defineConfig } from "vite"
import { tanstackStart } from "@tanstack/react-start/plugin/vite"
import viteReact from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"
import { nitro } from "nitro/vite"

export default defineConfig({
  resolve: { tsconfigPaths: true },
  plugins: [
    tailwindcss(),
    tanstackStart(),
    nitro({ preset: process.env.VERCEL ? "vercel" : "node-server" }),
    viteReact(),
  ],
  server: {
    // 43110-43120 are taken by the Studio collector/UI; 2000/3000/3001/4321 are off-limits.
    port: 43130,
    strictPort: true,
  },
})
