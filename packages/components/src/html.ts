// Links from untrusted metadata. Metadata comes straight off the broker, so anyone who can publish to
// the First Mile topics controls node names, units, URLs and namespace URIs. Text is never put into
// HTML strings: Vue templates escape it, and tooltips and popups are built as DOM nodes (dom.ts).

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
