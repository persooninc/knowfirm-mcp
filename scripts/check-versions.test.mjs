import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, cpSync, rmSync, writeFileSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { collect } from './check-versions.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const TEXT_ARTIFACTS = ['package.json', 'manifest.json', 'server.json'];

// The gate: everything the marketplaces read must already agree in the repo.
test('committed artifacts are version-consistent', () => {
  const { ok, canonical, mismatches } = collect();
  assert.equal(
    ok,
    true,
    `out of sync with ${canonical}: ${mismatches.map((m) => `${m.source}=${m.version}`).join(', ')}`,
  );
});

test('every version-bearing source is enumerated', () => {
  const { items } = collect();
  const sources = items.map((i) => i.source);
  for (const expected of [
    'package.json version',
    'manifest.json version',
    'server.json version',
    'server.json npm package version',
    'server.json MCPB download URL version',
    'server.json MCPB filename version',
    'committed MCPB filename version',
    'committed MCPB embedded manifest version',
  ]) {
    assert.ok(sources.includes(expected), `missing version check for: ${expected}`);
  }
});

// Copy the real artifacts (and the committed bundle) into a scratch dir so a
// fixture can introduce drift without touching the repo.
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'kf-check-versions-'));
  for (const f of TEXT_ARTIFACTS) cpSync(join(ROOT, f), join(dir, f));
  const bundle = readdirSync(ROOT).find((f) => /^knowfirm-mcp-.*\.mcpb$/.test(f));
  if (bundle) cpSync(join(ROOT, bundle), join(dir, bundle));
  return dir;
}

test('a mismatch in manifest.json is detected', () => {
  const dir = fixture();
  try {
    const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'));
    manifest.version = '9.9.9';
    writeFileSync(join(dir, 'manifest.json'), JSON.stringify(manifest));
    const { ok, mismatches } = collect(dir);
    assert.equal(ok, false, 'drifted manifest.json version should fail the check');
    assert.ok(mismatches.some((m) => m.source === 'manifest.json version' && m.version === '9.9.9'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a mismatch in a nested server.json field is detected', () => {
  const dir = fixture();
  try {
    const server = JSON.parse(readFileSync(join(dir, 'server.json'), 'utf8'));
    // Drift only the npm package version, leaving the top-level version alone.
    server.packages.find((p) => p.registryType === 'npm').version = '0.2.0';
    writeFileSync(join(dir, 'server.json'), JSON.stringify(server, null, 2));
    const { ok, mismatches } = collect(dir);
    assert.equal(ok, false, 'drifted nested server.json version should fail the check');
    assert.ok(
      mismatches.some((m) => m.source === 'server.json npm package version' && m.version === '0.2.0'),
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a drifted MCPB download URL / filename in server.json is detected', () => {
  const dir = fixture();
  try {
    const raw = readFileSync(join(dir, 'server.json'), 'utf8')
      .replace('/releases/download/v0.1.0/', '/releases/download/v0.3.0/')
      .replace('knowfirm-mcp-0.1.0.mcpb', 'knowfirm-mcp-0.3.0.mcpb');
    writeFileSync(join(dir, 'server.json'), raw);
    const { ok, mismatches } = collect(dir);
    assert.equal(ok, false);
    assert.ok(mismatches.some((m) => m.source === 'server.json MCPB download URL version' && m.version === '0.3.0'));
    assert.ok(mismatches.some((m) => m.source === 'server.json MCPB filename version' && m.version === '0.3.0'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the whole package drifting together is still caught against canonical', () => {
  const dir = fixture();
  try {
    // Bump package.json (the canonical source) but nothing else, so every other
    // artifact now disagrees with it.
    const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
    pkg.version = '1.0.0';
    writeFileSync(join(dir, 'package.json'), JSON.stringify(pkg, null, 2));
    const { ok, canonical, mismatches } = collect(dir);
    assert.equal(ok, false);
    assert.equal(canonical, '1.0.0');
    // manifest, server.json (x4) and the two bundle facts all still read 0.1.0.
    assert.ok(mismatches.length >= 6, `expected many mismatches, got ${mismatches.length}`);
    assert.ok(mismatches.every((m) => m.version === '0.1.0'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
