import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // This public-only frontend does not need or load environment files.
  envDir: false,
  server: { proxy: { '/api/phase3': 'http://127.0.0.1:3001' } },
})
