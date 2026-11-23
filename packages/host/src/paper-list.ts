import type { ChildProcess } from 'node:child_process'
import { resolveCliBin } from './cli-install.js'
import type { CatalogSettings } from './catalog.js'
import { CLI_PAGE_LIMIT, collectPages, runCliJson, type CliCall, type CliFailure } from './cli-run.js'

/** Bound for one listing page or one `paper get`. */
const CALL_TIMEOUT_MS = 20_000

/** `paper get` processes that run at once. */
const DETAIL_CONCURRENCY = 8

/** Cached details, dropped together once this many revisions are held. */
const DETAIL_CACHE_LIMIT = 4096

export interface PaperTag {
  name: string
  /** Palette id from the tag vocabulary, when the tag has one. */
  color?: string
}

/** One catalog row as the panels and tools receive it. */
export interface PaperRow {
  id: string
  /** Vault-relative paper folder, such as `papers/1706.03762`. */
  path: string
  title: string
  authors: string[]
  /** Publication year, empty when the catalog has no date. */
  year: string
  tags: PaperTag[]
  state: 'read' | 'unread'
  /** Catalog revision; `paper update` requires it as `--if-revision`. */
  revision: string
}

export type PaperList =
  | { ok: true, rows: PaperRow[], truncated: boolean }
  | { ok: false, failure: CliFailure }

export interface PaperListOptions {
  /** Substring the CLI matches against titles, authors, identifiers, paths, and tags. */
  query?: string
  /** Stop after this many rows, newest first. */
  limit?: number
}

/** What `paper list` carries: identity, reading state, tag names, and a revision. */
interface Brief {
  id: string
  path: string
  title: string
  tagNames: string[]
  state: PaperRow['state']
  revision: string
}

/** Authors and year for one catalog revision. A paper keeps its revision until its record changes. */
interface Detail {
  authors: string[]
  year: string
}

const details = new Map<string, Detail>()

function recordOf(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined
}

function textOf(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function stringsOf(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && item.trim() !== '') : []
}

function briefOf(value: unknown): Brief | undefined {
  const record = recordOf(value)
  if (record === undefined) return undefined
  const path = textOf(record.path)
  const revision = textOf(record.revision)
  const state = record.state
  if (path === '' || revision === '' || (state !== 'read' && state !== 'unread')) return undefined
  return {
    id: textOf(record.id),
    path,
    title: textOf(record.title),
    tagNames: stringsOf(record.tags),
    state,
    revision,
  }
}

async function detailOf(call: CliCall, brief: Brief): Promise<Detail | undefined> {
  const cached = details.get(brief.revision)
  if (cached !== undefined) return cached
  const result = await call(['paper', 'get', brief.path], 'agentero paper get')
  // A row without details still lists; the next load retries it.
  if (!result.ok) return undefined
  const record = recordOf(result.data)
  const detail = {
    authors: record === undefined ? [] : stringsOf(record.authors),
    year: /^\d{4}/.exec(record === undefined ? '' : textOf(record.date))?.[0] ?? '',
  }
  if (details.size >= DETAIL_CACHE_LIMIT) details.clear()
  details.set(brief.revision, detail)
  return detail
}

/** Lowercase tag names to palette ids. Listings carry names only. */
async function tagColors(call: CliCall): Promise<Map<string, string>> {
  const colors = new Map<string, string>()
  const listed = await collectPages(
    call,
    ['paper', 'tag', 'list', '--limit', String(CLI_PAGE_LIMIT)],
    'agentero paper tag list',
  )
  // Colors are cosmetic; a failed lookup leaves the default chip styles.
  if (!listed.ok) return colors
  for (const value of listed.items) {
    const record = recordOf(value)
    const name = record === undefined ? '' : textOf(record.name)
    const color = record === undefined ? '' : textOf(record.color)
    if (name !== '' && color !== '') colors.set(name.toLowerCase(), color)
  }
  return colors
}

/** Run `task` over `items`, at most `limit` at a time, and keep the input order. */
async function mapConcurrent<T, R>(
  items: readonly T[],
  limit: number,
  task: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let next = 0
  const worker = async (): Promise<void> => {
    for (let index = next++; index < items.length; index = next++) {
      results[index] = await task(items[index])
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()))
  return results
}

function rowOf(brief: Brief, detail: Detail | undefined, colors: ReadonlyMap<string, string>): PaperRow {
  return {
    id: brief.id,
    path: brief.path,
    title: brief.title,
    authors: detail?.authors ?? [],
    year: detail?.year ?? '',
    tags: brief.tagNames.map((name) => {
      const color = colors.get(name.toLowerCase())
      return color === undefined ? { name } : { name, color }
    }),
    state: brief.state,
    revision: brief.revision,
  }
}

/**
 * List the catalog with the fields the panels show. `paper list` is paged and
 * carries no authors or date, so each row is completed by `paper get`; those
 * results are cached by revision and refetched only for rows that changed.
 */
export async function queryPapers(call: CliCall, options: PaperListOptions = {}): Promise<PaperList> {
  const args = ['paper', 'list', '--limit', String(CLI_PAGE_LIMIT)]
  const query = options.query?.trim() ?? ''
  if (query !== '') args.push('--query', query)
  const limit = options.limit ?? Number.POSITIVE_INFINITY
  const listed = await collectPages(call, args, 'agentero paper list', (count) => count >= limit)
  if (!listed.ok) return listed
  const briefs: Brief[] = []
  for (const value of listed.items) {
    const brief = briefOf(value)
    if (brief !== undefined) briefs.push(brief)
  }
  const selected = briefs.slice(0, limit)
  const [found, colors] = await Promise.all([
    mapConcurrent(selected, DETAIL_CONCURRENCY, (brief) => detailOf(call, brief)),
    tagColors(call),
  ])
  return {
    ok: true,
    rows: selected.map((brief, index) => rowOf(brief, found[index], colors)),
    truncated: listed.more || briefs.length > selected.length,
  }
}

/** List the catalog of the configured vault. */
export async function listPapers(
  settings: CatalogSettings,
  children: Set<ChildProcess>,
  options: PaperListOptions = {},
): Promise<PaperList> {
  const bin = await resolveCliBin(settings.agenteroBin)
  return queryPapers(
    (args, label) => runCliJson(bin, ['--vault', settings.vault, '--json', ...args], CALL_TIMEOUT_MS, children, label),
    options,
  )
}
