import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined
          if (id.includes('/@mui/icons-material/')) return 'mui-icons'
          if (id.includes('/@mui/material/') || id.includes('/@emotion/') || id.includes('/stylis')) return 'mui-core'
          if (id.includes('/react/') || id.includes('/react-dom/') || id.includes('/react-router')) return 'react-core'
          return undefined
        },
      },
    },
  },
  server: {
    proxy: {
      // Proxy /api/* requests to the Express backend, stripping the /api prefix
      // This mirrors the production nginx behavior:
      //   location /api/ { proxy_pass http://server:3031/; }
      '/api': {
        target: 'http://localhost:3031',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
    },
  },
})
