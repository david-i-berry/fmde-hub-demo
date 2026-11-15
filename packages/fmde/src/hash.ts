/**
 * Hex SHA-256 of the parts, concatenated (strings as UTF-8), using the platform's Web Crypto.
 * crypto.subtle exists in browsers only in a secure context (https, or http://localhost), and in
 * Node 20+. There is deliberately no fallback implementation: open FMDEhub over https.
 */
export async function sha256Hex(...parts: (Uint8Array | string)[]): Promise<string> {
  if (!globalThis.crypto?.subtle) {
    throw new Error('Web Crypto (crypto.subtle) is unavailable: FMDEhub must be opened over https or on localhost')
  }
  const enc = new TextEncoder()
  const chunks = parts.map((p) => (typeof p === 'string' ? enc.encode(p) : p))
  const buf = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0))
  let off = 0
  for (const c of chunks) {
    buf.set(c, off)
    off += c.length
  }
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', buf))
  return Array.from(digest, (b) => b.toString(16).padStart(2, '0')).join('')
}
