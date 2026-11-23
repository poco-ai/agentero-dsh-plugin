import type { ChildProcess } from 'node:child_process'
import { resolveCliBin } from './cli-install.js'
import { runCliJson, type CliCall, type CliJson } from './cli-run.js'

/** Network-backed CLI calls: import, download, BibTeX, arXiv discovery. */
const NETWORK_MS = 120_000

/** Local catalog edits. */
const LOCAL_MS = 20_000

export interface CatalogSettings {
  vault: string
  agenteroBin: string
}

export type CatalogResult =
  | { status: 200, raw: string }
  | { status: 502, error: string }

function sent(result: CliJson): CatalogResult {
  return result.ok ? { status: 200, raw: result.raw } : { status: 502, error: result.failure.message }
}

/** Run one `--json` command against the configured vault and keep its document as the response body. */
async function catalogJson(
  settings: CatalogSettings,
  args: readonly string[],
  timeoutMs: number,
  label: string,
  children: Set<ChildProcess>,
  stdin?: string,
): Promise<CatalogResult> {
  const bin = await resolveCliBin(settings.agenteroBin)
  return sent(await runCliJson(bin, [
    '--vault', settings.vault,
    '--json',
    ...args,
  ], timeoutMs, children, label, stdin))
}

/** `paper import id`. `text` is an arXiv id, DOI, or URL. */
export function importId(
  settings: CatalogSettings,
  text: string,
  children: Set<ChildProcess>,
): Promise<CatalogResult> {
  return catalogJson(settings, ['paper', 'import', 'id', '--', text], NETWORK_MS, 'agentero paper import id', children)
}

/** `paper import bib -`, with the bibliography document on stdin. */
export function importBib(
  settings: CatalogSettings,
  text: string,
  children: Set<ChildProcess>,
): Promise<CatalogResult> {
  return catalogJson(settings, ['paper', 'import', 'bib', '-'], NETWORK_MS, 'agentero paper import bib', children, text)
}

/** `paper export`. The document's `content` member is the BibTeX. */
export function exportBib(
  settings: CatalogSettings,
  children: Set<ChildProcess>,
): Promise<CatalogResult> {
  return catalogJson(
    settings,
    ['paper', 'export', '--format', 'bibtex', '--output', '-'],
    NETWORK_MS,
    'agentero paper export',
    children,
  )
}

/** Append or remove tags. The ref is a vault-relative paper path or id. */
export function changeTag(
  settings: CatalogSettings,
  ref: string,
  op: 'add' | 'rm',
  tag: string,
  children: Set<ChildProcess>,
): Promise<CatalogResult> {
  return catalogJson(
    settings,
    ['paper', 'tag', op === 'add' ? 'add' : 'remove', ref, '--', tag],
    LOCAL_MS,
    'agentero paper tag',
    children,
  )
}

/** Move a paper folder to the vault trash through `file remove`. The receipt carries a recovery id. */
export function deletePaper(
  settings: CatalogSettings,
  ref: string,
  children: Set<ChildProcess>,
): Promise<CatalogResult> {
  return catalogJson(settings, ['file', 'remove', '--', ref], LOCAL_MS, 'agentero file remove', children)
}

function revisionOf(data: unknown): string | undefined {
  const revision = data !== null && typeof data === 'object' ? (data as { revision?: unknown }).revision : undefined
  return typeof revision === 'string' && revision !== '' ? revision : undefined
}

/**
 * Set the reading state. `paper update` takes the revision the caller listed
 * the row at, so a row changed in between is refused rather than overwritten.
 * Reading state is one field, so one retry at the current revision is safe.
 */
export async function updateReadState(call: CliCall, ref: string, read: boolean, revision: string): Promise<CliJson> {
  const update = (token: string): Promise<CliJson> => call([
    'paper', 'update', ref,
    '--state', read ? 'read' : 'unread',
    '--if-revision', token,
  ], 'agentero paper update')
  const first = await update(revision)
  if (first.ok || first.failure.code !== 'revision_conflict') return first
  const current = await call(['paper', 'get', ref], 'agentero paper get')
  const token = current.ok ? revisionOf(current.data) : undefined
  return token === undefined ? first : update(token)
}

export async function setRead(
  settings: CatalogSettings,
  ref: string,
  read: boolean,
  revision: string,
  children: Set<ChildProcess>,
): Promise<CatalogResult> {
  const bin = await resolveCliBin(settings.agenteroBin)
  const call: CliCall = (args, label) => runCliJson(
    bin,
    ['--vault', settings.vault, '--json', ...args],
    LOCAL_MS,
    children,
    label,
  )
  return sent(await updateReadState(call, ref, read, revision))
}

/** Download the missing assets of a paper already in the catalog. */
export function downloadPaper(
  settings: CatalogSettings,
  ref: string,
  children: Set<ChildProcess>,
): Promise<CatalogResult> {
  return catalogJson(settings, ['paper', 'download', ref], NETWORK_MS, 'agentero paper download', children)
}

/** Rank a short arXiv list for one keyword. Already-imported ids are dropped by the CLI. */
export function discoverArxiv(
  settings: CatalogSettings,
  keyword: string,
  children: Set<ChildProcess>,
): Promise<CatalogResult> {
  return catalogJson(
    settings,
    ['paper', 'discover', '--keyword', keyword, '--limit', '8'],
    NETWORK_MS,
    'agentero paper discover',
    children,
  )
}
