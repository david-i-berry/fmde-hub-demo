// Every 'mdi-…' icon name used in the app or the components must be in ICON_PATHS; an unknown name
// would render as an empty icon.
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { ICON_PATHS } from '../src/icon-paths'

const SOURCE_DIRS = ['../src', '../../../packages/components/src'].map((d) => fileURLToPath(new URL(d, import.meta.url)))

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? sourceFiles(join(dir, e.name)) : /\.(ts|vue)$/.test(e.name) && e.name !== 'icon-paths.ts' ? [join(dir, e.name)] : [],
  )
}

const used = new Set(SOURCE_DIRS.flatMap(sourceFiles).flatMap((f) => readFileSync(f, 'utf8').match(/(?<=['"`])mdi-[a-z0-9-]+(?=['"`])/g) ?? []))

describe('ICON_PATHS', () => {
  it('finds the icons used in the source', () => {
    expect(used.size).toBeGreaterThan(40)
  })

  it('has an SVG path for every icon name used', () => {
    expect([...used].filter((name) => !(name in ICON_PATHS))).toEqual([])
  })

  it('holds no icons that are no longer used', () => {
    expect(Object.keys(ICON_PATHS).filter((name) => !used.has(name))).toEqual([])
  })

  it('maps each name to SVG path data', () => {
    for (const [name, path] of Object.entries(ICON_PATHS)) expect(path, name).toMatch(/^M[\d.,\sA-Za-z-]+$/)
  })
})
