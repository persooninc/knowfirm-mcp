#!/usr/bin/env node
// OPS-02 version-sync guard rail (knowfirm.com#209). CI and `npm test` fail if
// the version string disagrees across any artifact a marketplace reads:
// package.json, manifest.json, server.json (its own version, the npm package
// version, and the MCPB download URL + filename it pins) and the committed
// .mcpb bundle (its filename and the manifest.json baked inside it).
//
// package.json is the canonical source. This is a READ-ONLY check — it never
// rewrites anything (that is the release script's job, knowfirm.com#178). Scope
// is deliberately versions only; it does not verify the bundle's sha256.
//
//   node scripts/check-versions.mjs     # exit 1 (and list drift) on any mismatch
//
import { readFileSync, readdirSync } from 'node:fs';
import { inflateRawSync } from 'node:zlib';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (file, base = ROOT) => readFileSync(join(base, file), 'utf8');
const readJson = (file, base = ROOT) => JSON.parse(read(file, base));

// Every version-bearing fact across the artifacts, keyed by a human label so a
// mismatch names exactly which field drifted. package.json is canonical.
export function collect(base = ROOT) {
  const items = [];
  const add = (source, version) => items.push({ source, version });

  const pkg = readJson('package.json', base);
  const canonical = pkg.version;
  add('package.json version', pkg.version);

  add('manifest.json version', readJson('manifest.json', base).version);

  const server = readJson('server.json', base);
  add('server.json version', server.version);
  for (const p of server.packages ?? []) {
    if (p.registryType === 'npm') {
      add('server.json npm package version', p.version);
    }
    if (p.registryType === 'mcpb' && typeof p.identifier === 'string') {
      add('server.json MCPB download URL version', versionFromDownloadUrl(p.identifier));
      add('server.json MCPB filename version', versionFromBundleName(p.identifier));
    }
  }

  // The committed bundle on disk: its filename and its embedded manifest.json.
  const bundles = readdirSync(base).filter((f) => /^knowfirm-mcp-.*\.mcpb$/.test(f));
  if (bundles.length !== 1) {
    add('committed MCPB bundle', `<expected exactly 1 knowfirm-mcp-*.mcpb, found ${bundles.length}>`);
  } else {
    const name = bundles[0];
    add('committed MCPB filename version', versionFromBundleName(name));
    const bytes = readFileSync(join(base, name));
    const manifest = readZipEntryText(bytes, 'manifest.json');
    const embedded = manifest ? safeJson(manifest)?.version ?? null : null;
    add('committed MCPB embedded manifest version', embedded ?? '<manifest.json not found in bundle>');
  }

  const mismatches = items.filter((i) => i.version !== canonical);
  return { ok: mismatches.length === 0, canonical, items, mismatches };
}

// Pulls X.Y.Z out of ".../releases/download/vX.Y.Z/knowfirm-mcp-X.Y.Z.mcpb".
function versionFromDownloadUrl(url) {
  return url.match(/\/releases\/download\/v([^/]+)\//)?.[1] ?? `<no download-URL version in ${url}>`;
}

// Pulls X.Y.Z out of a "knowfirm-mcp-X.Y.Z.mcpb" name or URL ending in one.
function versionFromBundleName(nameOrUrl) {
  return nameOrUrl.match(/knowfirm-mcp-(.+?)\.mcpb$/)?.[1] ?? `<no bundle-name version in ${nameOrUrl}>`;
}

function safeJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

// Reads one entry's text out of a .mcpb (a standard zip) via the central
// directory, with no third-party dependency. Returns null if the entry is absent.
function readZipEntryText(buf, entryName) {
  const EOCD = 0x06054b50;
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0 && i >= buf.length - 22 - 0xffff; i--) {
    if (buf.readUInt32LE(i) === EOCD) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) return null;
  const entries = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16); // offset of central directory
  for (let n = 0; n < entries; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) return null; // central dir header signature
    const method = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOff = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    if (name === entryName) {
      // Local header sizes may be zeroed, so use the central-dir compSize and
      // the local header's own name/extra lengths to locate the data start.
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

function main() {
  const { ok, canonical, items, mismatches } = collect();
  console.log(`Version consistency check (canonical = package.json ${canonical}):`);
  for (const i of items) {
    console.log(`  ${i.version === canonical ? 'ok ' : 'XX '} ${i.source}: ${i.version}`);
  }
  if (!ok) {
    console.error(
      `\n${mismatches.length} artifact(s) disagree with package.json ${canonical}:\n` +
        mismatches.map((m) => `  - ${m.source}: ${m.version}`).join('\n') +
        `\n\nSync them (see scripts/version.mjs --write, knowfirm.com#178) before publishing.`,
    );
    process.exit(1);
  }
  console.log('\nAll artifacts agree.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
