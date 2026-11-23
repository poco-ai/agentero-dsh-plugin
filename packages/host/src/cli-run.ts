import { spawn, type ChildProcess } from 'node:child_process'
import { MIN_CLI_VERSION } from './cli-version.js'

export interface CliRunResult {
  code: number | null
  stdout: string
  stderr: string
  timedOut: boolean
  spawnError?: string
}

/**
 * Run `agentero` with an argument array. `shell` stays off.
 * The child is tracked so unload can kill it.
 */
export function runAgentero(
  bin: string,
  args: readonly string[],
  timeoutMs: number,
  children: Set<ChildProcess>,
  stdin?: string,
): Promise<CliRunResult> {
  return new Promise((resolve) => {
    let child: ChildProcess
    try {
      child = spawn(bin, args, {
        shell: false,
        windowsHide: true,
        stdio: [stdin === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'],
      })
    } catch (error) {
      resolve({
        code: null,
        stdout: '',
        stderr: '',
        timedOut: false,
        spawnError: error instanceof Error ? error.message : String(error),
      })
      return
    }
    children.add(child)
    if (stdin !== undefined) child.stdin?.end(stdin)
    const stdout: Buffer[] = []
    const stderr: Buffer[] = []
    let settled = false
    let timedOut = false
    let spawnError: string | undefined
    let timer: ReturnType<typeof setTimeout> | undefined
    const finish = (): void => {
      if (settled) return
      settled = true
      if (timer !== undefined) clearTimeout(timer)
      resolve({
        code: child.exitCode,
        stdout: Buffer.concat(stdout).toString('utf8'),
        stderr: Buffer.concat(stderr).toString('utf8'),
        timedOut,
        ...(spawnError !== undefined ? { spawnError } : {}),
      })
    }
    timer = setTimeout(() => {
      timedOut = true
      try {
        child.kill()
      } catch {
        // The child already exited.
      }
      finish()
    }, timeoutMs)
    child.stdout?.on('data', (chunk: Buffer) => { stdout.push(chunk) })
    child.stderr?.on('data', (chunk: Buffer) => { stderr.push(chunk) })
    child.on('error', (error: Error) => {
      spawnError = error.message
      finish()
    })
    child.on('close', () => {
      children.delete(child)
      finish()
    })
  })
}

/**
 * Why a call produced no document. `code` is the CLI's stable error code
 * (`revision_conflict`, `usage`, …) or a plugin-defined one: `timeout`,
 * `spawn`, `invalid_json`, `outdated`.
 */
export interface CliFailure {
  code: string | null
  message: string
}

/** The `error` member of a CLI error document: `{ error: { code, message, details, hint } }`. */
function errorDocument(text: string): CliFailure | undefined {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return undefined
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return undefined
  const error = (parsed as { error?: unknown }).error
  if (error === null || typeof error !== 'object' || Array.isArray(error)) return undefined
  const record = error as Record<string, unknown>
  const message = typeof record.message === 'string' ? record.message.trim() : ''
  if (message === '') return undefined
  const hint = typeof record.hint === 'string' ? record.hint.trim() : ''
  return {
    code: typeof record.code === 'string' && record.code !== '' ? record.code : null,
    message: hint === '' || message.includes(hint) ? message : `${message} ${hint}`,
  }
}

/** The document is one line; a shared library may have printed warnings above it. */
function stderrFailure(stderr: string): CliFailure | undefined {
  const whole = errorDocument(stderr)
  if (whole !== undefined) return whole
  const lines = stderr.split(/\r?\n/)
  return lines.length > 1 ? errorDocument(lines[lines.length - 1] ?? '') : undefined
}

/** clap prints usage errors as prose. The catalog CLI reports them as JSON, so prose means an older CLI. */
const OUTDATED_CLUE = /unrecognized subcommand|unexpected (?:argument|flag)|invalid value/i

function proseFailure(stderr: string): CliFailure {
  const line = stderr.split(/\r?\n/).map((part) => part.trim()).find((part) => part !== '') ?? ''
  if (OUTDATED_CLUE.test(line)) {
    return { code: 'outdated', message: `${line} (Agentero CLI ${MIN_CLI_VERSION} or newer is required)` }
  }
  return { code: null, message: stderr }
}

/**
 * Describe a failed call. Errors arrive on stderr in `--json` mode; the exit
 * status alone distinguishes nothing, so the document is read first.
 */
export function cliFailureOf(result: CliRunResult, label: string): CliFailure {
  if (result.timedOut) return { code: 'timeout', message: `${label} timed out` }
  if (result.spawnError !== undefined && result.spawnError !== '') {
    return { code: 'spawn', message: result.spawnError }
  }
  const stderr = result.stderr.trim()
  if (stderr !== '') return stderrFailure(stderr) ?? proseFailure(stderr)
  const stdout = result.stdout.trim()
  if (stdout !== '') return { code: null, message: stdout.slice(0, 500) }
  if (result.code === null) return { code: null, message: `${label} failed` }
  return { code: null, message: `agentero exited with code ${result.code}` }
}

/** A document the CLI printed, with its source text for pass-through responses. */
export type CliJson =
  | { ok: true, raw: string, data: unknown }
  | { ok: false, failure: CliFailure }

/** Run one `--json` command and parse the document on stdout. */
export async function runCliJson(
  bin: string,
  args: readonly string[],
  timeoutMs: number,
  children: Set<ChildProcess>,
  label: string,
  stdin?: string,
): Promise<CliJson> {
  const result = await runAgentero(bin, args, timeoutMs, children, stdin)
  if (result.timedOut || result.spawnError !== undefined || result.code !== 0) {
    return { ok: false, failure: cliFailureOf(result, label) }
  }
  try {
    return { ok: true, raw: result.stdout, data: JSON.parse(result.stdout) as unknown }
  } catch {
    return { ok: false, failure: { code: 'invalid_json', message: `${label} returned invalid JSON` } }
  }
}

/** Largest `--limit` every listing accepts. */
export const CLI_PAGE_LIMIT = 200

/** Pages one listing may span; a cursor that never advances cannot hang a request. */
const MAX_PAGES = 500

/** One page of a listing: its rows and the cursor of the next page, or null after the last. */
export interface CliPage {
  items: unknown[]
  next_cursor: string | null
}

export function cliPageOf(data: unknown): CliPage | undefined {
  if (data === null || typeof data !== 'object' || Array.isArray(data)) return undefined
  const record = data as { items?: unknown, next_cursor?: unknown }
  if (!Array.isArray(record.items)) return undefined
  return { items: record.items, next_cursor: typeof record.next_cursor === 'string' ? record.next_cursor : null }
}

/** Run one `--json` command; `label` names it in timeout and parse failures. */
export type CliCall = (args: readonly string[], label: string) => Promise<CliJson>

/**
 * Collect a paged listing through `call`. The first page is requested with
 * `args`; each later page repeats them with `--cursor`, and the loop ends at
 * the last page or as soon as `enough` rows are held.
 */
export async function collectPages(
  call: CliCall,
  args: readonly string[],
  label: string,
  enough: (count: number) => boolean = () => false,
): Promise<{ ok: true, items: unknown[], more: boolean } | { ok: false, failure: CliFailure }> {
  const items: unknown[] = []
  let cursor: string | null = null
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const result = await call(cursor === null ? args : [...args, '--cursor', cursor], label)
    if (!result.ok) return result
    const parsed = cliPageOf(result.data)
    if (parsed === undefined) {
      return { ok: false, failure: { code: 'invalid_json', message: `${label} returned an unexpected listing` } }
    }
    items.push(...parsed.items)
    cursor = parsed.next_cursor
    if (cursor === null) return { ok: true, items, more: false }
    if (enough(items.length)) return { ok: true, items, more: true }
  }
  return { ok: true, items, more: true }
}
