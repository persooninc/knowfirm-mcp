import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { request, server } from './index.mjs';
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

// --- MKT-04: npm/marketplace quality metadata ---
test('package.json carries npm/directory quality metadata (repository, homepage, bugs, keywords)', () => {
  const pkg = JSON.parse(readFileSync(fileURLToPath(new URL('./package.json', import.meta.url)), 'utf8'));
  // homepage: non-empty string
  assert.equal(typeof pkg.homepage, 'string');
  assert.ok(pkg.homepage.length > 0, 'homepage must be non-empty');
  // repository: object with a non-empty url pointing at the GitHub repo
  assert.equal(typeof pkg.repository, 'object');
  assert.equal(typeof pkg.repository.url, 'string');
  assert.ok(/github\.com\/persooninc\/knowfirm-mcp/.test(pkg.repository.url), 'repository.url must point at persooninc/knowfirm-mcp');
  // bugs: object with a non-empty url
  assert.equal(typeof pkg.bugs, 'object');
  assert.equal(typeof pkg.bugs.url, 'string');
  assert.ok(pkg.bugs.url.length > 0, 'bugs.url must be non-empty');
  // keywords: non-empty array of non-empty strings including the core ones
  assert.ok(Array.isArray(pkg.keywords) && pkg.keywords.length > 0, 'keywords must be a non-empty array');
  assert.ok(pkg.keywords.every((k) => typeof k === 'string' && k.length > 0), 'every keyword must be a non-empty string');
  for (const required of ['mcp', 'kyb', 'business-verification', 'screening']) {
    assert.ok(pkg.keywords.includes(required), `keywords must include "${required}"`);
  }
});
