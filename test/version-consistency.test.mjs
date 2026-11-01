import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, cpSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ROOT,
  readVersions,
  checkConsistency,
  applyVersion,
} from '../scripts/release-sync.mjs';

const REPO = dirname(fileURLToPath(import.meta.url)).replace(/\/test$/, '');

const readJson = (dir, f) => JSON.parse(readFileSync(join(dir, f), 'utf8'));
const writeJson = (dir, f, o) => writeFileSync(join(dir, f), JSON.stringify(o, null, 2) + '\n');

// The committed repo must ship a consistent version across every artifact.
test('committed repo: every artifact agrees on the version', () => {
  const result = checkConsistency(ROOT);
  assert.equal(result.ok, true, `version drift:\n${result.problems.join('\n')}`);
});

test('committed repo: server.json MCPB URL carries the source version twice', () => {
  const v = readVersions(ROOT);
  assert.equal(v.serverMcpbTag, v.source);
  assert.equal(v.serverMcpbFile, v.source);
});

// Build a throwaway copy of the JSON artifacts plus a tiny stand-in MCPB so we
// can exercise the writer and checker without touching the real 3 MB bundle.
function fixtureRoot(version = '2.0.0') {
  const dir = mkdtempSync(join(tmpdir(), 'kf-release-'));
  for (const f of ['package.json', 'manifest.json', 'server.json', 'package-lock.json']) {
    cpSync(join(REPO, f), join(dir, f));
  }
  applyVersion(dir, version);
  const bytes = `fake-mcpb-${version}`;
  writeFileSync(join(dir, `knowfirm-mcp-${version}.mcpb`), bytes);
  const server = readJson(dir, 'server.json');
  server.packages.find((p) => p.registryType === 'mcpb').fileSha256 = createHash('sha256')
    .update(bytes)
    .digest('hex');
  writeJson(dir, 'server.json', server);
  return dir;
}

test('applyVersion propagates a new version into every JSON artifact', () => {
  const dir = fixtureRoot('9.9.9');
  try {
    const v = readVersions(dir);
    assert.equal(v.pkg, '9.9.9');
    assert.equal(v.manifest, '9.9.9');
    assert.equal(v.server, '9.9.9');
    assert.equal(v.serverNpm, '9.9.9');
    assert.equal(v.serverMcpbTag, '9.9.9');
    assert.equal(v.serverMcpbFile, '9.9.9');
    assert.equal(v.lock, '9.9.9');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a consistent fixture passes, and a single drifted file is flagged', () => {
  const dir = fixtureRoot('2.0.0');
  try {
    assert.equal(checkConsistency(dir).ok, true);

    const manifest = readJson(dir, 'manifest.json');
    manifest.version = '2.0.1';
    writeJson(dir, 'manifest.json', manifest);

    const bad = checkConsistency(dir);
    assert.equal(bad.ok, false);
    assert.ok(bad.problems.some((p) => p.includes('manifest.json version')));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('checkConsistency flags a wrong MCPB hash', () => {
  const dir = fixtureRoot('3.1.4');
  try {
    const server = readJson(dir, 'server.json');
    server.packages.find((p) => p.registryType === 'mcpb').fileSha256 = 'deadbeef';
    writeJson(dir, 'server.json', server);
    const bad = checkConsistency(dir);
    assert.equal(bad.ok, false);
    assert.ok(bad.problems.some((p) => p.includes('fileSha256')));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('applyVersion rejects a non-semver string', () => {
  const dir = fixtureRoot('1.0.0');
  try {
    assert.throws(() => applyVersion(dir, 'not-a-version'), /invalid semver/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
