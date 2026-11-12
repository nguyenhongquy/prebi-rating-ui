import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ mode }) => ({
  plugins: [react()],
  base: './',
  server: {
    host: '127.0.0.1',
    port: 5174,
    proxy: {
      '/api/g1': { target: loadEnv(mode, '.', '').PREBI_G1_BACKEND_URL || 'http://127.0.0.1:8000' },
      '/api': { target: 'http://127.0.0.1:8000', rewrite: path => path.replace(/^\/api/, '') },
    },
  },
}))