import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import { HostConnectionService } from '@deepseek-ai/dsh-client-connection'
import * as plugin from '../lib/index.js'

const remote = 'research.example:2110'

test('Agentero routes use DSH request admission before accessing the vault or CLI', async (t) => {
  const ctx = new Context()
  t.after(() => ctx.fiber.dispose())
  let route
  ctx.provide('webServer', {
    host: '127.0.0.1',
    protocol: 'http:',
    register(value) { route = value; return () => {} },
  })
  new HostConnectionService(ctx, [remote], {
    isAuthenticated: (req) => req.headers.cookie === 'test-session',
    authenticateApi: () => undefined,
  })
  ctx.provide('agents', { get: () => undefined })
  ctx.provide('tools', { register: () => () => {} })
  ctx.provide('settings', { mutate: () => assert.fail('request must not change settings') })
  await ctx.plugin(plugin)
  assert.equal(route.path, '/agentero/api')
  assert.ok(plugin.inject.includes('connection'))

  async function request(headers, url = '/agentero/api/vault', method = 'GET') {
    const res = {
      statusCode: 200,
      headers: {},
      setHeader(key, value) { this.headers[key] = value },
      end(body) { this.body = body === undefined ? undefined : JSON.parse(body) },
    }
    await route.handler({ headers, url, method }, res)
    return res
  }

  for (const host of [remote, '127.0.0.1:3080', 'localhost:3080', '[::1]:3080']) {
    const headers = { host, cookie: 'test-session', origin: 'https://' + host, 'sec-fetch-site': 'same-origin' }
    const res = await request(headers)
    assert.equal(res.statusCode, 200, host)
    assert.equal(typeof res.body.scope, 'string')
    const stale = await request(headers, '/agentero/api/cli')
    assert.equal(stale.statusCode, 409, host)
    assert.equal(stale.body.error, 'vault changed')
  }

  for (const host of [remote, '127.0.0.1:3080']) {
    for (const [url, method] of [['/agentero/api/vault', 'GET'], ['/agentero/api/cli', 'GET'], ['/agentero/api/vault/create', 'POST']]) {
      const res = await request({ host }, url, method)
      assert.equal(res.statusCode, 401)
      assert.deepEqual(res.body, { error: 'unauthorized' })
    }
  }

  for (const headers of [
    { host: 'untrusted.example', cookie: 'test-session' },
    { host: remote + '0', cookie: 'test-session' },
    { host: remote, cookie: 'test-session', origin: 'https://untrusted.example' },
    { host: remote, cookie: 'test-session', 'sec-fetch-site': 'cross-site' },
  ]) {
    for (const [url, method] of [['/agentero/api/vault', 'GET'], ['/agentero/api/vault/create', 'POST']]) {
      const res = await request(headers, url, method)
      assert.equal(res.statusCode, 403)
      assert.deepEqual(res.body, { error: 'forbidden' })
    }
  }
})
