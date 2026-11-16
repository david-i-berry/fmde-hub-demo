import { describe, expect, it } from 'vitest'
import { esc, safeUrl } from '../src/html'

describe('esc', () => {
  it('escapes markup', () => {
    expect(esc(`<img src=x onerror="alert('x')">&`)).toBe('&lt;img src=x onerror=&quot;alert(&#39;x&#39;)&quot;&gt;&amp;')
  })
})

describe('safeUrl', () => {
  it('allows absolute http(s) URLs', () => {
    expect(safeUrl('https://example.org/station?id=1')).toBe('https://example.org/station?id=1')
    expect(safeUrl('http://example.org')).toBe('http://example.org/')
  })

  it('rejects other schemes, relative URLs and junk', () => {
    expect(safeUrl('javascript:alert(1)')).toBeUndefined()
    expect(safeUrl(' JavaScript:alert(1)')).toBeUndefined()
    expect(safeUrl('data:text/html,<script>alert(1)</script>')).toBeUndefined()
    expect(safeUrl('/relative')).toBeUndefined()
    expect(safeUrl('not a url')).toBeUndefined()
    expect(safeUrl(undefined)).toBeUndefined()
    expect(safeUrl('')).toBeUndefined()
  })
})
