import assert from 'node:assert/strict'
import { test } from 'node:test'
import { updateReadState } from '../src/catalog.js'
import { compareVersions, isSupportedVersion, MIN_CLI_VERSION, versionsEqual } from '../src/cli-version.js'
import { cliFailureOf, cliPageOf, collectPages, type CliCall, type CliJson, type CliRunResult } from '../src/cli-run.js'
import { queryPapers } from '../src/paper-list.js'

/** A process that failed, with the given output. */
function failed(overrides: Partial<CliRunResult> = {}): CliRunResult {
  return { code: 1, stdout: '', stderr: '', timedOut: false, ...overrides }
}

/** A document the CLI printed on success. */
function document(data: unknown): CliJson {
  return { ok: true, raw: JSON.stringify(data), data }
}

/** An error document the CLI printed on stderr. */
function refused(code: string, message: string): CliJson {
  return { ok: false, failure: { code, message } }
}

/** One `paper list` row as the CLI prints it. */
function brief(id: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { id, path: `papers/${id}`, title: `Paper ${id}`, state: 'unread', tags: [], revision: `rev-${id}`, ...extra }
}

/** A CLI that answers the three commands `queryPapers` runs from a script. */
function catalog(script: {
  list?: unknown[]
  details?: Record<string, unknown>
  tags?: unknown[]
  tagListFails?: boolean
}): { call: CliCall, asked: string[][] } {
  const asked: string[][] = []
  const call: CliCall = async (args) => {
    asked.push([...args])
    const [group, action] = args
    if (group === 'paper' && action === 'list') return document({ items: script.list ?? [], next_cursor: null })
    if (group === 'paper' && action === 'get') {
      const detail = script.details?.[args[2] ?? '']
      return detail === undefined ? refused('paper_not_found', `No paper for ref '${args[2] ?? ''}'`) : document(detail)
    }
    if (group === 'paper' && action === 'tag') {
      return script.tagListFails === true ? refused('vault_not_found', 'unknown vault') : document({ items: script.tags ?? [], next_cursor: null })
    }
    return refused('usage', `unexpected ${args.join(' ')}`)
  }
  return { call, asked }
}

test('the version gate accepts the first catalog CLI and orders releases numerically', () => {
  assert.equal(MIN_CLI_VERSION, '0.18.0')
  assert.equal(isSupportedVersion('0.17.0'), false)
  assert.equal(isSupportedVersion('v0.18.0'), true)
  assert.equal(isSupportedVersion('0.18.1-beta.1'), true)
  assert.ok(compareVersions('0.18.10', '0.18.9') > 0)
  assert.ok(compareVersions('0.9.0', '0.18.0') < 0)
  assert.equal(compareVersions('1.0', '1.0.0'), 0)
  assert.equal(versionsEqual('v0.18.1', '0.18.1'), true)
})

test('an error document yields its code and message, with the hint appended', () => {
  const failure = cliFailureOf(failed({
    code: 4,
    stderr: '{"error":{"code":"revision_conflict","message":"The resource has changed; current revision: r2","details":{"expected":"r1","actual":"r2"},"hint":"Read the current revision before retrying."}}',
  }), 'agentero paper update')
  assert.equal(failure.code, 'revision_conflict')
  assert.equal(failure.message, 'The resource has changed; current revision: r2 Read the current revision before retrying.')
})

test('warnings printed above the error document do not hide it', () => {
  const failure = cliFailureOf(failed({
    stderr: 'dbus[12]: Failed to connect to the bus\n{"error":{"code":"vault_not_found","message":"unknown vault lab","hint":"Run agentero vault list or specify --vault."}}',
  }), 'agentero paper list')
  assert.equal(failure.code, 'vault_not_found')
  assert.equal(failure.message, 'unknown vault lab Run agentero vault list or specify --vault.')
})

test('a hint the message already contains is not repeated', () => {
  const failure = cliFailureOf(failed({
    stderr: '{"error":{"code":"usage","message":"Run agentero vault list or specify --vault.","hint":"Run agentero vault list or specify --vault."}}',
  }), 'agentero paper list')
  assert.equal(failure.message, 'Run agentero vault list or specify --vault.')
})

test('clap prose means the CLI predates a command and names the required version', () => {
  for (const stderr of [
    "error: unrecognized subcommand 'annotation'\n\nUsage: agentero [OPTIONS] <COMMAND>\n\nFor more information, try '--help'.\n",
    "error: unexpected argument '--if-revision' found\n",
  ]) {
    const failure = cliFailureOf(failed({ code: 2, stderr }), 'agentero annotation add')
    assert.equal(failure.code, 'outdated')
    assert.match(failure.message, /Agentero CLI 0\.18\.0 or newer is required/)
    assert.ok(failure.message.startsWith(stderr.split('\n')[0] ?? ''))
  }
})

test('other stderr text is passed through as the message', () => {
  const failure = cliFailureOf(failed({ stderr: 'warning: the catalog is busy\n' }), 'agentero paper list')
  assert.equal(failure.code, null)
  assert.equal(failure.message, 'warning: the catalog is busy')
})

test('timeouts, spawn failures, and bare exit codes are reported', () => {
  assert.deepEqual(cliFailureOf(failed({ code: null, timedOut: true }), 'agentero paper list'), {
    code: 'timeout', message: 'agentero paper list timed out',
  })
  assert.deepEqual(cliFailureOf(failed({ code: null, spawnError: 'spawn agentero ENOENT' }), 'agentero paper list'), {
    code: 'spawn', message: 'spawn agentero ENOENT',
  })
  assert.equal(cliFailureOf(failed({ code: 3 }), 'agentero paper list').message, 'agentero exited with code 3')
  assert.equal(cliFailureOf(failed({ code: null }), 'agentero paper list').message, 'agentero paper list failed')
})

test('a listing is followed through every cursor and the rows keep their order', async () => {
  const pages = [
    { items: ['a', 'b'], next_cursor: 'sig.2' },
    { items: ['c'], next_cursor: 'sig.3' },
    { items: ['d'], next_cursor: null },
  ]
  const asked: string[][] = []
  const call: CliCall = async (args) => {
    asked.push([...args])
    return document(pages[asked.length - 1])
  }
  const result = await collectPages(call, ['paper', 'list'], 'agentero paper list')
  assert.deepEqual(result, { ok: true, items: ['a', 'b', 'c', 'd'], more: false })
  assert.deepEqual(asked, [
    ['paper', 'list'],
    ['paper', 'list', '--cursor', 'sig.2'],
    ['paper', 'list', '--cursor', 'sig.3'],
  ])
})

test('the loop stops once enough rows are held and reports that more remain', async () => {
  let calls = 0
  const call: CliCall = async () => {
    calls += 1
    return document({ items: ['a', 'b'], next_cursor: `sig.${calls}` })
  }
  const result = await collectPages(call, ['paper', 'list'], 'agentero paper list', (count) => count >= 3)
  assert.deepEqual(result, { ok: true, items: ['a', 'b', 'a', 'b'], more: true })
  assert.equal(calls, 2)
})

test('a failure on a later page discards the partial listing', async () => {
  let calls = 0
  const call: CliCall = async () => {
    calls += 1
    return calls === 1 ? document({ items: ['a'], next_cursor: 'sig.1' }) : refused('stale_cursor', 'The result set or query changed. Start a fresh query.')
  }
  const result = await collectPages(call, ['paper', 'list'], 'agentero paper list')
  assert.equal(result.ok, false)
  assert.equal(!result.ok && result.failure.message, 'The result set or query changed. Start a fresh query.')
})

test('a cursor that never advances cannot loop forever', async () => {
  let calls = 0
  const call: CliCall = async () => {
    calls += 1
    return document({ items: ['a'], next_cursor: 'sig.0' })
  }
  const result = await collectPages(call, ['paper', 'list'], 'agentero paper list')
  assert.equal(result.ok && result.more, true)
  assert.equal(result.ok && result.items.length, calls)
})

test('a document without items is not a listing', async () => {
  const result = await collectPages(async () => document({ papers: [] }), ['paper', 'list'], 'agentero paper list')
  assert.deepEqual(result, { ok: false, failure: { code: 'invalid_json', message: 'agentero paper list returned an unexpected listing' } })
  assert.deepEqual(cliPageOf({ items: [1], next_cursor: 7 }), { items: [1], next_cursor: null })
  assert.equal(cliPageOf([1, 2]), undefined)
})

test('rows take authors and year from paper get and colors from the tag list', async () => {
  const { call, asked } = catalog({
    list: [
      brief('a', { tags: ['Survey', 'plain'] }),
      brief('b', { state: 'read', tags: 7 }),
      { id: 'c', path: 'papers/c', title: 'Paper c', state: 'unread', tags: [] },
      { id: 'd', state: 'read', revision: 'rev-d' },
    ],
    details: {
      'papers/a': { authors: ['Ada Lovelace', 'Alan Turing', 42, ' '], date: '2026-03-04T04:18:39Z' },
      'papers/b': { authors: [], date: null },
    },
    tags: [{ name: 'survey', color: 'teal', count: 1 }, { name: 'uncolored', color: null, count: 1 }],
  })
  const listed = await queryPapers(call)
  assert.ok(listed.ok)
  assert.equal(listed.truncated, false)
  assert.deepEqual(listed.rows, [
    {
      id: 'a', path: 'papers/a', title: 'Paper a', authors: ['Ada Lovelace', 'Alan Turing'], year: '2026',
      tags: [{ name: 'Survey', color: 'teal' }, { name: 'plain' }], state: 'unread', revision: 'rev-a',
    },
    { id: 'b', path: 'papers/b', title: 'Paper b', authors: [], year: '', tags: [], state: 'read', revision: 'rev-b' },
  ])
  // One `paper get` per listed row, beside the listing and the tag list.
  assert.deepEqual(asked.map((args) => args.slice(0, 3)), [
    ['paper', 'list', '--limit'],
    ['paper', 'get', 'papers/a'],
    ['paper', 'get', 'papers/b'],
    ['paper', 'tag', 'list'],
  ])
})

test('details are fetched once per revision', async () => {
  const { call, asked } = catalog({
    list: [brief('x', { revision: 'rev-cached' })],
    details: { 'papers/x': { authors: ['Grace Hopper'], date: '2020-05' } },
  })
  const first = await queryPapers(call)
  const second = await queryPapers(call)
  assert.deepEqual(first, second)
  assert.equal(asked.filter((args) => args[1] === 'get').length, 1)
})

test('a row whose paper get fails still lists, without authors', async () => {
  const { call } = catalog({ list: [brief('f', { revision: 'rev-unreadable' })] })
  const listed = await queryPapers(call)
  assert.ok(listed.ok)
  assert.equal(listed.rows.length, 1)
  assert.equal(listed.rows[0]?.title, 'Paper f')
  assert.deepEqual(listed.rows[0]?.authors, [])
  assert.equal(listed.rows[0]?.year, '')
})

test('a query is forwarded and a limit stops after the selected rows', async () => {
  const { call, asked } = catalog({
    list: [brief('q1'), brief('q2'), brief('q3')],
    details: { 'papers/q1': { authors: [], date: '2024' }, 'papers/q2': { authors: [], date: '2024' } },
  })
  const listed = await queryPapers(call, { query: '  atlas ', limit: 2 })
  assert.ok(listed.ok)
  assert.deepEqual(asked[0], ['paper', 'list', '--limit', '200', '--query', 'atlas'])
  assert.deepEqual(listed.rows.map((row) => row.id), ['q1', 'q2'])
  assert.equal(listed.truncated, true)
  assert.deepEqual(asked.filter((args) => args[1] === 'get').map((args) => args[2]), ['papers/q1', 'papers/q2'])
})

test('a failed listing is returned as it was', async () => {
  const call: CliCall = async () => refused('vault_not_found', 'unknown vault lab')
  const listed = await queryPapers(call)
  assert.equal(listed.ok, false)
  assert.deepEqual(!listed.ok && listed.failure, { code: 'vault_not_found', message: 'unknown vault lab' })
})

test('a failed tag list only drops the colors', async () => {
  const { call } = catalog({ list: [brief('t', { tags: ['survey'], revision: 'rev-uncolored' })], tags: [], tagListFails: true })
  const listed = await queryPapers(call)
  assert.ok(listed.ok)
  assert.deepEqual(listed.rows[0]?.tags, [{ name: 'survey' }])
})

test('the reading state changes at the listed revision', async () => {
  const asked: string[][] = []
  const call: CliCall = async (args) => {
    asked.push([...args])
    return document({ id: 'a', state: args.includes('unread') ? 'unread' : 'read' })
  }
  const result = await updateReadState(call, 'papers/a', false, 'rev-1')
  assert.deepEqual(asked, [['paper', 'update', 'papers/a', '--state', 'unread', '--if-revision', 'rev-1']])
  assert.equal(result.ok, true)
})

test('a stale revision is re-read and the update retried once', async () => {
  const asked: string[][] = []
  const call: CliCall = async (args) => {
    asked.push([...args])
    if (args[1] === 'get') return document({ id: 'a', revision: 'rev-2' })
    return args.at(-1) === 'rev-2'
      ? document({ id: 'a', state: 'read' })
      : refused('revision_conflict', 'The resource has changed; current revision: rev-2')
  }
  const result = await updateReadState(call, 'papers/a', true, 'rev-1')
  assert.deepEqual(asked, [
    ['paper', 'update', 'papers/a', '--state', 'read', '--if-revision', 'rev-1'],
    ['paper', 'get', 'papers/a'],
    ['paper', 'update', 'papers/a', '--state', 'read', '--if-revision', 'rev-2'],
  ])
  assert.equal(result.ok, true)
})

test('other refusals are not retried', async () => {
  let updates = 0
  const call: CliCall = async () => {
    updates += 1
    return refused('paper_not_found', "No paper for ref 'papers/a'")
  }
  const result = await updateReadState(call, 'papers/a', true, 'rev-1')
  assert.equal(result.ok, false)
  assert.equal(updates, 1)
})

test('an unreadable current revision keeps the first refusal', async () => {
  const call: CliCall = async (args) => args[1] === 'get'
    ? refused('paper_not_found', "No paper for ref 'papers/a'")
    : refused('revision_conflict', 'The resource has changed; current revision: rev-2')
  const result = await updateReadState(call, 'papers/a', true, 'rev-1')
  assert.deepEqual(result, { ok: false, failure: { code: 'revision_conflict', message: 'The resource has changed; current revision: rev-2' } })
})
