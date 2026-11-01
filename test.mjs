import test from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import { request, server, complaintRisk, normalizeUtmSource, signupUrl, upgradeUrl, rateLimitedError } from './index.mjs';
import { TOOLS } from './tools.mjs';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

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
test('screening posts a JSON body, not query params, and omits undefined fields', async () => {
  const data = await request('/v1/screening', { name: 'Acme Corp', country: undefined }, 'kf_test_fixture', async (url, options) => {
    assert.equal(options.method, 'POST');
    assert.equal(url.origin, 'https://knowfirm.com');
    assert.equal(url.pathname, '/v1/screening');
    assert.equal(url.searchParams.get('name'), null); // body, never a query param
    assert.equal(options.headers['content-type'], 'application/json');
    assert.equal(options.headers['x-api-key'], 'kf_test_fixture');
    assert.equal(options.redirect, 'error');
    assert.deepEqual(JSON.parse(options.body), { name: 'Acme Corp' });
    return { ok: true, json: async () => ({ query: 'Acme Corp', matches: [], disclaimer: 'informational only' }) };
  }, 'POST');
  assert.deepEqual(data.matches, []);
});
test('screening requires a key before any API request', async () => {
  await assert.rejects(request('/v1/screening', { name: 'A' }, '', () => { throw Error('network must not run'); }, 'POST'), /KNOWFIRM_API_KEY/);
});
test('server constructs', () => { assert(server('kf_test_fixture')); });

// --- FUN-02 funnel: keyless / 401 / 402 / 403 surface signup / upgrade UTM links (knowfirm.com #174) ---
test('utm_source is normalized and defaults to mcp', () => {
  assert.equal(normalizeUtmSource('Glama!!'), 'glama');
  assert.equal(normalizeUtmSource(''), 'mcp');
  assert.equal(normalizeUtmSource(undefined), 'mcp');
  assert.equal(signupUrl('glama'), 'https://knowfirm.com/signup?utm_source=glama');
  assert.equal(upgradeUrl(undefined), 'https://knowfirm.com/dashboard/billing?utm_source=mcp');
});
test('request sends the channel utm_source header for attribution', async () => {
  await request('/v1/business', { name: 'A' }, 'kf_test_fixture', async (url, options) => {
    assert.equal(options.headers['x-knowfirm-utm-source'], 'glama');
    return { ok: true, json: async () => ({}) };
  }, 'GET', 'Glama');
});
test('keyless error links to signup with the channel utm_source', async () => {
  await assert.rejects(
    request('/v1/business', { name: 'A' }, '', () => { throw Error('network must not run'); }, 'GET', 'glama'),
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

// Issue #170: initialize + tools/list must succeed with no key, and a keyless tools/call must
// return a clear auth error. Since #174/#198 the keyless/credit errors route through the FUN-02
// signup/upgrade UTM links (keylessError), so the auth error now names the signup URL, not /login.
test('initialize: the real server constructs with KNOWFIRM_API_KEY unset', () => {
  const original = process.env.KNOWFIRM_API_KEY;
  delete process.env.KNOWFIRM_API_KEY;
  try { assert(server(), 'server() should construct with no key / KNOWFIRM_API_KEY unset'); }
  finally { if (original === undefined) delete process.env.KNOWFIRM_API_KEY; else process.env.KNOWFIRM_API_KEY = original; }
});

test('tools/list: the real registered tools are exposed without an API key', () => {
  const original = process.env.KNOWFIRM_API_KEY;
  delete process.env.KNOWFIRM_API_KEY;
  try {
    const toolNames = Object.keys(server()._registeredTools);
    for (const name of ['business_lookup', 'business_search', 'business_screening', 'complaint_risk'])
      assert.ok(toolNames.includes(name), `expected ${name} in ${toolNames.join(', ')}`);
  } finally { if (original === undefined) delete process.env.KNOWFIRM_API_KEY; else process.env.KNOWFIRM_API_KEY = original; }
});

test('tools/call: a keyless tool call returns a clear auth error linking to signup', async () => {
  const original = process.env.KNOWFIRM_API_KEY;
  delete process.env.KNOWFIRM_API_KEY;
  try {
    const result = await server()._registeredTools.business_lookup.handler({ name: 'Acme Corp' });
    assert.equal(result.isError, true, 'a keyless tool call must return isError');
    assert.match(result.content[0].text, /KNOWFIRM_API_KEY/);
    assert.match(result.content[0].text, /https:\/\/knowfirm\.com\/signup\?utm_source=mcp/);
  } finally { if (original === undefined) delete process.env.KNOWFIRM_API_KEY; else process.env.KNOWFIRM_API_KEY = original; }
});
test('all tools are read-only with descriptions and examples', () => {
  assert.equal(TOOLS.length, 6);
  for (const tool of TOOLS) {
    assert.equal(tool.annotations.readOnlyHint, true);
    assert.equal(tool.annotations.destructiveHint, false);
    assert.ok(tool.description.length >= 120);
    assert.ok(tool.examples.length >= 1);
  }
});

// --- MCP-09 (#201): error-path contract — EVERY registered tool returns a structured, linked
// message for 401 / 402 / 429 / 5xx, with no stack or secret leakage. The loop is driven by the
// TOOLS registry, so a tool added to tools.mjs without honouring the funnel contract fails CI. ---

const CONTRACT_KEY = 'kf_test_fixture';
// None of these provider-side strings may ever reach the MCP client on an error path.
const SECRET_MARKERS = [CONTRACT_KEY, 'Traceback', 'secret.js', 'stack', 'password', 'hunter2', 'sk_live_'];

// Drive a tool's REAL registered handler end-to-end with a stubbed global fetch, so the assertion
// exercises exactly the path a marketplace client hits (handler -> request / complaintRisk ->
// error message) rather than a reimplementation. Returns the text the client would see.
async function toolErrorText(tool, status, { retryAfter } = {}) {
  const handler = server(CONTRACT_KEY)._registeredTools[tool.name].handler;
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: false,
    status,
    headers: { get: (name) => (String(name).toLowerCase() === 'retry-after' ? retryAfter ?? null : null) },
    // A hostile, noisy provider body: the contract is that NONE of this is echoed to the client.
    json: async () => ({ secret: CONTRACT_KEY, stack: 'Error\n  at leak (secret.js:1:1)', detail: 'password=hunter2' }),
    text: async () => JSON.stringify({ secret: CONTRACT_KEY, password: 'hunter2' }),
  });
  try {
    const result = await handler(tool.examples[0]);
    assert.equal(result.isError, true, `${tool.name}: ${status} must surface isError to the client`);
    return result.content[0].text;
  } finally {
    globalThis.fetch = realFetch;
  }
}

test('MCP-09 contract: rateLimitedError formats the Retry-After hint safely', () => {
  assert.match(rateLimitedError('30'), /429.*Retry after 30 seconds/s);
  assert.match(rateLimitedError(null), /429.*Retry after a short delay/s);
  assert.match(rateLimitedError('soon'), /429.*Retry after a short delay/s); // non-numeric header is not echoed
});

test('MCP-09 contract: every registered tool has an example input to exercise', () => {
  assert.ok(TOOLS.length >= 1, 'at least one registered tool');
  for (const tool of TOOLS)
    assert.ok(Array.isArray(tool.examples) && tool.examples.length >= 1, `${tool.name} needs an example input for the error-path contract`);
});

// Table-driven: adding a tool to TOOLS automatically enrolls it in the four error-path assertions.
for (const tool of TOOLS) {
  test(`MCP-09 ${tool.name}: keyless → signup link with utm_source`, async () => {
    const result = await server('')._registeredTools[tool.name].handler(tool.examples[0]);
    assert.equal(result.isError, true);
    assert.match(result.content[0].text, /KNOWFIRM_API_KEY/);
    assert.match(result.content[0].text, /\/signup\?utm_source=mcp/);
  });
  test(`MCP-09 ${tool.name}: 401 → signup link with utm_source=mcp`, async () => {
    const text = await toolErrorText(tool, 401);
    assert.match(text, /401/);
    assert.match(text, /\/signup\?utm_source=mcp/);
  });
  test(`MCP-09 ${tool.name}: 402 → upgrade link`, async () => {
    const text = await toolErrorText(tool, 402);
    assert.match(text, /402/);
    assert.match(text, /\/dashboard\/billing\?utm_source=/);
  });
  test(`MCP-09 ${tool.name}: 429 → retry-after text`, async () => {
    const withHeader = await toolErrorText(tool, 429, { retryAfter: '30' });
    assert.match(withHeader, /429/);
    assert.match(withHeader, /retry after 30 seconds/i);
    const noHeader = await toolErrorText(tool, 429);
    assert.match(noHeader, /429/);
    assert.match(noHeader, /retry/i);
  });
  test(`MCP-09 ${tool.name}: 5xx → generic error, no stack/secret leak`, async () => {
    const text = await toolErrorText(tool, 503);
    assert.match(text, /503/);
    for (const marker of SECRET_MARKERS) assert.ok(!text.includes(marker), `${tool.name}: 5xx response leaked "${marker}"`);
  });
}

// --- MCP-07 (#199): lookalike_businesses over GET /v1/business/similar (meter business_similar,
// 1 credit). 401/402/429/5xx are covered by the table-driven MCP-09 contract above. ---

async function withFetch(stub, fn) {
  const realFetch = globalThis.fetch;
  globalThis.fetch = stub;
  try { return await fn(); } finally { globalThis.fetch = realFetch; }
}

test('lookalike_businesses hits /v1/business/similar with the seed + limit and returns peers', async () => {
  let seen;
  const peers = { subject: { canonicalName: 'Acme' }, lookalikes: [{ name: 'Beta Logistics' }], emptyReason: null };
  const result = await withFetch(async (url, options) => {
    seen = { url, options };
    return { ok: true, json: async () => peers };
  }, () => server('kf_test_fixture')._registeredTools.lookalike_businesses.handler({ name: 'Acme', limit: 5 }));
  assert.equal(result.isError, undefined);
  assert.equal(seen.url.origin, 'https://knowfirm.com');
  assert.equal(seen.url.pathname, '/v1/business/similar');
  assert.equal(seen.url.searchParams.get('name'), 'Acme');
  assert.equal(seen.url.searchParams.get('limit'), '5');
  assert.equal(seen.url.searchParams.get('subjectKey'), null); // undefined fields are omitted
  assert.equal(seen.options.method, 'GET');
  assert.match(result.content[0].text, /Beta Logistics/);
});

test('lookalike_businesses returns an honest empty result, not an error', async () => {
  const empty = { subject: { canonicalName: 'Acme' }, lookalikes: [], emptyReason: 'no_matches' };
  const result = await withFetch(async () => ({ ok: true, json: async () => empty }),
    () => server('kf_test_fixture')._registeredTools.lookalike_businesses.handler({ subjectKey: 'fdic_institutions:3511' }));
  assert.equal(result.isError, undefined);
  const body = JSON.parse(result.content[0].text);
  assert.deepEqual(body.lookalikes, []);
  assert.equal(body.emptyReason, 'no_matches');
});

test('lookalike_businesses limit is bounded 1–25 (integer) by the input schema', () => {
  const schema = server('kf_test_fixture')._registeredTools.lookalike_businesses.inputSchema;
  for (const limit of [1, 10, 25]) assert.equal(schema.safeParse({ name: 'Acme', limit }).success, true, `limit ${limit}`);
  for (const limit of [0, 26, 2.5]) assert.equal(schema.safeParse({ name: 'Acme', limit }).success, false, `limit ${limit}`);
  assert.equal(TOOLS.find((t) => t.name === 'lookalike_businesses').annotations.readOnlyHint, true);
});

// --- knowfirm-mcp repo only: Smithery config, injected-fetcher client tests, npm metadata ---
test('smithery.yaml: stdio start command, keyless tool scan, secret key, no baked secret', () => {
  const yaml = readFileSync(new URL('./smithery.yaml', import.meta.url), 'utf8');
  assert.match(yaml, /type:\s*stdio/, 'startCommand must be type: stdio');
  assert.match(yaml, /required:\s*\[\s*\]/, 'configSchema required must be empty for keyless tools/list');
  assert.match(yaml, /knowfirmApiKey:/, 'configSchema must expose the KnowFirm API key field');
  assert.match(yaml, /format:\s*password/, 'the API key field must be marked secret (format: password)');
  assert.match(yaml, /commandFunction:/, 'must define a commandFunction');
  assert.match(yaml, /KNOWFIRM_API_KEY/, 'commandFunction must pass the key as KNOWFIRM_API_KEY');
  assert.match(yaml, /index\.mjs/, 'commandFunction must start node index.mjs');
  assert.ok(!/kf_live_/.test(yaml), 'smithery.yaml must not contain a live key');
});

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

test('server constructs keyless (tools/list handshake needs no API key)', () => {
  assert(server(undefined));
});

test('manifest.json (MCPB) lists exactly the registered tool set', () => {
  const manifest = JSON.parse(readFileSync(fileURLToPath(new URL('./manifest.json', import.meta.url)), 'utf8'));
  assert.deepEqual(manifest.tools.map((t) => t.name).sort(), TOOLS.map((t) => t.name).sort());
});
