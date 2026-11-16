// The broker URL FMDEhub connects to: encrypted only, except to this machine (local development).

/** Hosts on this machine, where unencrypted connections never cross a network. */
const LOCAL_HOSTS = ['localhost', '127.0.0.1', '[::1]']

function parse(url: string): URL | null {
  try {
    return new URL(url)
  } catch {
    return null
  }
}

/**
 * Why a broker URL is refused, or null if it is acceptable: it must be wss:// (TLS), so the
 * credentials and the data cannot be read or altered in transit. Unencrypted ws:// is allowed only
 * to this machine, for local development brokers.
 */
export function brokerUrlProblem(url: string): string | null {
  const u = parse(url)
  if (!u) return 'not a valid URL'
  if (u.protocol === 'wss:') return null
  if (u.protocol === 'ws:') return LOCAL_HOSTS.includes(u.hostname) ? null : 'use wss:// (ws:// is unencrypted; allowed only for localhost)'
  return 'use a wss:// URL'
}

