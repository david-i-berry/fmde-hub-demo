import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vite'
import vuetify from 'vite-plugin-vuetify'
import { serviceWorker } from './build/service-worker.ts'
import { APP_DESCRIPTION, APP_NAME, APP_SHORT_NAME } from './src/brand.ts'

export default defineConfig({
  // FMDEHUB_BASE=/<repo>/ for the GitHub Pages build (.github/workflows/pages.yml); '/' everywhere else
  base: process.env.FMDEHUB_BASE || '/',
  plugins: [
    // <title> follows the brand (src/brand.ts)
    { name: 'fmde-hub-title', transformIndexHtml: (html) => html.replace(/<title>[^<]*<\/title>/, `<title>${APP_NAME}</title>`) },
    vue(),
    vuetify({ autoImport: true }),
    // installable and offline: sw.js caches the whole build, including the PGlite WASM and data
    serviceWorker({
      publicFiles: ['icon.svg'],
      manifest: {
        name: APP_NAME,
        short_name: APP_SHORT_NAME,
        description: APP_DESCRIPTION,
        theme_color: '#1c5cab',
        background_color: '#0d0d0d',
        display: 'standalone',
        icons: [{ src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' }],
      },
    }),
  ],
  // PGlite ships its own WASM; pre-bundling breaks its asset resolution
  optimizeDeps: {
    exclude: ['@electric-sql/pglite'],
    // pre-bundle lazily used deps so dev does not reload the page when a route first loads them
    include: ['echarts/core', 'echarts/charts', 'echarts/components', 'echarts/renderers', 'vue-echarts', 'protobufjs/light.js', 'mqtt'],
  },
  worker: { format: 'es' },
  build: { target: 'es2022', chunkSizeWarningLimit: 2000 },
})
