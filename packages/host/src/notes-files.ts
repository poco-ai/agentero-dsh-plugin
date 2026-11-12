import { lstat, mkdir, readFile, readdir, readlink, realpath, writeFile } from 'node:fs/promises'
import * as path from 'node:path'

/** Markdown files returned from one vault `notes` directory. */
const NOTE_LIMIT = 500

export interface NoteListItem {
  path: string
  title: string
}

export type NoteFileResult =
  | { status: 200, path: string, text: string }
  | { status: 400 | 404, error: string }

export type NoteWriteResult =
  | { status: 200, path: string }
  | { status: 400 | 404, error: string }

const INVALID_PATH = 'invalid path'
const NOT_FOUND = 'not found'

function ioCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('code' in error)) return undefined
  return typeof error.code === 'string' ? error.code : undefined
}

/**
 * Vault-relative path with `/` separators.
 * Absolute paths and `.` / `..` segments are rejected.
 */
function vaultRelative(input: string): string | undefined {
  if (/[\u0000-\u001f]/.test(input)) return undefined
  const unified = input.replaceAll('\\', '/')
  if (unified === '' || unified.startsWith('/') || /^[a-zA-Z]:/.test(unified)) return undefined
  if (path.win32.isAbsolute(input) || path.posix.isAbsolute(unified)) return undefined
  const segments = unified.split('/')
  if (segments.some(segment => segment === '' || segment === '.' || segment === '..')) return undefined
  return segments.join('/')
}

export function within(parent: string, child: string, allowEqual: boolean): boolean {
  const relative = path.relative(parent, child)
  if (relative === '') return allowEqual
  if (path.isAbsolute(relative)) return false
  return relative !== '..' && !relative.startsWith(`..${path.sep}`)
}

function samePath(left: string, right: string): boolean {
  return path.relative(left, right) === ''
}

async function vaultDirectory(vault: string): Promise<string | undefined> {
  try {
    const real = await realpath(vault)
    const stat = await lstat(real)
    if (!stat.isDirectory()) return undefined
    return real
  } catch (error) {
    const code = ioCode(error)
    if (code === 'ENOENT' || code === 'ENOTDIR') return undefined
    throw error
  }
}

function opensFence(line: string): { char: string, len: number } | undefined {
  const match = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line)
  if (match === null) return undefined
  const marker = match[1] ?? ''
  const info = match[2] ?? ''
  if (marker.startsWith('`') && info.includes('`')) return undefined
  const char = marker[0]
  if (char !== '`' && char !== '~') return undefined
  return { char, len: marker.length }
}

function closesFence(line: string, open: { char: string, len: number }): boolean {
  const match = /^ {0,3}(`{3,}|~{3,})[ \t]*$/.exec(line)
  if (match === null) return false
  const marker = match[1] ?? ''
  return marker[0] === open.char && marker.length >= open.len
}

/** First ATX heading outside a fence. Empty headings are skipped. */
function atxHeading(line: string): string | undefined {
  const match = /^ {0,3}(#{1,6})[ \t]+(.*)$/.exec(line)
  if (match === null) return undefined
  const text = (match[2] ?? '').replace(/[ \t]+#+\s*$/, '').trim()
  if (text === '') return undefined
  return text
}

function noteTitle(text: string, filename: string): string {
  const source = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
  let fence: { char: string, len: number } | undefined
  for (const line of source.split(/\r?\n/)) {
    if (fence !== undefined) {
      if (closesFence(line, fence)) fence = undefined
      continue
    }
    const opened = opensFence(line)
    if (opened !== undefined) {
      fence = opened
      continue
    }
    const heading = atxHeading(line)
    if (heading !== undefined) return heading
  }
  return filename
}

async function walkNotes(dir: string, relPosix: string, out: NoteListItem[]): Promise<void> {
  if (out.length >= NOTE_LIMIT) return
  const entries = await readdir(dir, { withFileTypes: true })
  entries.sort((left, right) => left.name.localeCompare(right.name))
  const files: string[] = []
  const dirs: string[] = []
  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue
    if (entry.isDirectory()) {
      if (entry.name.startsWith('.')) continue
      dirs.push(entry.name)
      continue
    }
    if (!entry.isFile() || !entry.name.endsWith('.md')) continue
    files.push(entry.name)
  }
  for (const name of files) {
    if (out.length >= NOTE_LIMIT) return
    const rel = `${relPosix}/${name}`
    let title = name
    try {
      title = noteTitle(await readFile(path.join(dir, name), 'utf8'), name)
    } catch {
      title = name
    }
    out.push({ path: rel, title })
  }
  for (const name of dirs) {
    if (out.length >= NOTE_LIMIT) return
    await walkNotes(path.join(dir, name), `${relPosix}/${name}`, out)
  }
}

/** Markdown files under `<vault>/notes`. A missing notes directory is an empty list. */
export async function listVaultNotes(vault: string): Promise<NoteListItem[]> {
  const root = await vaultDirectory(vault)
  if (root === undefined) return []
  const notesLexical = path.join(root, 'notes')
  let notesReal: string
  try {
    notesReal = await realpath(notesLexical)
  } catch (error) {
    if (ioCode(error) === 'ENOENT') return []
    throw error
  }
  const stat = await lstat(notesReal)
  if (!stat.isDirectory() || !within(root, notesReal, false)) return []
  const notes: NoteListItem[] = []
  await walkNotes(notesReal, 'notes', notes)
  notes.sort((left, right) => left.path.localeCompare(right.path))
  return notes
}

/** Read a UTF-8 file whose real path stays inside the vault. */
export async function readVaultFile(vault: string, rawPath: string): Promise<NoteFileResult> {
  const relative = vaultRelative(rawPath)
  if (relative === undefined) return { status: 400, error: INVALID_PATH }
  const root = await vaultDirectory(vault)
  if (root === undefined) return { status: 404, error: NOT_FOUND }
  const lexical = path.join(root, ...relative.split('/'))
  if (!within(root, lexical, false)) return { status: 400, error: INVALID_PATH }
  try {
    const stat = await lstat(lexical)
    if (stat.isSymbolicLink()) {
      const target = await readlink(lexical)
      const resolved = path.resolve(path.dirname(lexical), target)
      if (!within(root, resolved, false)) return { status: 400, error: INVALID_PATH }
    }
  } catch (error) {
    const code = ioCode(error)
    if (code === 'ENOENT') return { status: 404, error: NOT_FOUND }
    if (code === 'ELOOP' || code === 'ENOTDIR') return { status: 400, error: INVALID_PATH }
    throw error
  }
  let real: string
  try {
    real = await realpath(lexical)
  } catch (error) {
    const code = ioCode(error)
    if (code === 'ENOENT') return { status: 404, error: NOT_FOUND }
    if (code === 'ELOOP' || code === 'ENOTDIR') return { status: 400, error: INVALID_PATH }
    throw error
  }
  if (!within(root, real, false)) return { status: 400, error: INVALID_PATH }
  const stat = await lstat(real)
  if (!stat.isFile()) return { status: 400, error: INVALID_PATH }
  const text = await readFile(real, 'utf8')
  return { status: 200, path: relative, text }
}

interface Ancestor {
  lexical: string
  real: string
  missing: string[]
}

/** Nearest existing directory at or above `start`. */
async function firstExisting(start: string): Promise<Ancestor | 'bad'> {
  const missing: string[] = []
  let current = start
  for (;;) {
    let stat
    try {
      stat = await lstat(current)
    } catch (error) {
      if (ioCode(error) !== 'ENOENT') throw error
      missing.push(current)
      const parent = path.dirname(current)
      if (parent === current) return 'bad'
      current = parent
      continue
    }
    if (!stat.isDirectory() && !stat.isSymbolicLink()) return 'bad'
    let real: string
    try {
      real = await realpath(current)
    } catch (error) {
      const code = ioCode(error)
      if (code === 'ENOENT' || code === 'ELOOP' || code === 'ENOTDIR') return 'bad'
      throw error
    }
    const realStat = await lstat(real)
    if (!realStat.isDirectory()) return 'bad'
    return { lexical: current, real, missing }
  }
}

function notesFile(relative: string): boolean {
  return relative.startsWith('notes/') && relative.length > 'notes/'.length
}

/**
 * `papers/<...>/NOTES.md` at any depth. The paper directory must already exist.
 * `papers/NOTES.md` is not a paper note.
 */
function paperNotesFile(relative: string): boolean {
  const segments = relative.split('/')
  if (segments.length < 3 || segments[0] !== 'papers' || segments[segments.length - 1] !== 'NOTES.md') return false
  return segments.slice(1, -1).every(segment => segment !== '' && segment !== '.' && segment !== '..')
}

export interface VaultLocation {
  root: string
  relative: string
  lexical: string
}

/**
 * Resolve a vault-relative path to a lexical path inside the vault.
 * Does not require the target to exist.
 */
export async function locateVaultPath(vault: string, rawPath: string): Promise<
  | { ok: true, location: VaultLocation }
  | { ok: false, status: 400 | 404, error: string }
> {
  const relative = vaultRelative(rawPath)
  if (relative === undefined) return { ok: false, status: 400, error: INVALID_PATH }
  const root = await vaultDirectory(vault)
  if (root === undefined) return { ok: false, status: 404, error: NOT_FOUND }
  const lexical = path.join(root, ...relative.split('/'))
  if (!within(root, lexical, false)) return { ok: false, status: 400, error: INVALID_PATH }
  return { ok: true, location: { root, relative, lexical } }
}

/**
 * Create or replace `papers/<...>/NOTES.md`.
 * The paper directory must already exist. This does not create `papers/`.
 */
async function writePaperNotes(vault: string, relative: string, text: string): Promise<NoteWriteResult> {
  const located = await locateVaultPath(vault, relative)
  if (!located.ok) return { status: located.status, error: located.error }
  const { root, lexical } = located.location
  const parentLexical = path.dirname(lexical)
  let parentReal: string
  try {
    parentReal = await realpath(parentLexical)
  } catch (error) {
    const code = ioCode(error)
    if (code === 'ENOENT') return { status: 404, error: NOT_FOUND }
    if (code === 'ELOOP' || code === 'ENOTDIR') return { status: 400, error: INVALID_PATH }
    throw error
  }
  if (!within(root, parentReal, false)) return { status: 400, error: INVALID_PATH }
  const parentStat = await lstat(parentReal)
  if (!parentStat.isDirectory()) return { status: 400, error: INVALID_PATH }

  let exists = false
  try {
    await lstat(lexical)
    exists = true
  } catch (error) {
    if (ioCode(error) !== 'ENOENT') throw error
  }
  if (exists) {
    let fileReal: string
    try {
      fileReal = await realpath(lexical)
    } catch (error) {
      const code = ioCode(error)
      if (code === 'ENOENT' || code === 'ELOOP' || code === 'ENOTDIR') return { status: 400, error: INVALID_PATH }
      throw error
    }
    if (!within(parentReal, fileReal, false)) return { status: 400, error: INVALID_PATH }
    const fileStat = await lstat(fileReal)
    if (!fileStat.isFile()) return { status: 400, error: INVALID_PATH }
  }
  await writeFile(lexical, text, { encoding: 'utf8', flag: exists ? 'w' : 'wx' })
  return { status: 200, path: relative }
}

/**
 * Write UTF-8 under `<vault>/notes`, or replace one paper's `NOTES.md`.
 * Parent directories are created only inside `notes/`.
 * Other paths are refused.
 */
export async function writeVaultNote(vault: string, rawPath: string, text: string): Promise<NoteWriteResult> {
  const relative = vaultRelative(rawPath)
  if (relative === undefined) return { status: 400, error: INVALID_PATH }
  if (paperNotesFile(relative)) return writePaperNotes(vault, relative, text)
  if (!notesFile(relative)) return { status: 400, error: INVALID_PATH }
  const root = await vaultDirectory(vault)
  if (root === undefined) return { status: 404, error: NOT_FOUND }
  const notesLexical = path.join(root, 'notes')
  const fileLexical = path.join(root, ...relative.split('/'))
  if (!within(notesLexical, fileLexical, false)) return { status: 400, error: INVALID_PATH }

  const ancestor = await firstExisting(path.dirname(fileLexical))
  if (ancestor === 'bad' || !within(root, ancestor.real, true)) return { status: 400, error: INVALID_PATH }

  if (samePath(ancestor.real, root)) {
    // `notes` is not an existing directory. A symlink here would write outside it.
    try {
      await lstat(notesLexical)
      return { status: 400, error: INVALID_PATH }
    } catch (error) {
      if (ioCode(error) !== 'ENOENT') throw error
    }
    const underNotes = ancestor.missing.every(dir =>
      samePath(dir, notesLexical) || within(notesLexical, dir, false))
    if (!underNotes) return { status: 400, error: INVALID_PATH }
  } else {
    let notesReal: string
    try {
      notesReal = await realpath(notesLexical)
    } catch (error) {
      const code = ioCode(error)
      if (code === 'ENOENT' || code === 'ELOOP' || code === 'ENOTDIR') return { status: 400, error: INVALID_PATH }
      throw error
    }
    const notesStat = await lstat(notesReal)
    if (!notesStat.isDirectory() || !within(root, notesReal, false)) return { status: 400, error: INVALID_PATH }
    if (!within(notesReal, ancestor.real, true)) return { status: 400, error: INVALID_PATH }
    const projected = ancestor.missing.every(dir => {
      const suffix = path.relative(ancestor.lexical, dir)
      if (suffix === '' || path.isAbsolute(suffix) || suffix === '..' || suffix.startsWith(`..${path.sep}`)) return false
      return within(notesReal, path.resolve(ancestor.real, suffix), true)
    })
    if (!projected) return { status: 400, error: INVALID_PATH }
  }

  let exists = false
  try {
    await lstat(fileLexical)
    exists = true
  } catch (error) {
    if (ioCode(error) !== 'ENOENT') throw error
  }
  if (exists) {
    let fileReal: string
    let notesReal: string
    try {
      fileReal = await realpath(fileLexical)
      notesReal = await realpath(notesLexical)
    } catch (error) {
      const code = ioCode(error)
      if (code === 'ENOENT' || code === 'ELOOP' || code === 'ENOTDIR') return { status: 400, error: INVALID_PATH }
      throw error
    }
    if (!within(root, fileReal, false) || !within(root, notesReal, false) || !within(notesReal, fileReal, false)) {
      return { status: 400, error: INVALID_PATH }
    }
    const fileStat = await lstat(fileReal)
    if (!fileStat.isFile()) return { status: 400, error: INVALID_PATH }
  }

  if (!exists) await mkdir(path.dirname(fileLexical), { recursive: true })
  await writeFile(fileLexical, text, { encoding: 'utf8', flag: exists ? 'w' : 'wx' })
  return { status: 200, path: relative }
}
