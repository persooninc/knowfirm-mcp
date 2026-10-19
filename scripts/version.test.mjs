import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, cpSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { collect, sync, canonicalVersion, bundleFacts } from './version.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ARTIFACTS = ['package.json', 'manifest.json', 'server.json', 'index.mjs'];

// The gate: everything the marketplaces read must already agree in the repo.
test('committed artifacts are version-consistent', () => {
  const { ok, canonical, mismatches } = collect();
  assert.equal(ok, true, `out of sync with ${canonical}: ${mismatches.map((m) => `${m.source}=${m.version}`).join(', ')}`);
});

test('every version-bearing source is enumerated', () => {
  const { items } = collect();
  const sources = items.map((i) => i.source);
  for (const expected of [
    'package.json version', 'manifest.json version', 'server.json version',
    'server.json npm package version', 'server.json MCPB download URL',
    'server.json MCPB filename', 'index.mjs server version',
    'MCPB filename version', 'MCPB manifest version',
  ]) {
    assert.ok(sources.includes(expected), `missing consistency check for: ${expected}`);
  }
});

test('server.json fileSha256 matches the committed bundle bytes', () => {
  const bundle = bundleFacts();
  assert.equal(bundle.count, 1, 'expected exactly one knowfirm-mcp-*.mcpb');
  const pinned = readFileSync(join(ROOT, 'server.json'), 'utf8').match(/"fileSha256":\s*"([0-9a-f]{64})"/)?.[1];
  assert.equal(pinned, bundle.sha256);
});

// Fixture helper: copy the text artifacts (and the bundle) into a scratch dir.
function fixture({ withBundle = true } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'kf-version-'));
  for (const f of ARTIFACTS) cpSync(join(ROOT, f), join(dir, f));
  if (withBundle) {
    const b = bundleFacts();
    cpSync(join(ROOT, b.name), join(dir, b.name));
  }
  return dir;
}

test('sync() repairs drift back to the canonical version', () => {
  const dir = fixture();
  try {
    // Introduce drift in every text artifact.
    const manifest = readFileSync(join(dir, 'manifest.json'), 'utf8').replace(/"version":"[^"]+"/, '"version":"9.9.9"');
    writeFileSync(join(dir, 'manifest.json'), manifest);
    const server = readFileSync(join(dir, 'server.json'), 'utf8')
      .replace(/("version":\s*")[^"]+(")/, '$17.7.7$2');
    writeFileSync(join(dir, 'server.json'), server);
    assert.equal(collect(dir).ok, false, 'drift should be detected');

    const { changed } = sync(canonicalVersion(dir), dir);
    assert.ok(changed.includes('manifest.json version'));
    assert.ok(changed.includes('server.json version'));
    assert.equal(collect(dir).ok, true, 'sync should restore consistency');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('bumping package.json then sync propagates the new version to text artifacts', () => {
  const dir = fixture();
  try {
    const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
    pkg.version = '0.2.0';
    writeFileSync(join(dir, 'package.json'), JSON.stringify(pkg, null, 2));

    sync('0.2.0', dir);
    const items = collect(dir).items;
    const by = Object.fromEntries(items.map((i) => [i.source, i.version]));
    assert.equal(by['server.json version'], '0.2.0');
    assert.equal(by['server.json npm package version'], '0.2.0');
    assert.equal(by['server.json MCPB download URL'], '0.2.0');
    assert.equal(by['server.json MCPB filename'], '0.2.0');
    assert.equal(by['index.mjs server version'], '0.2.0');
    // The committed binary bundle is NOT rebuilt by the script, so it stays at
    // the old version — the gate must flag it until the bundle is repacked.
    assert.equal(collect(dir).ok, false, 'stale bundle must keep the release red until repacked');
    assert.equal(by['MCPB filename version'], '0.1.0');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
