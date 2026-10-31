import test from 'node:test';
import assert from 'node:assert/strict';
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
