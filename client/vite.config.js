// client/vite.config.js
import { defineConfig } from 'vite'
import react          from '@vitejs/plugin-react'
import tailwindcss    from '@tailwindcss/vite'
import wasm           from 'vite-plugin-wasm'
import topLevelAwait  from 'vite-plugin-top-level-await'

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    wasm(),              // allows .wasm files to load correctly
    topLevelAwait(),     // required by the wasm plugin
  ],
  optimizeDeps: {
    // Tell Vite not to pre-bundle this package —
    // it loads its own .wasm file at runtime and must do so itself.
    exclude: ['@pybricks/mpy-cross-v6'],
  },
  server: {
    proxy: { '/api': 'https://robotlearn-server.onrender.com' }
  }
})