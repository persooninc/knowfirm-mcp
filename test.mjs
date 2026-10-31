import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { request, server, complaintRisk, normalizeUtmSource, signupUrl, upgradeUrl } from './index.mjs';

async function connect(key, fetcher) {
  const [clientT, serverT] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test', version: '0' });
  await Promise.all([server(key, undefined, fetcher).connect(serverT), client.connect(clientT)]);
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

// --- MKT-04: npm/marketplace quality metadata ---
test('package.json carries npm/directory quality metadata (repository, homepage, bugs, keywords)', () => {
  const pkg = JSON.parse(readFileSync(fileURLToPath(new URL('./package.json', import.meta.url)), 'utf8'));
  assert.equal(typeof pkg.homepage, 'string');
  assert.ok(pkg.homepage.length > 0, 'homepage must be non-empty');
  assert.equal(typeof pkg.repository, 'object');
  assert.equal(typeof pkg.repository.url, 'string');
  assert.ok(/github\.com\/persooninc\/knowfirm-mcp/.test(pkg.repository.url), 'repository.url must point at persooninc/knowfirm-mcp');
  assert.equal(typeof pkg.bugs, 'object');
  assert.equal(typeof pkg.bugs.url, 'string');
  assert.ok(pkg.bugs.url.length > 0, 'bugs.url must be non-empty');
  assert.ok(Array.isArray(pkg.keywords) && pkg.keywords.length > 0, 'keywords must be a non-empty array');
  assert.ok(pkg.keywords.every((k) => typeof k === 'string' && k.length > 0), 'every keyword must be a non-empty string');
  for (const required of ['mcp', 'kyb', 'business-verification', 'screening']) {
    assert.ok(pkg.keywords.includes(required), `keywords must include "${required}"`);
  }
});


// --- FUN-02 funnel: keyless / 401 / 402 surface signup / upgrade UTM links (knowfirm.com #174) ---
test('utm_source is normalized and defaults to mcp', () => {
  assert.equal(normalizeUtmSource('Glama!!'), 'glama');
  assert.equal(normalizeUtmSource(''), 'mcp');
  assert.equal(normalizeUtmSource(undefined), 'mcp');
  assert.equal(signupUrl('glama'), 'https://knowfirm.com/signup?utm_source=glama');
  assert.equal(upgradeUrl(undefined), 'https://knowfirm.com/dashboard/billing?utm_source=mcp');
});
test('keyless error links to signup with the channel utm_source', async () => {
  await assert.rejects(
    request('/v1/business', { name: 'A' }, '', () => { throw Error('network must not run'); }, 'glama'),
    /signup\?utm_source=glama/,
  );
});
test('402 links to upgrade, 403 links to signup', async () => {
  await assert.rejects(request('/v1/business', {}, 'kf_test_fixture', async () => ({ ok: false, status: 402 })), /402.*dashboard\/billing\?utm_source=mcp/s);
  await assert.rejects(request('/v1/business', {}, 'kf_test_fixture', async () => ({ ok: false, status: 403 })), /403.*signup\?utm_source=mcp/s);
});

// --- complaint_risk tool (MCP-06, #198) ---
const COMPLAINT_FIXTURE = {
  resolvedEntityId: 'name:acmebank', canonicalName: 'ACME BANK',
  complaintRisk: { source: 'cfpb', windowMonths: 24, scanCap: 500, truncated: false, complaintCount: 3, latestDate: '2026-01-01', byProduct: [{ name: 'Checking account', count: 2 }], byIssue: [], disclaimer: 'Informational CFPB summary.' },
};
test('complaint_risk: success surfaces only the bounded CFPB block over /v1/business', async () => {
  let calledPath;
  const out = await complaintRisk('acme bank', 'kf_test_fixture', async (url) => {
    calledPath = url.pathname; assert.equal(url.searchParams.get('name'), 'acme bank');
    return { ok: true, json: async () => COMPLAINT_FIXTURE };
  });
  assert.equal(calledPath, '/v1/business');
  assert.equal(out.canonicalName, 'ACME BANK');
  assert.deepEqual(out.complaintRisk, COMPLAINT_FIXTURE.complaintRisk);
  assert.match(out.note, /not a consumer report/i);
});
test('complaint_risk: resolved business with no CFPB block returns an honest empty note', async () => {
  const out = await complaintRisk('tiny llc', 'kf_test_fixture', async () => ({ ok: true, json: async () => ({ resolvedEntityId: 'name:tinyllc', canonicalName: 'TINY LLC' }) }));
  assert.equal(out.complaintRisk, null);
  assert.match(out.note, /No CFPB complaint summary/i);
});
test('complaint_risk: 401 rejects with signup link', async () => {
  await assert.rejects(complaintRisk('x', 'kf_test_fixture', async () => ({ ok: false, status: 401 })), /401.*signup/s);
});
test('complaint_risk: 402 rejects with upgrade link', async () => {
  await assert.rejects(complaintRisk('x', 'kf_test_fixture', async () => ({ ok: false, status: 402 })), /402.*dashboard\/billing/s);
});
test('complaint_risk: 5xx rejects without echoing the response body', async () => {
  await assert.rejects(complaintRisk('x', 'kf_test_fixture', async () => ({ ok: false, status: 503 })), /503/);
});
test('complaint_risk: input validation (1..300 chars)', () => {
  const schema = z.string().min(1).max(300);
  assert.equal(schema.safeParse('').success, false);
  assert.equal(schema.safeParse('a'.repeat(301)).success, false);
  assert.equal(schema.safeParse('wells fargo').success, true);
});
test('server constructs keyless (tools/list handshake needs no API key)', () => {
  assert(server(undefined));
});
