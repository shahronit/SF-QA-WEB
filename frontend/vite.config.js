import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Manual vendor chunking: keep the big, slow-changing libs in their own
// chunks so the browser caches them across deploys. When the app code
// changes (which is most of the time) the user only re-downloads the
// small per-route chunks, not the multi-hundred-kilobyte markdown +
// motion bundles.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
    proxy: {
      '/api': 'http://localhost:8080'
    }
  },
  build: {
    target: 'es2020',
    sourcemap: false,
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined
          if (id.includes('react-markdown') || id.includes('remark-') || id.includes('rehype-')) {
            return 'markdown'
          }
          if (id.includes('framer-motion')) return 'motion'
          if (id.includes('react-router')) return 'router'
          if (id.includes('react-hot-toast')) return 'toast'
          if (id.includes('axios')) return 'http'
          if (id.includes('react-icons')) return 'icons'
          // Everything else (react, react-dom, scheduler, …) lands in a
          // single shared "vendor" chunk that's loaded once on first
          // visit and reused forever after.
          return 'vendor'
        },
      },
    },
  },
})
