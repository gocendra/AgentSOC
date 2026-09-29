import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    allowedHosts: [
      'aeronautical-natosha-unheavy.ngrok-free.dev'
    ],
    proxy: {
      '/api': 'http://127.0.0.1:8000',
      '/token': 'http://127.0.0.1:8000',
      '/users': 'http://127.0.0.1:8000',
      '/logs': 'http://127.0.0.1:8000',
      '/agents': 'http://127.0.0.1:8000',
      '/agent-status': 'http://127.0.0.1:8000'
    }
  }
})
