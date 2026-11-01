#!/usr/bin/env node
// Release version sync + consistency checker for knowfirm-mcp.
//
// package.json is the single source of truth for the version. Every other
// artifact that carries the version — manifest.json, server.json (its own
// version, the npm package version, and the MCPB download URL/filename),
// package-lock.json, and the on-disk MCPB bundle — must agree with it.
//
// Usage:
//   node scripts/release-sync.mjs            # --check (default)
//   node scripts/release-sync.mjs --check    # verify everything agrees; exit 1 on drift
//   node scripts/release-sync.mjs set 0.2.0  # write that version into every file
//   node scripts/release-sync.mjs --hash     # recompute server.json fileSha256 from the on-disk MCPB
//
// Release flow for a version bump:
//   1. node scripts/release-sync.mjs set <version>
//   2. rebuild the MCPB bundle as knowfirm-mcp-<version>.mcpb (mcpb pack)
//   3. node scripts/release-sync.mjs --hash
//   4. node scripts/release-sync.mjs --check   (must be clean)
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

const readJson = (root, name) => JSON.parse(readFileSync(join(root, name), 'utf8'));
const writeJson = (root, name, obj) =>
  writeFileSync(join(root, name), JSON.stringify(obj, null, 2) + '\n');

const mcpbName = (version) => `knowfirm-mcp-${version}.mcpb`;

const sha256 = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');

const npmPackage = (serverJson) =>
  (serverJson.packages || []).find((p) => p.registryType === 'npm');
const mcpbPackage = (serverJson) =>
  (serverJson.packages || []).find((p) => p.registryType === 'mcpb');

// Pull the two version occurrences out of the MCPB download URL:
//   .../releases/download/v<version>/knowfirm-mcp-<version>.mcpb
const parseMcpbIdentifier = (identifier) => {
  const tag = identifier.match(/\/releases\/download\/v([^/]+)\//);
  const file = identifier.match(/knowfirm-mcp-([^/]+)\.mcpb$/);
  return { tag: tag && tag[1], file: file && file[1] };
};

const setMcpbIdentifierVersion = (identifier, version) =>
  identifier
    .replace(/\/releases\/download\/v[^/]+\//, `/releases/download/v${version}/`)
    .replace(/knowfirm-mcp-[^/]+\.mcpb$/, mcpbName(version));

// Read every version-bearing field across the repo.
export function readVersions(root = ROOT) {
  const pkg = readJson(root, 'package.json');
  const manifest = readJson(root, 'manifest.json');
  const server = readJson(root, 'server.json');
  const lock = readJson(root, 'package-lock.json');
  const npm = npmPackage(server);
  const mcpb = mcpbPackage(server);
  const mcpbId = mcpb ? parseMcpbIdentifier(mcpb.identifier) : {};
  return {
    source: pkg.version,
    pkg: pkg.version,
    manifest: manifest.version,
    server: server.version,
    serverNpm: npm && npm.version,
    serverMcpbTag: mcpbId.tag,
    serverMcpbFile: mcpbId.file,
    serverMcpbSha: mcpb && mcpb.fileSha256,
    lock: lock.version,
    lockRoot: lock.packages && lock.packages[''] && lock.packages[''].version,
  };
}

// Verify every artifact agrees with package.json. Returns { ok, version, problems }.
export function checkConsistency(root = ROOT) {
  const v = readVersions(root);
  const source = v.source;
  const problems = [];
  const expect = (label, value) => {
    if (value !== source) problems.push(`${label} is ${JSON.stringify(value)}, expected ${JSON.stringify(source)}`);
  };

  if (!source || !SEMVER.test(source)) {
    problems.push(`package.json version ${JSON.stringify(source)} is not a valid semver`);
  }
  expect('manifest.json version', v.manifest);
  expect('server.json version', v.server);
  expect('server.json npm package version', v.serverNpm);
  expect('server.json MCPB release tag', v.serverMcpbTag);
  expect('server.json MCPB filename version', v.serverMcpbFile);
  expect('package-lock.json version', v.lock);
  if (v.lockRoot !== undefined) expect('package-lock.json root package version', v.lockRoot);

  // The MCPB bundle named for the source version must exist and hash to
  // whatever server.json advertises.
  const mcpbPath = join(root, mcpbName(source));
  if (!existsSync(mcpbPath)) {
    problems.push(`MCPB bundle ${mcpbName(source)} is missing`);
  } else {
    const actual = sha256(mcpbPath);
    if (actual !== v.serverMcpbSha) {
      problems.push(
        `server.json MCPB fileSha256 is ${v.serverMcpbSha}, but ${mcpbName(source)} hashes to ${actual}`,
      );
    }
  }
  return { ok: problems.length === 0, version: source, problems };
}

// Write `version` into every version-bearing field (does not touch the MCPB
// binary — rebuild it, then run updateMcpbHash). Returns the list of changes.
export function applyVersion(root = ROOT, version) {
  if (!SEMVER.test(version)) throw new Error(`invalid semver: ${version}`);
  const changes = [];

  const pkg = readJson(root, 'package.json');
  if (pkg.version !== version) changes.push(`package.json ${pkg.version} -> ${version}`);
  pkg.version = version;
  writeJson(root, 'package.json', pkg);

  const manifest = readJson(root, 'manifest.json');
  if (manifest.version !== version) changes.push(`manifest.json ${manifest.version} -> ${version}`);
  manifest.version = version;
  writeJson(root, 'manifest.json', manifest);

  const server = readJson(root, 'server.json');
  if (server.version !== version) changes.push(`server.json ${server.version} -> ${version}`);
  server.version = version;
  const npm = npmPackage(server);
  if (npm) npm.version = version;
  const mcpb = mcpbPackage(server);
  if (mcpb) mcpb.identifier = setMcpbIdentifierVersion(mcpb.identifier, version);
  writeJson(root, 'server.json', server);

  const lock = readJson(root, 'package-lock.json');
  lock.version = version;
  if (lock.packages && lock.packages['']) lock.packages[''].version = version;
  writeJson(root, 'package-lock.json', lock);

  // NOTE: the MCPB binary still carries the old embedded manifest version, so
  // a release bump must rebuild knowfirm-mcp-<version>.mcpb and then run
  // updateMcpbHash. checkConsistency will fail until both are done.
  return changes;
}

// Recompute server.json's MCPB fileSha256 from the on-disk bundle for the
// current package.json version.
export function updateMcpbHash(root = ROOT) {
  const { source } = readVersions(root);
  const mcpbPath = join(root, mcpbName(source));
  if (!existsSync(mcpbPath)) throw new Error(`MCPB bundle ${mcpbName(source)} not found; rebuild it first`);
  const hash = sha256(mcpbPath);
  const server = readJson(root, 'server.json');
  const mcpb = mcpbPackage(server);
  if (!mcpb) throw new Error('server.json has no mcpb package entry');
  mcpb.fileSha256 = hash;
  writeJson(root, 'server.json', server);
  return hash;
}

function main(argv) {
  const [cmd, arg] = argv;
  if (cmd === 'set') {
    if (!arg) {
      console.error('usage: release-sync.mjs set <version>');
      process.exit(2);
    }
    const changes = applyVersion(ROOT, arg);
    console.log(changes.length ? changes.join('\n') : `already at ${arg}`);
    console.log(`\nNext: rebuild ${mcpbName(arg)}, then run: node scripts/release-sync.mjs --hash`);
    return;
  }
  if (cmd === '--hash') {
    const hash = updateMcpbHash(ROOT);
    console.log(`server.json fileSha256 = ${hash}`);
    return;
  }
  // default: --check
  const { ok, version, problems } = checkConsistency(ROOT);
  if (ok) {
    console.log(`version consistency OK at ${version}`);
    return;
  }
  console.error(`version inconsistency (source ${version}):`);
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main(process.argv.slice(2));
}
