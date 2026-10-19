import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
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

test('smithery.yaml: stdio start command, keyless tool scan, secret key, no baked secret', () => {
  const yaml = readFileSync(new URL('./smithery.yaml', import.meta.url), 'utf8');
  assert.match(yaml, /type:\s*stdio/, 'startCommand must be type: stdio');
  // Keyless tools/list: the API key must NOT be in `required` so Smithery can scan tools without a key.
  assert.match(yaml, /required:\s*\[\s*\]/, 'configSchema required must be empty for keyless tools/list');
  assert.match(yaml, /knowfirmApiKey:/, 'configSchema must expose the KnowFirm API key field');
  assert.match(yaml, /format:\s*password/, 'the API key field must be marked secret (format: password)');
  // commandFunction must launch the stdio server and map the config into KNOWFIRM_API_KEY.
  assert.match(yaml, /commandFunction:/, 'must define a commandFunction');
  assert.match(yaml, /KNOWFIRM_API_KEY/, 'commandFunction must pass the key as KNOWFIRM_API_KEY');
  assert.match(yaml, /index\.mjs/, 'commandFunction must start node index.mjs');
  // Never ship a real key: only a kf_test_ placeholder, never a live secret.
  assert.ok(!/kf_live_/.test(yaml), 'smithery.yaml must not contain a live key');
});
