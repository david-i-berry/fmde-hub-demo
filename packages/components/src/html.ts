// Helpers for putting untrusted text into HTML. Metadata comes straight off the broker, so anyone who
// can publish to the First Mile topics controls node names, units, URLs and namespace URIs.

/** Escape text for an HTML string (ECharts tooltips, MapLibre popups, innerHTML). */
export const esc = (s: string): string =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)

/** The URL if it is absolute http(s), else undefined: never a javascript:, data: or other scheme in an href. */
export function safeUrl(url: string | undefined | null): string | undefined {
  if (!url) return undefined
  try {
    const u = new URL(url)
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.href : undefined
  } catch {
    return undefined
  }
}
