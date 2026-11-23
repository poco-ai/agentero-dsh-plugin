/**
 * Oldest Agentero CLI this plugin can drive. Release 0.18 replaced every
 * command with a generated catalog (`agentero-core/src/ops/cli.json`), moved
 * errors to stderr, and dropped the `{ ok, data }` envelope.
 */
export const MIN_CLI_VERSION = '0.18.0'

export function normalizeVersion(raw: string): string {
  return raw.trim().replace(/^v/, '')
}

/** Numeric core of a version, padded to three parts: `0.18` → `[0, 18, 0]`. */
function parts(raw: string): number[] {
  const core = normalizeVersion(raw).split(/[-+]/)[0] ?? ''
  const values = [0, 0, 0]
  core.split('.').slice(0, 3).forEach((part, index) => {
    const digits = /^\d+/.exec(part)?.[0]
    if (digits !== undefined) values[index] = Number(digits)
  })
  return values
}

/** Negative, zero, or positive when `left` is older than, the same as, or newer than `right`. */
export function compareVersions(left: string, right: string): number {
  const a = parts(left)
  const b = parts(right)
  for (let index = 0; index < 3; index += 1) {
    const difference = (a[index] ?? 0) - (b[index] ?? 0)
    if (difference !== 0) return difference
  }
  return 0
}

export function versionsEqual(a: string, b: string): boolean {
  return normalizeVersion(a) === normalizeVersion(b)
}

/** False for a CLI older than {@link MIN_CLI_VERSION}, which lacks the commands this plugin calls. */
export function isSupportedVersion(raw: string): boolean {
  return compareVersions(raw, MIN_CLI_VERSION) >= 0
}
