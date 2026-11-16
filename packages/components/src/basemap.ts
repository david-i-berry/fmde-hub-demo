// A Mapbox Studio style as the map's basemap, drawn as raster tiles from the Mapbox Static Tiles API
// (https://docs.mapbox.com/api/maps/static-tiles/), which may be shown with any map library.
// The node layers' labels keep their fonts from OpenFreeMap, as with the default basemap.
import type { StyleSpecification } from 'maplibre-gl'

/** Fonts for the node and cluster labels (Noto Sans, as in the default OpenFreeMap styles). */
export const LABEL_GLYPHS = 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf'

/** The source id of the Mapbox tiles, so tile errors can be told apart from the map's own. */
export const MAPBOX_SOURCE = 'mapbox'

export interface MapboxStyleRef {
  user: string
  style: string
}

/** Mapbox user names and style ids: a letter or digit, then letters, digits, '-', '_' or '.'. */
const ID = '[A-Za-z0-9][A-Za-z0-9_.-]*'
const STYLE_URL = [
  new RegExp(`^mapbox://styles/(${ID})/(${ID})$`),
  // the style API URL, as Mapbox Studio's "Share" gives it; anything after the style id is dropped
  new RegExp(`^https://api\\.mapbox\\.com/styles/v1/(${ID})/(${ID})(?:[/?#].*)?$`),
]

/** The user and style id of a Mapbox style URL, or null if it is not one. */
export function parseMapboxStyleUrl(url: string): MapboxStyleRef | null {
  const trimmed = url.trim()
  for (const re of STYLE_URL) {
    const m = re.exec(trimmed)
    if (m) return { user: m[1]!, style: m[2]!.replace(/\.html$/, '') } // Studio's share page: <style>.html
  }
  return null
}

export function mapboxStyleUrlProblem(url: string): string | null {
  if (!url.trim()) return 'enter the style URL'
  return parseMapboxStyleUrl(url) ? null : 'use mapbox://styles/<user>/<style> or https://api.mapbox.com/styles/v1/<user>/<style>'
}

/**
 * Only public tokens (pk.…) belong in a web page: anyone who opens it can read the token. A secret
 * token (sk.…) is refused, since it can change the account.
 */
export function mapboxTokenProblem(token: string): string | null {
  const t = token.trim()
  if (!t) return 'enter a Mapbox access token'
  if (t.startsWith('sk.')) return 'this is a secret token: use a public token (pk.…), never a secret one, in a web page'
  if (!/^pk\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(t)) return 'not a Mapbox public token (pk.…)'
  return null
}

/** A MapLibre style of the Mapbox style's raster tiles. `retina`: 1024 px tiles shown at 512 px. */
export function mapboxRasterStyle(ref: MapboxStyleRef, token: string, retina = (globalThis.devicePixelRatio ?? 1) > 1): StyleSpecification {
  const path = `${encodeURIComponent(ref.user)}/${encodeURIComponent(ref.style)}`
  return {
    version: 8,
    glyphs: LABEL_GLYPHS,
    sources: {
      [MAPBOX_SOURCE]: {
        type: 'raster',
        tiles: [`https://api.mapbox.com/styles/v1/${path}/tiles/512/{z}/{x}/{y}${retina ? '@2x' : ''}?access_token=${encodeURIComponent(token.trim())}`],
        tileSize: 512,
        maxzoom: 22,
        attribution:
          '© <a href="https://www.mapbox.com/about/maps/" target="_blank" rel="noopener">Mapbox</a> ' +
          '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>',
      },
    },
    layers: [{ id: MAPBOX_SOURCE, type: 'raster', source: MAPBOX_SOURCE }],
  }
}

/** The basemap for a style URL and token, or null when either is missing or not valid. */
export function mapboxBasemap(url: string, token: string): StyleSpecification | null {
  const ref = parseMapboxStyleUrl(url)
  return ref && !mapboxTokenProblem(token) ? mapboxRasterStyle(ref, token) : null
}
