import test from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { request, server } from './index.mjs';

// Wire an in-memory client to a server built with `key` and a stub `fetcher`,
// so tool calls exercise the real MCP schema/validation layer without network.
async function connect(key, fetcher) {
  const [clientT, serverT] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test', version: '0' });
  await Promise.all([server(key, fetcher).connect(serverT), client.connect(clientT)]);
  return client;
}
test('key required before any API request', async () => {
  await assert.rejects(request('/v1/business', { name: 'A' }, '', () => { throw Error('network must not run'); }), /KNOWFIRM_API_KEY/);
});
test('fixed origin, encoded params, key header and redirects denied', async () => {
  const data = await request('/v1/business', { name: 'A&B' }, 'kf_test_fixture', async (url, options) => {
    assert.equal(url.origin, 'https://knowfirm.com');assert.equal(url.searchParams.get('name'), 'A&B');
    assert.equal(options.headers['x-api-key'], 'kf_test_fixture');assert.equal(options.redirect, 'error');
    return { ok: true, json: async () => ({ name: 'A&B' }) };
  });assert.equal(data.name, 'A&B');
});
test('provider failures do not echo secrets or arbitrary response body', async () => {
  await assert.rejects(request('/v1/business', {}, 'kf_test_fixture', async () => ({ ok: false, status: 401 })), /401/);
});
test('server constructs', () => { assert(server('kf_test_fixture')); });

// --- lookalike_businesses (MCP-07) ---

test('lookalike hits /v1/business/similar with seed + limit, returns peers', async () => {
  const peers = { subject: { canonicalName: 'Acme' }, lookalikes: [{ name: 'Beta' }], emptyReason: null };
  const data = await request('/v1/business/similar', { name: 'Acme', limit: 5 }, 'kf_test_fixture', async (url) => {
    assert.equal(url.origin, 'https://knowfirm.com');
    assert.equal(url.pathname, '/v1/business/similar');
    assert.equal(url.searchParams.get('name'), 'Acme');
    assert.equal(url.searchParams.get('limit'), '5');
    return { ok: true, json: async () => peers };
  });
  assert.equal(data.lookalikes[0].name, 'Beta');
});

test('lookalike empty result is returned, not an error', async () => {
  const empty = { subject: { canonicalName: 'Acme' }, lookalikes: [], emptyReason: 'no_matches', message: 'No similar companies.' };
  const data = await request('/v1/business/similar', { name: 'Acme' }, 'kf_test_fixture', async () => ({ ok: true, json: async () => empty }));
  assert.deepEqual(data.lookalikes, []);
  assert.equal(data.emptyReason, 'no_matches');
});

for (const status of [401, 402, 500, 503]) {
  test(`lookalike surfaces provider ${status} without echoing the body`, async () => {
    await assert.rejects(
      request('/v1/business/similar', { name: 'Acme' }, 'kf_test_fixture', async () => ({ ok: false, status, json: async () => ({ secret: 'x' }) })),
      (err) => err.message.includes(String(status)) && !err.message.includes('secret'),
    );
  });
}

test('keyless tools/list still works and advertises lookalike_businesses as read-only', async () => {
  const client = await connect('', () => { throw new Error('tools/list must not touch the network'); });
  const { tools } = await client.listTools();
  const lookalike = tools.find((t) => t.name === 'lookalike_businesses');
  assert.ok(lookalike, 'lookalike_businesses is listed');
  assert.equal(lookalike.annotations?.readOnlyHint, true);
  await client.close();
});

test('lookalike tool call passes a valid seed through to the API', async () => {
  let seen;
  const client = await connect('kf_test_fixture', async (url) => {
    seen = url;
    return { ok: true, json: async () => ({ lookalikes: [{ name: 'Beta' }] }) };
  });
  const res = await client.callTool({ name: 'lookalike_businesses', arguments: { name: 'Acme', limit: 3 } });
  assert.equal(res.isError, undefined);
  assert.equal(seen.pathname, '/v1/business/similar');
  assert.equal(seen.searchParams.get('limit'), '3');
  assert.match(res.content[0].text, /Beta/);
  await client.close();
});

for (const limit of [0, 26, 2.5]) {
  test(`lookalike rejects out-of-bounds limit ${limit} before any API call`, async () => {
    const client = await connect('kf_test_fixture', () => { throw new Error('invalid limit must not reach the network'); });
    const res = await client.callTool({ name: 'lookalike_businesses', arguments: { name: 'Acme', limit } });
    assert.equal(res.isError, true);
    assert.match(res.content[0].text, /validation/i);
    await client.close();
  });
}
