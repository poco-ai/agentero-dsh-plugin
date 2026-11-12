import assert from 'node:assert/strict'
import { test } from 'node:test'
import { isAllowedApiHost } from '../src/api-host.ts'

test('accepts loopback host headers', () => {
  for (const host of ['127.0.0.1', '127.0.0.1:3080', 'localhost', 'LocalHost:3080', '[::1]', '[::1]:3080']) {
    assert.equal(isAllowedApiHost(host, '127.0.0.1'), true, host)
  }
})

test('accepts the configured bind host', () => {
  assert.equal(isAllowedApiHost('192.168.1.20:3080', '192.168.1.20'), true)
  assert.equal(isAllowedApiHost('10.0.0.8', '10.0.0.8'), true)
  assert.equal(isAllowedApiHost('[fe80::1]:3080', 'fe80::1'), true)
})

test('rejects other hosts and wildcard binds', () => {
  assert.equal(isAllowedApiHost('192.168.1.21:3080', '192.168.1.20'), false)
  assert.equal(isAllowedApiHost('evil.example', '192.168.1.20'), false)
  assert.equal(isAllowedApiHost('192.168.1.20:3080', '0.0.0.0'), false)
  assert.equal(isAllowedApiHost('192.168.1.20', '::'), false)
  assert.equal(isAllowedApiHost('nas.local:3080', '192.168.1.20'), false)
  assert.equal(isAllowedApiHost(undefined, '192.168.1.20'), false)
})
