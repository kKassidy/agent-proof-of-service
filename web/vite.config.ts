import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // This public-only frontend does not need or load environment files.
  envDir: false,
  server: { proxy: {
    '/api/phase3': 'http://127.0.0.1:3001',
    // Keep browser Host aligned with Origin for the backend's same-origin guard.
    '/api/phase4': { target: 'http://127.0.0.1:3001', changeOrigin: false },
  } },
})
