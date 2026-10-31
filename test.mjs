import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { request, server, complaintRisk, normalizeUtmSource, signupUrl, upgradeUrl } from './index.mjs';
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
