/**
 * Install the headless Agentero CLI into the same managed location the
 * desktop app uses, so either surface can reuse the other's install.
 *
 * Mirrors the desktop Rust installer: download the latest GitHub Release
 * archive for this host triple, verify its SHA-256 sidecar, and unpack it
 * under `<data>/Agentero/cli/v-<version>/`. The archive carries the `agentero`
 * binary beside the PDFium library it loads, and both must stay together.
 * A user-bin shim points at the install; shell rc files are never edited.
 */
import { createHash } from 'node:crypto'
import { spawn } from 'node:child_process'
import { chmod, lstat, mkdir, mkdtemp, readFile, readdir, readlink, rename, rm, symlink, unlink, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import * as path from 'node:path'
import { unzipSync } from 'fflate'
import { x as extractTar } from 'tar'
import { compareVersions, isSupportedVersion, MIN_CLI_VERSION, normalizeVersion, versionsEqual } from './cli-version.js'
import { runAgentero } from './cli-run.js'
import { within } from './notes-files.js'

const RELEASE_REPO = 'poco-ai/Agentero'
const RELEASE_PAGE = `https://github.com/${RELEASE_REPO}/releases/latest`
const USER_AGENT = 'agentero-dsh-plugin'
const PROBE_TIMEOUT_MS = 5_000
const LATEST_TTL_MS = 10 * 60_000

let latest: { version: string, at: number } | undefined

export interface CliStatus {
  /** True when a runnable CLI answered `--version`. */
  available: boolean
  /** False when that CLI is older than the command catalog this plugin calls. */
  supported: boolean
  /** Version reported by the resolved CLI. */
  version: string | null
  /** Oldest CLI this plugin can drive. */
  minimumVersion: string
  /** Executable the Host runs when `available`. */
  bin: string | null
  /** Whether the executable came from the configured value or the managed download cache. */
  source: 'configured' | 'managed' | null
  /** The configured executable name or path. */
  configured: string
  /** Newest install under the managed root, shared with the desktop app. */
  managedPath: string | null
  managedInstalled: boolean
  shimPath: string
  shimInstalled: boolean
  /** Whether the shim directory is on this process's PATH. */
  shimOnPath: boolean
  /** Whether this host has a matching Release asset. */
  canInstall: boolean
  /** Rust-style host triple used for the Release asset, when supported. */
  platform: string | null
  releasePageUrl: string
}

/** Rust target triple for the running host; release assets use the same names. */
export function hostTriple(): string | null {
  const key = `${process.platform}-${process.arch}`
  switch (key) {
    case 'darwin-arm64': return 'aarch64-apple-darwin'
    case 'darwin-x64': return 'x86_64-apple-darwin'
    case 'linux-x64': return 'x86_64-unknown-linux-gnu'
    case 'linux-arm64': return 'aarch64-unknown-linux-gnu'
    case 'win32-x64': return 'x86_64-pc-windows-msvc'
    default: return null
  }
}

export function archiveFileName(version: string, triple: string): string {
  const ext = triple.includes('windows') ? 'zip' : 'tar.gz'
  return `agentero-cli-${normalizeVersion(version)}-${triple}.${ext}`
}

export function releaseDownloadUrl(version: string, triple: string): string {
  const ver = normalizeVersion(version)
  return `https://github.com/${RELEASE_REPO}/releases/download/v${ver}/${archiveFileName(ver, triple)}`
}

export function releaseSha256Url(version: string, triple: string): string {
  return `${releaseDownloadUrl(version, triple)}.sha256`
}

export function parseSha256File(text: string): string {
  const line = text.split(/\r?\n/).map(part => part.trim()).find(part => part !== '')
  if (line === undefined) throw new Error('CLI checksum file is empty')
  const hex = line.split(/\s+/)[0]?.toLowerCase() ?? ''
  if (!/^[0-9a-f]{64}$/.test(hex)) throw new Error(`invalid CLI checksum: ${hex}`)
  return hex
}

/** Last whitespace-separated token that starts with a digit (`agentero 0.18.1`). */
export function parseCliVersion(text: string): string | null {
  const line = text.split(/\r?\n/).map(part => part.trim()).find(part => part !== '')
  if (line === undefined) return null
  const tokens = line.split(/\s+/)
  for (let index = tokens.length - 1; index >= 0; index -= 1) {
    const token = tokens[index]
    if (token !== undefined && /^[0-9]/.test(token)) return token
  }
  return null
}

function dataLocalDir(): string {
  if (process.platform === 'darwin') return path.join(homedir(), 'Library', 'Application Support')
  if (process.platform === 'win32') return process.env.LOCALAPPDATA ?? path.join(homedir(), 'AppData', 'Local')
  return process.env.XDG_DATA_HOME ?? path.join(homedir(), '.local', 'share')
}

function innerBinaryName(): string {
  return process.platform === 'win32' ? 'agentero.exe' : 'agentero'
}

/** Shared library the CLI loads from its own directory. */
export function pdfiumLibraryName(): string {
  if (process.platform === 'win32') return 'pdfium.dll'
  if (process.platform === 'darwin') return 'libpdfium.dylib'
  return 'libpdfium.so'
}

export function managedCliDir(): string {
  return path.join(dataLocalDir(), 'Agentero', 'cli')
}

/** One directory per installed release, as the desktop app lays them out. */
export function managedVersionDir(version: string): string {
  return path.join(managedCliDir(), `v-${normalizeVersion(version)}`)
}

export function managedCliBinary(version: string): string {
  return path.join(managedVersionDir(version), innerBinaryName())
}

/** Where earlier plugin versions kept the one binary they downloaded, before the CLI moved to versioned directories. */
function legacyManagedBinary(): string {
  return path.join(managedCliDir(), innerBinaryName())
}

function preferredBinDir(): string {
  if (process.platform !== 'win32') return path.join(homedir(), '.local', 'bin')
  return path.join(process.env.LOCALAPPDATA ?? path.join(homedir(), 'AppData', 'Local'), 'Agentero', 'bin')
}

export function managedShimPath(): string {
  const name = process.platform === 'win32' ? 'agentero-cli.cmd' : 'agentero'
  return path.join(preferredBinDir(), name)
}

function isOnPath(dir: string): boolean {
  const target = path.resolve(dir)
  const entries = (process.env.PATH ?? '').split(path.delimiter)
  return entries.some((entry) => {
    if (entry === '') return false
    const value = path.resolve(entry)
    return process.platform === 'win32' ? value.toLowerCase() === target.toLowerCase() : value === target
  })
}

async function exists(file: string): Promise<boolean> {
  try {
    await lstat(file)
    return true
  } catch {
    return false
  }
}

async function probeVersion(bin: string): Promise<string | null> {
  const result = await runAgentero(bin, ['--version'], PROBE_TIMEOUT_MS, new Set())
  if (result.timedOut || result.spawnError !== undefined || result.code !== 0) return null
  return parseCliVersion(result.stdout) ?? parseCliVersion(result.stderr)
}

/** Installed versions under the managed root, newest first. */
async function managedVersions(): Promise<string[]> {
  let entries: string[]
  try {
    entries = await readdir(managedCliDir())
  } catch {
    return []
  }
  return entries
    .filter((name) => /^v-\d+\.\d+\.\d+$/.test(name))
    .map((name) => name.slice(2))
    .sort((left, right) => compareVersions(right, left))
}

/** Executable of the newest install whose file is present. Does not run it. */
async function newestManagedBinary(): Promise<string | null> {
  for (const version of await managedVersions()) {
    const binary = await installedBinary(version)
    if (binary !== null) return binary
  }
  return null
}

async function installedBinary(version: string): Promise<string | null> {
  const binary = managedCliBinary(version)
  return await exists(binary) ? binary : null
}

/**
 * Executable the Host runs for a configured value. Two configured paths can
 * dangle: one under the managed root, which a desktop upgrade replaces, and
 * the shim, which an uninstall removes. Either falls back to the newest
 * install, as does the flat binary earlier plugin versions downloaded.
 */
export async function resolveCliBin(configured: string): Promise<string> {
  const value = configured.trim() === '' ? 'agentero' : configured.trim()
  if (!within(managedCliDir(), value, false) && value !== managedShimPath()) return value
  if (value !== legacyManagedBinary() && await exists(value)) return value
  return await newestManagedBinary() ?? value
}

function errorText(error: unknown): string {
  return error instanceof Error && error.message !== '' ? error.message : String(error)
}

function releaseError(url: string): Error {
  return new Error(`CLI asset not found (404): ${url}. Check the published assets at ${RELEASE_PAGE}`)
}

let curlAvailable: Promise<boolean> | undefined

/** Node's fetch can stall on the GitHub release CDN; curl also honors system proxies. */
function hasCurl(): Promise<boolean> {
  curlAvailable ??= new Promise((resolve) => {
    const child = spawn('curl', ['--version'], { windowsHide: true, stdio: 'ignore' })
    child.on('error', () => resolve(false))
    child.on('close', code => resolve(code === 0))
  })
  return curlAvailable
}

function runCurl(args: readonly string[], label: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const child = spawn('curl', args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    const stdout: Buffer[] = []
    const stderr: Buffer[] = []
    child.stdout.on('data', (chunk: Buffer) => { stdout.push(chunk) })
    child.stderr.on('data', (chunk: Buffer) => { stderr.push(chunk) })
    child.on('error', (error) => { reject(new Error(`${label}: ${error.message}`)) })
    child.on('close', (code) => {
      if (code === 0) {
        resolve(Buffer.concat(stdout))
        return
      }
      const message = Buffer.concat(stderr).toString('utf8').trim()
      reject(new Error(`${label}: ${message === '' ? `curl exited with code ${code}` : message}`))
    })
  })
}

async function downloadBuffer(url: string, timeoutMs: number): Promise<Buffer> {
  if (await hasCurl()) {
    const seconds = String(Math.max(1, Math.ceil(timeoutMs / 1000)))
    try {
      return await runCurl(
        ['-fsSL', '--max-time', seconds, '--user-agent', USER_AGENT, url],
        `download failed (${url})`,
      )
    } catch (error) {
      if (errorText(error).includes('404')) throw releaseError(url)
      throw error
    }
  }
  let response: Response
  try {
    response = await fetch(url, {
      headers: { 'user-agent': USER_AGENT, accept: '*/*' },
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch (error) {
    throw new Error(`download failed (${url}): ${errorText(error)}`)
  }
  if (response.status === 404) throw releaseError(url)
  if (!response.ok) throw new Error(`download failed HTTP ${response.status}: ${url}`)
  return Buffer.from(await response.arrayBuffer())
}

/**
 * Resolve the latest tag from the public release redirect instead of the API:
 * unauthenticated GitHub API calls are rate-limited per IP, which made
 * one-click installs fail on shared networks.
 */
async function latestReleaseVersion(): Promise<string> {
  if (latest !== undefined && Date.now() - latest.at < LATEST_TTL_MS) return latest.version
  let location = ''
  try {
    const response = await fetch(RELEASE_PAGE, {
      redirect: 'manual',
      headers: { 'user-agent': USER_AGENT },
      signal: AbortSignal.timeout(20_000),
    })
    location = response.headers.get('location') ?? response.url
  } catch {
    // Fall through to curl; some networks stall Node's HTTP client.
  }
  const tagPattern = /\/releases\/tag\/v?([0-9][^/?#]*)/
  let match = tagPattern.exec(location)
  if (match?.[1] === undefined && await hasCurl()) {
    const devNull = process.platform === 'win32' ? 'NUL' : '/dev/null'
    try {
      const output = await runCurl(
        ['-fsSIL', '--max-time', '20', '--user-agent', USER_AGENT, '-o', devNull, '-w', '%{url_effective}', RELEASE_PAGE],
        'could not read the latest Agentero release',
      )
      match = tagPattern.exec(output.toString('utf8'))
    } catch {
      // Report the shared error below.
    }
  }
  const version = match?.[1] === undefined ? '' : normalizeVersion(match[1])
  if (version === '') {
    throw new Error(`could not read the latest Agentero release. Open ${RELEASE_PAGE} and install the CLI manually`)
  }
  latest = { version, at: Date.now() }
  return version
}

interface CliArchive {
  executable: Buffer
  library: Buffer
}

/** Read the executable and the library it needs by file name; neither is optional. */
async function archiveOf(pick: (member: string) => Promise<Buffer | undefined>): Promise<CliArchive> {
  const take = async (member: string): Promise<Buffer> => {
    const data = await pick(member)
    if (data === undefined || data.length === 0) throw new Error(`CLI archive is missing \`${member}\``)
    return data
  }
  return { executable: await take(innerBinaryName()), library: await take(pdfiumLibraryName()) }
}

function extractZip(bytes: Buffer): Promise<CliArchive> {
  const files = unzipSync(new Uint8Array(bytes))
  // A directory entry shares its name with the file it would hold; only files carry data.
  const members = new Map<string, Buffer>()
  for (const [name, data] of Object.entries(files)) {
    if (!name.endsWith('/')) members.set(path.posix.basename(name), Buffer.from(data))
  }
  return archiveOf((member) => Promise.resolve(members.get(member)))
}

async function extractTarGz(bytes: Buffer): Promise<CliArchive> {
  const dir = await mkdtemp(path.join(tmpdir(), 'agentero-cli-'))
  const archive = path.join(dir, 'cli.tar.gz')
  try {
    await writeFile(archive, bytes)
    const extracted = new Map<string, string>()
    await extractTar({
      file: archive,
      cwd: dir,
      strict: true,
      filter: (entry) => {
        const name = path.basename(entry)
        if (name !== innerBinaryName() && name !== pdfiumLibraryName()) return false
        const first = !extracted.has(name)
        if (first) extracted.set(name, entry)
        return first
      },
    })
    return await archiveOf((member) => {
      const entry = extracted.get(member)
      return entry === undefined ? Promise.resolve(undefined) : readFile(path.join(dir, entry))
    })
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

async function downloadCli(version: string, triple: string): Promise<CliArchive> {
  const [checksum, archive] = await Promise.all([
    downloadBuffer(releaseSha256Url(version, triple), 30_000),
    downloadBuffer(releaseDownloadUrl(version, triple), 180_000),
  ])
  const expected = parseSha256File(checksum.toString('utf8'))
  const actual = createHash('sha256').update(archive).digest('hex')
  if (actual !== expected) {
    throw new Error(`CLI archive checksum mismatch (expected ${expected}, got ${actual})`)
  }
  return archiveFileName(version, triple).endsWith('.zip') ? extractZip(archive) : extractTarGz(archive)
}

/**
 * Unpack one release under the managed root and return its executable.
 * The pair is staged beside its target and probed there, so a broken
 * download never replaces a working install and the swap is one rename.
 */
async function installVersion(version: string, triple: string): Promise<string> {
  const { executable, library } = await downloadCli(version, triple)
  const target = managedVersionDir(version)
  const binary = managedCliBinary(version)
  const staging = `${target}.${process.pid}.${Date.now()}.partial`
  const staged = path.join(staging, innerBinaryName())
  await mkdir(managedCliDir(), { recursive: true })
  try {
    await mkdir(staging)
    await writeFile(staged, executable, { mode: 0o755 })
    await writeFile(path.join(staging, pdfiumLibraryName()), library)
    if (process.platform !== 'win32') await chmod(staged, 0o755)
    const got = await probeVersion(staged)
    if (got === null) throw new Error('downloaded CLI does not run (`--version` failed)')
    if (!versionsEqual(got, version)) {
      throw new Error(`downloaded CLI version ${got} does not match release ${version}`)
    }
    await rm(target, { recursive: true, force: true })
    await rename(staging, target)
  } catch (error) {
    await rm(staging, { recursive: true, force: true })
    throw error
  }
  return binary
}

async function installShim(binary: string): Promise<void> {
  const shim = managedShimPath()
  await mkdir(path.dirname(shim), { recursive: true })
  if (process.platform === 'win32') {
    const existing = await readFile(shim, 'utf8').catch(() => undefined)
    if (existing !== undefined && !/agentero/i.test(existing)) {
      throw new Error(`refusing to overwrite ${shim}: not an Agentero-managed CLI entry`)
    }
    await writeFile(shim, `@echo off\r\n"${binary.replace(/"/g, '')}" %*\r\n`)
    return
  }
  if (await exists(shim)) {
    const info = await lstat(shim)
    if (!info.isSymbolicLink()) {
      throw new Error(`refusing to overwrite ${shim}: not an Agentero-managed CLI entry`)
    }
    const target = await readlink(shim)
    if (!/agentero/i.test(target)) {
      throw new Error(`refusing to overwrite ${shim}: not an Agentero-managed CLI entry`)
    }
    await unlink(shim)
  }
  await symlink(binary, shim)
}

export async function cliStatus(settings: { agenteroBin: string }): Promise<CliStatus> {
  const configured = settings.agenteroBin.trim() === '' ? 'agentero' : settings.agenteroBin.trim()
  const managedPath = await newestManagedBinary()
  const managedVersion = managedPath === null ? null : await probeVersion(managedPath)
  const bin = await resolveCliBin(configured)
  const version = bin === managedPath ? managedVersion : await probeVersion(bin)
  const resolved: { version: string, bin: string, source: 'configured' | 'managed' } | null =
    version !== null
      ? { version, bin, source: bin === configured ? 'configured' : 'managed' }
      : managedVersion !== null && managedPath !== null
        ? { version: managedVersion, bin: managedPath, source: 'managed' }
        : null
  const shimPath = managedShimPath()
  return {
    available: resolved !== null,
    supported: resolved !== null && isSupportedVersion(resolved.version),
    version: resolved?.version ?? null,
    minimumVersion: MIN_CLI_VERSION,
    bin: resolved?.bin ?? null,
    source: resolved?.source ?? null,
    configured,
    managedPath,
    managedInstalled: managedVersion !== null,
    shimPath,
    shimInstalled: await exists(shimPath),
    shimOnPath: isOnPath(path.dirname(shimPath)),
    canInstall: hostTriple() !== null,
    platform: hostTriple(),
    releasePageUrl: RELEASE_PAGE,
  }
}

/**
 * Download and install the latest CLI, then point the config at it when the
 * user still relies on a default. Returns the fresh status.
 */
export async function installManagedCli(
  settings: { agenteroBin: string },
  persistBin: (bin: string) => Promise<void>,
): Promise<CliStatus> {
  const triple = hostTriple()
  if (triple === null) {
    throw new Error(`Agentero CLI is not published for ${process.platform}/${process.arch}. Open ${RELEASE_PAGE}`)
  }
  const version = await latestReleaseVersion()
  const binary = await installedBinary(version) ?? await installVersion(version, triple)
  await installShim(binary)
  const configured = settings.agenteroBin.trim()
  if (configured === '' || configured === 'agentero' || configured === legacyManagedBinary()) {
    // The shim follows later upgrades. Windows runs a `.cmd` entry only through
    // a shell, which `runAgentero` keeps off, so it pins the executable instead.
    await persistBin(process.platform === 'win32' ? binary : managedShimPath()).catch(() => {
      // The config writer is best-effort here; cliStatus still finds the managed binary.
    })
  }
  return cliStatus(settings)
}
