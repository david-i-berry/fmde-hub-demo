// Vite plugin: builds sw/sw.ts into sw.js with the list of files to cache, and writes the web app
// manifest. Production builds only; `npm run dev` runs without a service worker.
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import type { Plugin } from 'vite'

const SW_SOURCE = fileURLToPath(new URL('../sw/sw.ts', import.meta.url))
const SW_FILE = 'sw.js'
const MANIFEST_FILE = 'manifest.webmanifest'

export interface BuildFile {
  fileName: string
  content: string | Uint8Array
}

/**
 * The files the service worker caches (every built file except itself and source maps, plus the
 * public files named in `extra`), sorted, and a version that changes when any of their contents do.
 */
export function precacheManifest(files: BuildFile[], extra: string[] = []): { urls: string[]; version: string } {
  const built = files.filter((f) => f.fileName !== SW_FILE && !f.fileName.endsWith('.map'))
  const urls = [...new Set([...built.map((f) => f.fileName), ...extra])].sort()
  const hash = createHash('sha256')
  for (const f of [...built].sort((a, b) => (a.fileName < b.fileName ? -1 : 1))) hash.update(f.fileName).update('\0').update(f.content).update('\0')
  for (const name of extra) hash.update(name).update('\0')
  return { urls, version: hash.digest('hex').slice(0, 16) }
}

export interface WebAppManifest {
  name: string
  short_name: string
  description: string
  theme_color: string
  background_color: string
  display: 'standalone'
  icons: { src: string; sizes: string; type: string; purpose: string }[]
}

/** `publicFiles`: files in public/ to cache as well (Vite copies them outside the bundle). */
export function serviceWorker(options: { manifest: WebAppManifest; publicFiles: string[] }): Plugin {
  let base = '/'
  let build = false
  return {
    name: 'fmde-hub-service-worker',
    enforce: 'post',
    configResolved(config) {
      base = config.base
      build = config.command === 'build'
    },
    buildStart() {
      if (build) this.emitFile({ type: 'chunk', id: SW_SOURCE, fileName: SW_FILE })
    },
    transformIndexHtml() {
      return [{ tag: 'link', attrs: { rel: 'manifest', href: `${base}${MANIFEST_FILE}` }, injectTo: 'head' }]
    },
    generateBundle(_, bundle) {
      if (!build) return
      this.emitFile({ type: 'asset', fileName: MANIFEST_FILE, source: `${JSON.stringify(options.manifest, null, 2)}\n` })
      const sw = bundle[SW_FILE]
      if (sw?.type !== 'chunk') throw new Error(`${SW_FILE} missing from the bundle`)
      if (sw.imports.length > 0) throw new Error(`${SW_FILE} must not import other chunks: ${sw.imports.join(', ')}`)
      const files = Object.values(bundle).map((f) => ({ fileName: f.fileName, content: f.type === 'chunk' ? f.code : f.source }))
      const { urls, version } = precacheManifest(files, [MANIFEST_FILE, ...options.publicFiles])
      for (const [placeholder, value] of [['__FMDEHUB_PRECACHE__', JSON.stringify(urls)], ['__FMDEHUB_CACHE_VERSION__', JSON.stringify(version)]] as const) {
        if (!sw.code.includes(placeholder)) throw new Error(`${SW_FILE}: ${placeholder} not found`)
        sw.code = sw.code.replaceAll(placeholder, value)
      }
    },
  }
}
