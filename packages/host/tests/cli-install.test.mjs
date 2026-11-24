import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  archiveFileName,
  downloadBuffer,
  hostTriple,
  parseCliVersion,
  parseSha256File,
  releaseDownloadUrl,
  releaseSha256Url,
} from '../lib/cli-install.js'

test('builds release asset names and URLs', () => {
  assert.equal(archiveFileName('v0.5.3', 'aarch64-apple-darwin'), 'agentero-cli-0.5.3-aarch64-apple-darwin.tar.gz')
  assert.equal(archiveFileName('0.5.3', 'x86_64-pc-windows-msvc'), 'agentero-cli-0.5.3-x86_64-pc-windows-msvc.zip')
  assert.equal(
    releaseDownloadUrl('v0.5.3', 'aarch64-apple-darwin'),
    'https://github.com/poco-ai/Agentero/releases/download/v0.5.3/agentero-cli-0.5.3-aarch64-apple-darwin.tar.gz',
  )
  assert.equal(
    releaseSha256Url('0.5.3', 'x86_64-pc-windows-msvc'),
    'https://github.com/poco-ai/Agentero/releases/download/v0.5.3/agentero-cli-0.5.3-x86_64-pc-windows-msvc.zip.sha256',
  )
})

test('parses sha256 sidecar files', () => {
  const hash = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'
  assert.equal(parseSha256File(`${hash}  agentero-cli-0.5.3.tar.gz\n`), hash)
  assert.throws(() => parseSha256File(''))
  assert.throws(() => parseSha256File('not-a-hash  file\n'))
})

test('parses the version from --version output', () => {
  assert.equal(parseCliVersion('agentero 0.15.0\n'), '0.15.0')
  assert.equal(parseCliVersion('agentero-cli 0.5.3'), '0.5.3')
  assert.equal(parseCliVersion(''), null)
})

test('maps the running host to a release triple', () => {
  const triple = hostTriple()
  assert.ok(triple === null || /-(apple-darwin|unknown-linux-gnu|pc-windows-msvc)$/.test(triple))
})

test('uses the curl result and never calls fetch when curl succeeds', async () => {
  const bytes = Buffer.from('from curl')
  let fetchCalls = 0
  const result = await downloadBuffer('https://example.test/asset', 1000, {
    curl: async () => bytes,
    fetch: async () => {
      fetchCalls += 1
      return Buffer.from('from fetch')
    },
  })
  assert.deepEqual(result, bytes)
  assert.equal(fetchCalls, 0)
})

test('falls back to fetch when curl fails with a transport error', async () => {
  const bytes = Buffer.from('from fetch')
  const result = await downloadBuffer('https://example.test/asset', 1000, {
    curl: async () => {
      throw new Error('curl: (35) schannel: failed to receive handshake, SSL/TLS connection failed')
    },
    fetch: async () => bytes,
  })
  assert.deepEqual(result, bytes)
})

test('does not retry a missing asset with fetch', async () => {
  await assert.rejects(
    downloadBuffer('https://example.test/asset', 1000, {
      curl: async () => {
        throw new Error('curl: (22) The requested URL returned error: 404')
      },
      fetch: async () => {
        throw new Error('fetch must not be called for a 404')
      },
    }),
    /CLI asset not found \(404\)/,
  )
})

test('reports both errors when every transport fails', async () => {
  await assert.rejects(
    downloadBuffer('https://example.test/asset', 1000, {
      curl: async () => {
        throw new Error('curl: (35) schannel: failed to receive handshake')
      },
      fetch: async () => {
        throw new Error('fetch: network unreachable')
      },
    }),
    /fetch: network unreachable \(curl also failed: curl: \(35\) schannel: failed to receive handshake\)/,
  )
})
