// Edge-case and failure-path tests that close the remaining line/branch gaps in
// index.mjs, scripts/check-versions.mjs and scripts/release-sync.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, cpSync, rmSync, writeFileSync, readFileSync, readdirSync, unlinkSync } from 'node:fs';
import { deflateRawSync } from 'node:zlib';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import {
  normalizeUtmSource, rateLimitedError, request, complaintRisk, zodShape, server, main, isMainModule,
} from '../index.mjs';
import { collect, main as cvMain } from '../scripts/check-versions.mjs';
import { readVersions, checkConsistency, applyVersion, updateMcpbHash, main as rsMain } from '../scripts/release-sync.mjs';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');
const KEY = 'kf_test_fixture';
const json = (body, status = 200, headers) => async () => ({ ok: status < 400, status, headers, json: async () => body });
const readJ = (d, f) => JSON.parse(readFileSync(join(d, f), 'utf8'));
const writeJ = (d, f, o) => writeFileSync(join(d, f), JSON.stringify(o, null, 2) + '\n');
const tmp = (p) => mkdtempSync(join(tmpdir(), p));

// ---------- index.mjs ----------

test('normalizeUtmSource handles null/undefined and junk', () => {
  assert.equal(normalizeUtmSource(null), 'mcp');
  assert.equal(normalizeUtmSource(undefined), 'mcp');
  assert.equal(normalizeUtmSource('!!!'), 'mcp');
  assert.equal(normalizeUtmSource('Glama'), 'glama');
});

test('rateLimitedError: missing, numeric, and non-numeric Retry-After', () => {
  assert.match(rateLimitedError(undefined), /short delay/);
  assert.match(rateLimitedError(' 30 '), /Retry after 30 seconds/);
  assert.match(rateLimitedError('Wed, 21 Oct 2015'), /short delay/);
});

test('request: 429 without a headers object still produces a safe hint', async () => {
  await assert.rejects(request('/v1/business', {}, KEY, json({}, 429)), /429 \(rate limited\).*short delay/);
});

test('request: rejects keys with the wrong prefix', async () => {
  await assert.rejects(request('/v1/business', {}, 'sk_live_x', json({})), /Set KNOWFIRM_API_KEY/);
});

test('complaintRisk: non-object JSON body yields null fields', async () => {
  for (const body of [null, 'text', 7]) {
    const r = await complaintRisk('Acme', KEY, json(body));
    assert.deepEqual([r.resolvedEntityId, r.canonicalName, r.complaintRisk], [null, null, null]);
    assert.match(r.note, /No CFPB complaint summary/);
  }
});

test('zodShape: number type, descriptions with and without example, optional fields', () => {
  const shape = zodShape({
    n: { type: 'number', description: 'A number.', minimum: 1, maximum: 5 },
    s: { type: 'string', required: true, description: 'No example.' },
  });
  assert.equal(shape.n.safeParse(3.5).success, true);
  assert.equal(shape.n.safeParse(9).success, false);
  assert.equal(shape.n.safeParse(undefined).success, true);
  assert.equal(shape.s.description, 'No example.');
  assert.equal(shape.s.safeParse(undefined).success, false);
});

async function client(srv) {
  const [a, b] = InMemoryTransport.createLinkedPair();
  const c = new Client({ name: 't', version: '1' });
  await Promise.all([srv.connect(a), c.connect(b)]);
  return c;
}

test('complaint_risk tool: keyless call returns isError with signup link', async () => {
  const c = await client(server('', 'glama'));
  const r = await c.callTool({ name: 'complaint_risk', arguments: { query: 'Acme' } });
  assert.equal(r.isError, true);
  assert.match(r.content[0].text, /signup\?utm_source=glama/);
});

test('complaint_risk tool: success path through an injected fetcher', async () => {
  const c = await client(server(KEY, 'mcp', json({ canonicalName: 'Acme', complaintRisk: { level: 'low' } })));
  const r = await c.callTool({ name: 'complaint_risk', arguments: { query: 'Acme' } });
  assert.equal(r.isError, undefined);
  assert.equal(JSON.parse(r.content[0].text).canonicalName, 'Acme');
});

test('prompts render the business name into the message', async () => {
  const c = await client(server(KEY));
  const r = await c.getPrompt({ name: 'kyb_check', arguments: { business: 'Acme' } });
  assert.match(r.messages[0].content.text, /KYB check on "Acme"/);
});

test('main: connect failure sets exitCode 1 and logs a generic message', async () => {
  const errors = [];
  const realError = console.error;
  const realCode = process.exitCode;
  console.error = (m) => errors.push(m);
  try {
    await main({ connect: async () => { throw new Error('secret detail'); } }, {});
    assert.equal(process.exitCode, 1);
    assert.deepEqual(errors, ['KnowFirm MCP could not start']);
  } finally {
    console.error = realError;
    process.exitCode = realCode;
  }
});

test('main: successful connect leaves exitCode untouched', async () => {
  let connected = false;
  await main({ connect: async () => { connected = true; } }, {});
  assert.equal(connected, true);
});

test('isMainModule: true for this file path, false for others and for missing argv', () => {
  const file = join(REPO, 'index.mjs');
  assert.equal(isMainModule(file, pathToFileURL(file).href), true);
  assert.equal(isMainModule(join(REPO, 'tools.mjs'), pathToFileURL(file).href), false);
  assert.equal(isMainModule(null, pathToFileURL(file).href), false);
  assert.equal(isMainModule(join(REPO, 'does-not-exist.mjs'), pathToFileURL(file).href), false);
  assert.equal(isMainModule(), false);
});

test('CLI: running index.mjs starts a stdio server that answers initialize', () => {
  const init = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 't', version: '1' } } }) + '\n';
  const r = spawnSync(process.execPath, [join(REPO, 'index.mjs')], { input: init, encoding: 'utf8', timeout: 10000, env: { ...process.env, KNOWFIRM_API_KEY: '' } });
  assert.match(r.stdout, /"serverInfo":\{"name":"knowfirm"/);
});

// ---------- scripts/check-versions.mjs ----------

// Minimal zip writer (central directory + local headers) for bundle fixtures.
function zip(entries) {
  const locals = []; const centrals = []; let off = 0;
  for (const { name, data, method = 0, badSig = false } of entries) {
    const body = method === 8 ? deflateRawSync(Buffer.from(data)) : Buffer.from(data);
    const n = Buffer.from(name);
    const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(method, 8);
    lh.writeUInt32LE(body.length, 18); lh.writeUInt16LE(n.length, 26);
    const ch = Buffer.alloc(46); ch.writeUInt32LE(badSig ? 0xdeadbeef : 0x02014b50, 0); ch.writeUInt16LE(method, 10);
    ch.writeUInt32LE(body.length, 20); ch.writeUInt16LE(n.length, 28); ch.writeUInt32LE(off, 42);
    locals.push(lh, n, body); centrals.push(ch, n); off += 30 + n.length + body.length;
  }
  const cd = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22); eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cd.length, 12); eocd.writeUInt32LE(off, 16);
  return Buffer.concat([...locals, cd, eocd]);
}

function cvFixture(bundle) {
  const dir = tmp('kf-cv-');
  for (const f of ['package.json', 'manifest.json', 'server.json']) cpSync(join(REPO, f), join(dir, f));
  if (bundle) writeFileSync(join(dir, 'knowfirm-mcp-0.1.0.mcpb'), bundle);
  return dir;
}
const embedded = (dir) => collect(dir).items.find((i) => i.source === 'committed MCPB embedded manifest version').version;

test('check-versions: stored and deflated bundle manifests are both read', () => {
  for (const method of [0, 8]) {
    const dir = cvFixture(zip([{ name: 'other.txt', data: 'x' }, { name: 'manifest.json', data: '{"version":"0.1.0"}', method }]));
    try { assert.equal(collect(dir).ok, true); } finally { rmSync(dir, { recursive: true, force: true }); }
  }
});

test('check-versions: bundle failure paths are reported, not thrown', () => {
  const cases = [
    [zip([{ name: 'other.txt', data: 'x' }]), '<manifest.json not found in bundle>'],
    [zip([{ name: 'manifest.json', data: 'not json' }]), '<manifest.json not found in bundle>'],
    [zip([{ name: 'manifest.json', data: '{}' }]), '<manifest.json not found in bundle>'],
    [zip([{ name: 'manifest.json', data: '{}', badSig: true }]), '<manifest.json not found in bundle>'],
    [Buffer.alloc(40), '<manifest.json not found in bundle>'],
  ];
  for (const [bytes, want] of cases) {
    const dir = cvFixture(bytes);
    try { assert.equal(embedded(dir), want); } finally { rmSync(dir, { recursive: true, force: true }); }
  }
});

test('check-versions: zero or multiple bundles are flagged', () => {
  const none = cvFixture();
  const two = cvFixture(zip([{ name: 'manifest.json', data: '{"version":"0.1.0"}' }]));
  writeFileSync(join(two, 'knowfirm-mcp-0.2.0.mcpb'), 'x');
  try {
    assert.match(collect(none).mismatches.find((m) => m.source === 'committed MCPB bundle').version, /found 0/);
    assert.match(collect(two).mismatches.find((m) => m.source === 'committed MCPB bundle').version, /found 2/);
  } finally {
    rmSync(none, { recursive: true, force: true }); rmSync(two, { recursive: true, force: true });
  }
});

test('check-versions: server.json without packages, odd identifiers and unknown registries', () => {
  const dir = cvFixture(zip([{ name: 'manifest.json', data: '{"version":"0.1.0"}' }]));
  try {
    const s = readJ(dir, 'server.json');
    delete s.packages; writeJ(dir, 'server.json', s);
    assert.equal(collect(dir).items.some((i) => i.source.startsWith('server.json npm')), false);
    s.packages = [{ registryType: 'mcpb', identifier: 'https://example.com/bundle.zip' }, { registryType: 'mcpb', identifier: 42 }, { registryType: 'pypi' }];
    writeJ(dir, 'server.json', s);
    const m = collect(dir).mismatches.map((x) => x.version).join('|');
    assert.match(m, /no download-URL version/);
    assert.match(m, /no bundle-name version/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// Capture console output while running an in-process CLI main().
function capture(fn) {
  const out = []; const err = [];
  const [l, e] = [console.log, console.error];
  console.log = (m) => out.push(m); console.error = (m) => err.push(m);
  try { return { status: fn(), stdout: out.join('\n'), stderr: err.join('\n') }; } finally { console.log = l; console.error = e; }
}

test('check-versions CLI main: 0 when consistent, 1 and lists drift otherwise', () => {
  const dir = cvFixture(zip([{ name: 'manifest.json', data: '{"version":"0.1.0"}' }]));
  try {
    let r = capture(() => cvMain(dir));
    assert.equal(r.status, 0); assert.match(r.stdout, /All artifacts agree/);
    const m = readJ(dir, 'manifest.json'); m.version = '9.9.9'; writeJ(dir, 'manifest.json', m);
    r = capture(() => cvMain(dir));
    assert.equal(r.status, 1); assert.match(r.stdout, /XX  manifest.json version: 9.9.9/); assert.match(r.stderr, /1 artifact\(s\) disagree/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('both scripts run as CLIs against the committed repo and exit 0', () => {
  for (const script of ['check-versions.mjs', 'release-sync.mjs']) {
    const r = spawnSync(process.execPath, [join(REPO, 'scripts', script)], { encoding: 'utf8', env: process.env });
    assert.equal(r.status, 0, r.stderr);
  }
});

// ---------- scripts/release-sync.mjs ----------

function rsFixture(version = '2.0.0') {
  const dir = tmp('kf-rs-');
  for (const f of ['package.json', 'manifest.json', 'server.json', 'package-lock.json']) cpSync(join(REPO, f), join(dir, f));
  applyVersion(dir, version);
  writeFileSync(join(dir, `knowfirm-mcp-${version}.mcpb`), `fake-${version}`);
  updateMcpbHash(dir);
  return dir;
}

test('release-sync: updateMcpbHash makes a fixture consistent, and errors on missing bundle/entry', () => {
  const dir = rsFixture();
  try {
    assert.equal(checkConsistency(dir).ok, true);
    const s = readJ(dir, 'server.json');
    s.packages = s.packages.filter((p) => p.registryType !== 'mcpb'); writeJ(dir, 'server.json', s);
    assert.throws(() => updateMcpbHash(dir), /no mcpb package entry/);
    unlinkSync(join(dir, 'knowfirm-mcp-2.0.0.mcpb'));
    assert.throws(() => updateMcpbHash(dir), /not found; rebuild it first/);
    assert.ok(checkConsistency(dir).problems.some((p) => /MCPB bundle knowfirm-mcp-2.0.0.mcpb is missing/.test(p)));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('release-sync: invalid/missing source version and absent packages/lock root', () => {
  const dir = rsFixture();
  try {
    const s = readJ(dir, 'server.json'); delete s.packages; writeJ(dir, 'server.json', s);
    const l = readJ(dir, 'package-lock.json'); delete l.packages; writeJ(dir, 'package-lock.json', l);
    const v = readVersions(dir);
    assert.equal(v.serverNpm, undefined); assert.equal(v.serverMcpbTag, undefined); assert.equal(v.lockRoot, undefined);
    assert.deepEqual(applyVersion(dir, '2.0.0'), []); // no-op when already at version; no packages to touch
    const p = readJ(dir, 'package.json'); p.version = 'bogus'; writeJ(dir, 'package.json', p);
    assert.ok(checkConsistency(dir).problems.some((x) => /not a valid semver/.test(x)));
    delete p.version; writeJ(dir, 'package.json', p);
    assert.ok(checkConsistency(dir).problems.some((x) => /not a valid semver/.test(x)));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('release-sync: MCPB identifier with no version markers parses to nulls', () => {
  const dir = rsFixture();
  try {
    const s = readJ(dir, 'server.json');
    s.packages.find((p) => p.registryType === 'mcpb').identifier = 'https://example.com/x.zip'; writeJ(dir, 'server.json', s);
    const v = readVersions(dir);
    assert.equal(v.serverMcpbTag, null); assert.equal(v.serverMcpbFile, null);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('release-sync CLI main: check ok, set usage, set no-op, set, check drift, --hash', () => {
  const dir = rsFixture('0.5.0');
  const run = (argv) => capture(() => rsMain(argv, dir));
  try {
    let r = run([]);
    assert.equal(r.status, 0); assert.match(r.stdout, /consistency OK at 0.5.0/);
    r = run(['set']);
    assert.equal(r.status, 2); assert.match(r.stderr, /usage/);
    r = run(['set', '0.5.0']);
    assert.equal(r.status, 0); assert.match(r.stdout, /already at 0.5.0/);
    r = run(['set', '0.6.0']);
    assert.equal(r.status, 0); assert.match(r.stdout, /package.json 0.5.0 -> 0.6.0/);
    r = run(['--check']);
    assert.equal(r.status, 1); assert.match(r.stderr, /version inconsistency \(source 0.6.0\)/);
    writeFileSync(join(dir, 'knowfirm-mcp-0.6.0.mcpb'), 'fake-0.6.0');
    r = run(['--hash']);
    assert.equal(r.status, 0); assert.match(r.stdout, /fileSha256 = [0-9a-f]{64}/);
    assert.equal(run(['--check']).status, 0);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
