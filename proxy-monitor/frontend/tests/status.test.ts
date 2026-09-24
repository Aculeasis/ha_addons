import assert from 'node:assert/strict';
import { test } from 'node:test';
import { proxyStatus } from '../src/format.ts';
import type { ProxyStatus } from '../src/types.ts';

test('cached results become stale without a new websocket message', () => {
  const proxy = { status: 'alive', fresh_until: 160 } as ProxyStatus;
  assert.equal(proxyStatus(proxy, 160), 'alive');
  assert.equal(proxyStatus(proxy, 161), 'stale');
});

test('missing data and disabled checks do not become failures', () => {
  assert.equal(proxyStatus({ status: 'unknown', fresh_until: null } as ProxyStatus, 1000), 'unknown');
  assert.equal(proxyStatus({ status: 'disabled', fresh_until: 100 } as ProxyStatus, 1000), 'disabled');
});
