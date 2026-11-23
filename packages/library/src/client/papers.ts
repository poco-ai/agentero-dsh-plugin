import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'

export type LibraryT = PropsLocale<'agentero.library'>['t']

export interface VaultInfo {
  path: string
  name: string
  scope: string
  recentVaults: { path: string, name: string }[]
  canPick: boolean
}

export interface LibraryFace {
  notifyError(message: string): void
  loadVault(): Promise<VaultInfo>
  loadPapers(): Promise<unknown>
  openPaper(id: string): boolean
  importId(text: string): Promise<void>
  importBib(text: string): Promise<void>
  exportBib(): Promise<string>
  discover(keyword: string): Promise<{ id: string, title: string }[]>
  addTag(ref: string, tag: string): Promise<void>
  removeTag(ref: string, tag: string): Promise<void>
  deletePaper(ref: string): Promise<void>
  download(ref: string): Promise<void>
  /** Change the reading state of a row listed at `revision`. */
  setRead(ref: string, read: boolean, revision: string): Promise<void>
}

export interface PaperTag {
  name: string
  color?: string | null
}

export interface PaperRow {
  key: string
  openId: string
  title: string
  authors: string
  year: string
  tags: PaperTag[]
  /** null means the Host could not tell the reading state. */
  isRead: boolean | null
  /** Catalog revision the row was listed at; changing its reading state requires it. */
  revision: string
}

export function errorText(body: unknown): string | undefined {
  if (body === null || typeof body !== 'object' || !('error' in body)) return undefined
  const error = body.error
  if (typeof error === 'string' && error.trim() !== '') return error
  if (error !== null && typeof error === 'object' && 'message' in error && typeof error.message === 'string') {
    return error.message
  }
  return undefined
}

/**
 * Rows from the Host's list document. `paper list` is paged and carries only
 * identity, state, tags, and a revision, so the Host completes every row with
 * `paper get` before answering `{ items: [...] }`.
 */
function paperItems(body: unknown): unknown[] | undefined {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) return undefined
  const items = (body as Record<string, unknown>).items
  return Array.isArray(items) ? items : undefined
}

function recordOf(body: unknown): Record<string, unknown> | undefined {
  return body !== null && typeof body === 'object' && !Array.isArray(body) ? body as Record<string, unknown> : undefined
}

function authorsText(value: unknown): string {
  if (typeof value === 'string') return value.trim()
  if (!Array.isArray(value)) return ''
  return value.filter((item): item is string => typeof item === 'string' && item.trim() !== '').join(', ')
}

function tagFrom(value: unknown): PaperTag | undefined {
  if (typeof value === 'string') {
    const name = value.trim()
    return name === '' ? undefined : { name }
  }
  if (value === null || typeof value !== 'object' || !('name' in value) || typeof value.name !== 'string') {
    return undefined
  }
  const name = value.name.trim()
  if (name === '') return undefined
  const color = 'color' in value && typeof value.color === 'string' && value.color.trim() !== ''
    ? value.color.trim()
    : undefined
  return color === undefined ? { name } : { name, color }
}

function tagsFrom(value: unknown): PaperTag[] {
  if (typeof value === 'string') {
    return value.split(',').map(name => name.trim()).filter(name => name !== '').map(name => ({ name }))
  }
  if (!Array.isArray(value)) return []
  const tags: PaperTag[] = []
  for (const item of value) {
    const tag = tagFrom(item)
    if (tag !== undefined) tags.push(tag)
  }
  return tags
}

function toRow(item: unknown, index: number): PaperRow | undefined {
  if (item === null || typeof item !== 'object') return undefined
  const record = item as Record<string, unknown>
  const path = typeof record.path === 'string' ? record.path : ''
  const id = typeof record.id === 'string' ? record.id : ''
  const openId = path !== '' ? path : id
  const title = typeof record.title === 'string' ? record.title : ''
  return {
    key: openId !== '' ? `${openId}:${index}` : String(index),
    openId,
    title,
    authors: authorsText(record.authors),
    year: typeof record.year === 'string' ? record.year.trim() : '',
    tags: tagsFrom(record.tags),
    isRead: record.state === 'read' ? true : record.state === 'unread' ? false : null,
    revision: typeof record.revision === 'string' ? record.revision : '',
  }
}

export function papersFrom(body: unknown): PaperRow[] {
  const items = paperItems(body)
  if (items === undefined) throw new Error('invalid papers response')
  const rows: PaperRow[] = []
  for (let index = 0; index < items.length; index += 1) {
    const row = toRow(items[index], index)
    if (row !== undefined) rows.push(row)
  }
  return rows
}

export function shown(message: string, t: LibraryT): string {
  if (message === 'vault is not configured') return t('vaultMissing')
  if (message === 'invalid vault') return t('invalidVault')
  if (message === 'directory picker unavailable') return t('pickerUnavailable')
  if (message === 'invalid papers response') return t('invalid')
  if (message === '') return t('actionFailed')
  return message
}

export async function readJson(response: Response): Promise<unknown> {
  const text = await response.text()
  if (text.trim() === '') return undefined
  try {
    return JSON.parse(text) as unknown
  } catch {
    return undefined
  }
}

export async function postJson(url: string, body: unknown, request: (url: string, init?: RequestInit) => Promise<Response> = fetch): Promise<unknown> {
  const response = await request(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    cache: 'no-store',
  })
  const parsed = await readJson(response)
  if (!response.ok) throw new Error(errorText(parsed) ?? '')
  return parsed
}

/** Candidates from `paper discover`: each item has an `identifier`, such as an arXiv id. */
export function discoverItems(body: unknown): { id: string, title: string }[] {
  const items = recordOf(body)?.items
  if (!Array.isArray(items)) return []
  const rows: { id: string, title: string }[] = []
  for (const item of items) {
    const record = recordOf(item)
    if (record === undefined || typeof record.identifier !== 'string') continue
    const id = record.identifier.trim()
    if (id === '') continue
    const title = typeof record.title === 'string' && record.title.trim() !== '' ? record.title : id
    rows.push({ id, title })
  }
  return rows
}

/** BibTeX from `paper export`, which keeps the document in `content`. */
export function bibText(body: unknown): string {
  const content = recordOf(body)?.content
  return typeof content === 'string' ? content : ''
}

/** Compose reading-state and text filters without classifying unknown states as unread. */
export function filterPapers(papers: PaperRow[], query: string, unreadOnly: boolean): PaperRow[] {
  const needle = query.trim().toLowerCase()
  return papers.filter(paper => (!unreadOnly || paper.isRead === false) && (
    needle === '' || paper.title.toLowerCase().includes(needle) || paper.authors.toLowerCase().includes(needle)
  ))
}

export async function setPaperRead(
  ref: string,
  read: boolean,
  revision: string,
  request: (url: string, init?: RequestInit) => Promise<Response>,
): Promise<void> {
  await postJson('/agentero/api/papers/read', { ref, read, revision }, request)
}
