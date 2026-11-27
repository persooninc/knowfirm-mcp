#!/usr/bin/env node
// Single source of truth for the release version across every artifact a
// marketplace reads: package.json, manifest.json, server.json and the MCPB
// bundle (its filename, its download URL/sha in server.json, and the version
// baked into index.mjs). package.json is canonical.
//
//   node scripts/version.mjs            # check only (exit 1 on any drift)
//   node scripts/version.mjs --write    # sync every artifact to package.json
//   node scripts/version.mjs 0.2.0      # bump package.json to 0.2.0, then sync
//
// The script rewrites text artifacts and refreshes server.json's MCPB
// fileSha256 from the committed bundle when its name matches. It never rebuilds
// the binary .mcpb; when the version changes it prints the pack/rename step so
// the consistency check (which verifies the committed bundle) gates the release
// until the bundle is rebuilt.
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { inflateRawSync } from 'node:zlib';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SEMVER = String.raw`\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?`;

const read = (f, base = ROOT) => readFileSync(join(base, f), 'utf8');

// Each slot names one place a version string lives. `re` must have exactly one
// capture group around the version so the same pattern reads it (check) and
// rewrites it (sync). Order within a file does not matter; patterns are anchored
// to enough surrounding context to be unambiguous.
const SLOTS = [
  { file: 'package.json', label: 'package.json version', canonical: true,
    re: /("version":\s*")SEMVER(")/ },
  { file: 'manifest.json', label: 'manifest.json version',
    re: /("version":\s*")SEMVER(")/ },
  { file: 'server.json', label: 'server.json version',
    re: /("version":\s*")SEMVER(")/ },
  { file: 'server.json', label: 'server.json npm package version',
    re: /("identifier":\s*"@knowfirm\/knowfirm-mcp",\s*"version":\s*")SEMVER(")/ },
  { file: 'server.json', label: 'server.json MCPB download URL',
    re: /(releases\/download\/v)SEMVER(\/)/ },
  { file: 'server.json', label: 'server.json MCPB filename',
    re: /(knowfirm-mcp-)SEMVER(\.mcpb)/ },
  { file: 'index.mjs', label: 'index.mjs server version',
    re: /(new McpServer\(\{\s*name:\s*'knowfirm',\s*version:\s*')SEMVER(')/ },
];

const compile = (re) => new RegExp(re.source.replace('SEMVER', `(${SEMVER})`), re.flags);

// The first `(...)` in a compiled slot is the leading context, the second is the
// version, the third is the trailing context — so matched groups are [ctxBefore, version, ctxAfter].
function slotVersion(slot, base = ROOT) {
  const m = read(slot.file, base).match(compile(slot.re));
  if (!m) throw new Error(`Could not find ${slot.label} in ${slot.file}`);
  return m[2];
}

export function canonicalVersion(base = ROOT) {
  return JSON.parse(read('package.json', base)).version;
}

// The committed .mcpb bundle: its filename encodes a version, its embedded
// manifest.json carries one, and its bytes have a sha256 that server.json pins.
export function bundleFacts(base = ROOT) {
  const files = readdirSync(base).filter((f) => /^knowfirm-mcp-.*\.mcpb$/.test(f));
  if (files.length !== 1) {
    return { count: files.length, files };
  }
  const name = files[0];
  const filenameVersion = name.match(new RegExp(`^knowfirm-mcp-(${SEMVER})\\.mcpb$`))?.[1] ?? null;
  const bytes = readFileSync(join(base, name));
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const manifest = readZipEntryText(bytes, 'manifest.json');
  const manifestVersion = manifest
    ? manifest.match(new RegExp(`"version":\\s*"(${SEMVER})"`))?.[1] ?? null
    : null;
  return { count: 1, name, filenameVersion, manifestVersion, sha256 };
}

// Reads one entry's text out of a .mcpb (a standard zip) via the central
// directory, without a third-party zip dependency. Returns null if absent.
function readZipEntryText(buf, entryName) {
  const EOCD = 0x06054b50;
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0 && i >= buf.length - 22 - 0xffff; i--) {
    if (buf.readUInt32LE(i) === EOCD) { eocd = i; break; }
  }
  if (eocd < 0) return null;
  const entries = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16); // offset of central directory
  for (let n = 0; n < entries; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) return null; // central dir header
    const method = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOff = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    if (name === entryName) {
      // Local header: sizes may be zeroed here, so use the central-dir compSize
      // and the local header's own name/extra lengths to find the data start.
      const lNameLen = buf.readUInt16LE(localOff + 26);
      const lExtraLen = buf.readUInt16LE(localOff + 28);
      const dataStart = localOff + 30 + lNameLen + lExtraLen;
      const raw = buf.subarray(dataStart, dataStart + compSize);
      const out = method === 0 ? raw : inflateRawSync(raw);
      return out.toString('utf8');
    }
    p += 46 + nameLen + extraLen + commentLen;
  }
  return null;
}

function serverJsonSha(base = ROOT) {
  return read('server.json', base).match(/"fileSha256":\s*"([0-9a-f]{64})"/)?.[1] ?? null;
}

// Collects every version-bearing fact across the artifacts. Returns
// { ok, canonical, items: [{ source, version }], mismatches: [...] }.
export function collect(base = ROOT) {
  const canonical = canonicalVersion(base);
  const items = SLOTS.map((s) => ({ source: `${s.label}`, version: slotVersion(s, base) }));
  const bundle = bundleFacts(base);
  if (bundle.count !== 1) {
    items.push({ source: 'MCPB bundle file', version: `<${bundle.count} .mcpb files found>` });
  } else {
    items.push({ source: 'MCPB filename version', version: bundle.filenameVersion });
    items.push({ source: 'MCPB manifest version', version: bundle.manifestVersion });
    const pinned = serverJsonSha(base);
    if (pinned !== bundle.sha256) {
      items.push({ source: 'MCPB sha256 (server.json pin vs bundle bytes)', version: `${pinned} != ${bundle.sha256}` });
    }
  }
  const mismatches = items.filter((i) => i.version !== canonical);
  return { ok: mismatches.length === 0, canonical, items, mismatches };
}

// Rewrites text artifacts to `target` and refreshes the server.json MCPB sha256
// from the committed bundle when the bundle filename already matches `target`.
export function sync(target, base = ROOT) {
  const changed = [];
  // package.json first so it becomes canonical even when bumping.
  for (const slot of SLOTS) {
    const before = read(slot.file, base);
    const after = before.replace(compile(slot.re), (_m, pre, _v, post) => `${pre}${target}${post}`);
    if (after !== before) {
      writeFileSync(join(base, slot.file), after);
      changed.push(slot.label);
    }
  }
  const bundle = bundleFacts(base);
  if (bundle.count === 1 && bundle.filenameVersion === target) {
    const before = read('server.json', base);
    const after = before.replace(/("fileSha256":\s*")[0-9a-f]{64}(")/, `$1${bundle.sha256}$2`);
    if (after !== before) {
      writeFileSync(join(base, 'server.json'), after);
      changed.push('server.json MCPB fileSha256');
    }
  }
  return { changed, bundle };
}

function main(argv) {
  const args = argv.slice(2);
  const write = args.includes('--write');
  const bump = args.find((a) => !a.startsWith('--'));
  if (bump && !new RegExp(`^${SEMVER}$`).test(bump)) {
    console.error(`Not a semver version: ${bump}`);
    process.exit(2);
  }

  if (bump || write) {
    const target = bump ?? canonicalVersion();
    const { changed, bundle } = sync(target);
    console.log(`Synced to ${target}. Updated: ${changed.length ? changed.join(', ') : '(nothing — already in sync)'}`);
    if (bundle.count === 1 && bundle.filenameVersion !== target) {
      console.log(
        `\nNext: rebuild the MCPB bundle for v${target} so the release is consistent:\n` +
        `  npx @anthropic-ai/mcpb pack\n` +
        `  mv knowfirm-mcp-*.mcpb knowfirm-mcp-${target}.mcpb\n` +
        `  node scripts/version.mjs --write   # refreshes server.json fileSha256\n` +
        `Then publish the npm package and the v${target} GitHub release.`);
    }
  }

  const { ok, canonical, items, mismatches } = collect();
  console.log(`\nVersion consistency (canonical ${canonical}):`);
  for (const i of items) {
    console.log(`  ${i.version === canonical ? 'ok ' : 'XX '} ${i.source}: ${i.version}`);
  }
  if (!ok) {
    console.error(`\n${mismatches.length} artifact(s) out of sync with package.json ${canonical}.`);
    process.exit(1);
  }
  console.log('\nAll artifacts agree.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv);
}
