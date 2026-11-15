// Regression guard for Dependabot alerts #10-#14 (hono < 4.13.16).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const lock = JSON.parse(readFileSync(new URL('../package-lock.json', import.meta.url), 'utf8'));

export function cmp(a, b) {
  const pa = a.split('-')[0].split('.').map(Number);
  const pb = b.split('-')[0].split('.').map(Number);
  for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pa[i] - pb[i];
  return 0;
}

const MIN = { hono: '4.13.16' };

test('cmp orders semver triples', () => {
  assert.ok(cmp('4.13.15', '4.13.16') < 0);
  assert.ok(cmp('4.13.16', '4.13.16') === 0);
  assert.ok(cmp('4.14.0', '4.13.99') > 0);
});

test('every locked copy of a patched package meets its minimum safe version', () => {
  for (const [path, meta] of Object.entries(lock.packages)) {
    const name = path.split('node_modules/').pop();
    if (MIN[name]) assert.ok(cmp(meta.version, MIN[name]) >= 0, `${path}@${meta.version} < ${MIN[name]}`);
  }
});
