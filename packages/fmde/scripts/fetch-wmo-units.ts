// Refresh src/data/wmo-units.json: a snapshot of WMO Common Code Table C-6 (units) from the WMO
// codes registry. ats.ts checks parameter units against it (UNIT_NOT_IN_CODELIST). The snapshot is
// written as published (notation, WMO abbreviation, label, sorted by notation); ats.ts documents the
// entries it does not treat as units.
//
//   npm run fetch:units -w packages/fmde
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const SOURCE = 'https://codes.wmo.int/common/unit'
const UNIT_TYPE = 'http://codes.wmo.int/def/common/Unit'
const ABBREVIATION = 'http://codes.wmo.int/def/common/wmoAbbreviation'
const out = fileURLToPath(new URL('../src/data/wmo-units.json', import.meta.url))

interface Unit {
  notation: string
  abbreviation?: string
  label: string
}

/** A JSON-LD literal: a plain string, or { "@value": … }. */
const text = (v: unknown): unknown => (v && typeof v === 'object' ? (v as { '@value'?: unknown })['@value'] : v)

const res = await fetch(`${SOURCE}?_format=jsonld`, { headers: { accept: 'application/ld+json' } })
if (!res.ok) throw new Error(`${SOURCE}: HTTP ${res.status}`)
const graph: unknown = ((await res.json()) as { '@graph'?: unknown })['@graph']
if (!Array.isArray(graph)) throw new Error(`${SOURCE}: no @graph in the response`)

const units: Unit[] = (graph as Record<string, unknown>[])
  .filter((x) => [x['@type']].flat().includes(UNIT_TYPE))
  .map((x) => {
    const notation = text(x['skos:notation'])
    const label = text(x['rdfs:label'] ?? x['skos:prefLabel'])
    if (typeof notation !== 'string' || typeof label !== 'string') throw new Error(`unexpected entry: ${JSON.stringify(x)}`)
    const abbreviation = text(x[ABBREVIATION])
    return { notation, ...(typeof abbreviation === 'string' ? { abbreviation } : {}), label }
  })
  // code-point order, independent of locale, so reruns give a stable diff
  .sort((a, b) => (a.notation < b.notation ? -1 : a.notation > b.notation ? 1 : a.label < b.label ? -1 : a.label > b.label ? 1 : 0))
if (units.length === 0) throw new Error(`${SOURCE}: no units found`)

const retrieved = new Date().toISOString().slice(0, 10)
writeFileSync(out, `${JSON.stringify({ source: SOURCE, retrieved, units }, null, 1)}\n`)
console.log(`${units.length} units from ${SOURCE} -> ${out}`)
