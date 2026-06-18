// client/vite.config.js
import { defineConfig } from 'vite'
import react         from '@vitejs/plugin-react'
import tailwindcss   from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  optimizeDeps: {
    // Tell Vite not to pre-bundle this package.
    // It loads its own .wasm file at runtime and must do so itself.
    exclude: ['@pybricks/mpy-cross-v6'],
  },
  server: {
    proxy: { '/api': 'https://robotlearn-server.onrender.com' }
  }
})