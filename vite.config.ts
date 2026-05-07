import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('react-leaflet') || id.includes('leaflet')) {
            return 'map'
          }
          if (id.includes('@supabase/supabase-js')) {
            return 'supabase'
          }
          return undefined
        },
      },
    },
  },
})
