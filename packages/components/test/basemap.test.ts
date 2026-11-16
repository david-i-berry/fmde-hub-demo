// Mapbox basemap: which style URLs and tokens are accepted, and the raster style built from them.
import { describe, expect, it } from 'vitest'
import { MAPBOX_SOURCE, mapboxBasemap, mapboxRasterStyle, mapboxStyleUrlProblem, mapboxTokenProblem, parseMapboxStyleUrl } from '../src/basemap'

const TOKEN = 'pk.eyJ1IjoiZXhhbXBsZSJ9.abc-DEF_123'

describe('parseMapboxStyleUrl', () => {
  it('reads mapbox:// and https://api.mapbox.com style URLs', () => {
    const ref = { user: 'wmo-user', style: 'clx1abc2d00ef01pq' }
    expect(parseMapboxStyleUrl('mapbox://styles/wmo-user/clx1abc2d00ef01pq')).toEqual(ref)
    expect(parseMapboxStyleUrl(' https://api.mapbox.com/styles/v1/wmo-user/clx1abc2d00ef01pq ')).toEqual(ref)
    // Mapbox Studio's share URL, with its own token and title: only the user and style are kept
    expect(parseMapboxStyleUrl('https://api.mapbox.com/styles/v1/wmo-user/clx1abc2d00ef01pq.html?title=view&access_token=pk.x.y#2/0/0')).toEqual(ref)
    expect(parseMapboxStyleUrl('https://api.mapbox.com/styles/v1/wmo-user/clx1abc2d00ef01pq/draft')).toEqual(ref)
  })

  it('refuses other hosts, schemes and ids', () => {
    for (const url of [
      'http://api.mapbox.com/styles/v1/u/s',
      'https://api.mapbox.com.evil.example/styles/v1/u/s',
      'https://evil.example/styles/v1/u/s',
      'mapbox://styles/u',
      'mapbox://styles/../s',
      'mapbox://styles/u/s?x=1',
      'javascript:alert(1)',
      '',
    ]) {
      expect(parseMapboxStyleUrl(url), url).toBeNull()
    }
    expect(mapboxStyleUrlProblem('https://evil.example/s')).toMatch(/mapbox:\/\/styles/)
  })
})

describe('mapboxTokenProblem', () => {
  it('accepts a public token', () => {
    expect(mapboxTokenProblem(TOKEN)).toBeNull()
  })

  it('refuses a secret token, and anything else', () => {
    expect(mapboxTokenProblem('sk.eyJ1IjoiZXhhbXBsZSJ9.abc')).toMatch(/secret/)
    expect(mapboxTokenProblem('')).toMatch(/enter/)
    expect(mapboxTokenProblem('pk.abc')).toMatch(/not a Mapbox public token/)
    expect(mapboxTokenProblem('pk.a.b&x=1')).toMatch(/not a Mapbox public token/)
  })
})

describe('mapboxRasterStyle', () => {
  it('draws the style as Static Tiles API raster tiles, with fonts for the labels and attribution', () => {
    const style = mapboxRasterStyle({ user: 'wmo-user', style: 'abc' }, ` ${TOKEN} `, true)
    const source = style.sources[MAPBOX_SOURCE] as { type: string; tiles: string[]; tileSize: number; attribution: string }
    expect(source.type).toBe('raster')
    expect(source.tileSize).toBe(512)
    expect(source.tiles).toEqual([`https://api.mapbox.com/styles/v1/wmo-user/abc/tiles/512/{z}/{x}/{y}@2x?access_token=${TOKEN}`])
    expect(source.attribution).toMatch(/Mapbox.*OpenStreetMap/)
    expect(style.glyphs).toMatch(/^https:\/\/.*\{fontstack\}\/\{range\}\.pbf$/)
    expect(mapboxRasterStyle({ user: 'u', style: 's' }, TOKEN, false).sources[MAPBOX_SOURCE]).toMatchObject({ tiles: [expect.stringContaining('/{y}?access_token=')] })
  })

  it('gives no basemap unless both the URL and the token are valid', () => {
    expect(mapboxBasemap('mapbox://styles/u/s', TOKEN)).not.toBeNull()
    expect(mapboxBasemap('', TOKEN)).toBeNull()
    expect(mapboxBasemap('mapbox://styles/u/s', 'sk.a.b')).toBeNull()
  })
})
