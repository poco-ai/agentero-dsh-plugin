/**
 * Host allow-list for `/agentero/api`.
 *
 * dsh's web server does not authenticate plugin routes. This check keeps the
 * API on the machine that is running dsh, and also accepts the single address
 * the web server is configured to bind. Other Host values stay rejected so a
 * DNS-rebinding name cannot reach the vault.
 */

/** Host header name without the port. Bracketed IPv6 keeps the address inside the brackets. */
export function requestHostName(header: string | undefined): string | undefined {
  if (header === undefined) return undefined
  const value = header.trim().toLowerCase()
  if (value === '') return undefined
  if (value.startsWith('[')) {
    const end = value.indexOf(']')
    if (end < 2) return undefined
    return value.slice(1, end)
  }
  if (value === '::1') return value
  const colon = value.lastIndexOf(':')
  if (colon === -1) return value
  if (value.indexOf(':') !== colon) return undefined
  return value.slice(0, colon)
}

/** Bind address text, including unbracketed IPv6. A zone id is not a URL host. */
function bindHostName(host: string | undefined): string | undefined {
  if (host === undefined) return undefined
  const value = host.trim().toLowerCase()
  if (value === '') return undefined
  const zone = value.indexOf('%')
  const bare = zone === -1 ? value : value.slice(0, zone)
  if (bare.startsWith('[')) {
    const end = bare.indexOf(']')
    if (end < 2) return undefined
    return bare.slice(1, end)
  }
  return bare
}

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '::1'])
const WILDCARD = new Set(['0.0.0.0', '::', '::0'])

/**
 * True when the request Host is loopback, or the concrete address dsh web is bound to.
 * Wildcard binds are not treated as an allow-all.
 */
export function isAllowedApiHost(header: string | undefined, bindHost: string | undefined): boolean {
  const name = requestHostName(header)
  if (name === undefined) return false
  if (LOOPBACK.has(name)) return true
  const bound = bindHostName(bindHost)
  if (bound === undefined || WILDCARD.has(bound) || LOOPBACK.has(bound)) return false
  return name === bound
}
