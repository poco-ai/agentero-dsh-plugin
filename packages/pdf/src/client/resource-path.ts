/**
 * File resources the right Sidebar routes to this plugin.
 *
 * PDF links and mentions arrive as `dsh-resource://file/...` addresses. A
 * Session-scoped address keeps the path as the caller wrote it (workspace
 * relative or absolute); the absolute form drops the leading slash. The host
 * only reads files inside the vault, so an address has to be mapped back to a
 * vault-relative ref before the panel can open it.
 */

/** The scheme and type every file address opens with. */
const FILE_PREFIX = 'dsh-resource://file/'

/**
 * Addresses that name a whole paper rather than one file.
 *
 * The panel reads and writes a paper through its directory, and a right-sidebar
 * tab keeps only its address across reloads — navigation parameters are not part
 * of the persisted layout. Naming the paper in the address therefore keeps a
 * restored tab pointing at the same paper.
 */
const PAPER_PREFIX = 'dsh-resource://agentero-paper/'

/**
 * Address that opens one vault paper.
 * @param ref - vault-relative paper directory, such as `papers/group/2604.15588`.
 * @returns its `dsh-resource://agentero-paper/...` address.
 */
export function paperAddress(ref: string): string {
  const segments = ref.split('/').filter(part => part !== '')
  return PAPER_PREFIX + segments.map(encodeURIComponent).join('/')
}

/**
 * Paper directory an address names.
 * @param address - candidate address.
 * @returns the vault-relative ref, or undefined for another resource or a malformed address.
 */
export function parsePaperAddress(address: string): string | undefined {
  if (!address.startsWith(PAPER_PREFIX)) return undefined
  const end = address.search(/[?#]/)
  const rest = address.slice(PAPER_PREFIX.length, end === -1 ? undefined : end)
  if (rest === '') return undefined
  try {
    return rest.split('/').map(decodeURIComponent).join('/')
  } catch {
    // decodeURIComponent throws on a malformed escape; such an address names nothing.
    return undefined
  }
}

/**
 * Final segment of a slash-separated path.
 * @param path - any path or ref.
 * @returns the last non-empty segment, or undefined when there is none.
 */
export function lastSegment(path: string): string | undefined {
  const segments = path.split('/').filter(part => part !== '')
  return segments[segments.length - 1]
}

/** A file address split into its scope and decoded path. */
export type FileResource =
  | {
    readonly scope: 'session'
    readonly sessionId: string
    /** Absolute or workspace-relative path; `/`-separated. */
    readonly path: string
  }
  | {
    readonly scope: 'absolute'
    /** Absolute path: `/a/b` on POSIX, `C:/a/b` on Windows, `//server/share/a` for UNC. */
    readonly path: string
  }

function isDriveSegment(segment: string | undefined): boolean {
  return segment !== undefined && /^[A-Za-z]:$/.test(segment)
}

/**
 * Parse one `dsh-resource://file/` address.
 * @param address - candidate address.
 * @returns its scope and decoded path, or undefined for another resource or a malformed address.
 */
export function parseFileResource(address: string): FileResource | undefined {
  if (!address.startsWith(FILE_PREFIX)) return undefined
  try {
    const end = address.search(/[?#]/)
    const [scope, ...rest] = address.slice(FILE_PREFIX.length, end === -1 ? undefined : end).split('/')
    if (scope === 'session') {
      const [sessionId, ...segments] = rest
      if (sessionId === undefined || sessionId === '' || segments.length === 0) return undefined
      return { scope, sessionId: decodeURIComponent(sessionId), path: segments.map(decodeURIComponent).join('/') }
    }
    if (scope === 'absolute') {
      const unc = rest[0] === '' && rest.length > 1
      const segments = (unc ? rest.slice(1) : rest).map(decodeURIComponent)
      if (segments.length === 0 || segments[0] === '') return undefined
      if (unc) return { scope, path: `//${segments.join('/')}` }
      return { scope, path: isDriveSegment(segments[0]) ? segments.join('/') : `/${segments.join('/')}` }
    }
    return undefined
  } catch {
    // decodeURIComponent throws on a malformed escape; such an address names nothing.
    return undefined
  }
}

/** Whether a path is absolute in either spelling the host accepts. */
export function isAbsolutePath(value: string): boolean {
  return value.startsWith('/') || /^[A-Za-z]:[/\\]/.test(value) || value.startsWith('\\\\')
}

/** Join a relative path onto an absolute base, using `/` separators. */
export function joinPath(base: string, relative: string): string {
  return `${base.replace(/\\/g, '/').replace(/\/+$/, '')}/${relative.replace(/\\/g, '/').replace(/^(?:\.\/)+/, '')}`
}

/**
 * Strip the vault root from an absolute path.
 * @param vaultPath - configured vault directory.
 * @param absolutePath - absolute path to test.
 * @returns the vault-relative path, or undefined when it lies outside the vault.
 */
export function vaultRelative(vaultPath: string, absolutePath: string): string | undefined {
  const root = vaultPath.replace(/\\/g, '/').replace(/\/+$/, '')
  if (root === '') return undefined
  const normalized = absolutePath.replace(/\\/g, '/')
  const windows = /^[A-Za-z]:/.test(root)
  const prefix = `${root}/`
  const candidate = windows ? normalized.toLowerCase() : normalized
  const expected = windows ? prefix.toLowerCase() : prefix
  if (!candidate.startsWith(expected)) return undefined
  return normalized.slice(prefix.length)
}

/**
 * Final path segment of a file-resource address.
 * @param address - candidate address.
 * @returns the decoded basename, or undefined when the address is not a file resource.
 */
export function resourceName(address: string): string | undefined {
  const file = parseFileResource(address)
  if (file === undefined) return undefined
  const name = file.path.slice(file.path.lastIndexOf('/') + 1)
  return name === '' ? undefined : name
}

const PDF_FILE_NAME = /\.[pP][dD][fF]$/

/**
 * Paper directory accepted by the notes write API.
 *
 * Vaults group papers as `papers/<group>/<paper>` as well as `papers/<paper>`.
 * A ref may name that directory or a PDF inside it. `papers` itself and a PDF
 * sitting directly in `papers/` are not paper directories. `.` and `..` segments
 * are rejected.
 */
export function notesPaperPath(ref: string): string | undefined {
  const normalized = ref.replaceAll('\\', '/').replace(/\/+$/, '')
  const segments = normalized.split('/')
  if (segments.length < 2 || segments[0] !== 'papers') return undefined
  if (segments.some(segment => segment === '' || segment === '.' || segment === '..')) return undefined
  const last = segments[segments.length - 1] ?? ''
  const directory = PDF_FILE_NAME.test(last) ? segments.slice(0, -1) : segments
  if (directory.length < 2) return undefined
  return directory.join('/')
}
