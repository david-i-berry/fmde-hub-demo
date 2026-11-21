// The service worker's precache list and cache version (build/service-worker.ts).
import { describe, expect, it } from 'vitest'
import { precacheManifest } from '../build/service-worker'

const files = [
  { fileName: 'index.html', content: '<html>' },
  { fileName: 'assets/index-abc.js', content: 'code' },
  { fileName: 'assets/index-abc.js.map', content: '{}' },
  { fileName: 'assets/pglite-def.wasm', content: new Uint8Array([0, 97, 115, 109]) },
  { fileName: 'sw.js', content: 'self' },
]

describe('precacheManifest', () => {
  it('lists every built file except sw.js and source maps, plus the extra public files, sorted', () => {
    expect(precacheManifest(files, ['manifest.webmanifest', 'icon.svg']).urls).toEqual([
      'assets/index-abc.js',
      'assets/pglite-def.wasm',
      'icon.svg',
      'index.html',
      'manifest.webmanifest',
    ])
  })

  it('gives the same version for the same contents, in any order', () => {
    expect(precacheManifest([...files].reverse()).version).toBe(precacheManifest(files).version)
  })

  it('changes the version when any cached file changes, including index.html (not content-hashed)', () => {
    const v = precacheManifest(files).version
    const changedHtml = files.map((f) => (f.fileName === 'index.html' ? { ...f, content: '<html lang="en">' } : f))
    const changedWasm = files.map((f) => (f.fileName.endsWith('.wasm') ? { ...f, content: new Uint8Array([1]) } : f))
    expect(precacheManifest(changedHtml).version).not.toBe(v)
    expect(precacheManifest(changedWasm).version).not.toBe(v)
  })

  it('ignores changes to files it does not cache', () => {
    const changedMap = files.map((f) => (f.fileName.endsWith('.map') ? { ...f, content: '{"x":1}' } : f))
    expect(precacheManifest(changedMap).version).toBe(precacheManifest(files).version)
  })
})
