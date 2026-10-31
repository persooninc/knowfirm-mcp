# Releasing knowfirm-mcp

`package.json` `version` is the **single source of truth**. The version also
appears in `manifest.json`, `server.json` (its own `version`, the npm package
`version`, and the MCPB release URL/filename), `package-lock.json`, and the name
of the on-disk MCPB bundle (`knowfirm-mcp-<version>.mcpb`, with its SHA-256 in
`server.json`). These must never drift apart — directories (Glama, mcprush, the
MCP Registry) read them, and a mismatch breaks installs.

`scripts/release-sync.mjs` keeps them in lockstep and a `node --test`
version-consistency test fails the build on any drift.

## Check (runs in `npm test`)

```sh
npm run release:check     # or: node scripts/release-sync.mjs --check
```

Exits non-zero and lists every field that disagrees with `package.json`.

## Cut a new version

```sh
npm run release:set -- 0.2.0        # writes 0.2.0 into every JSON artifact + the MCPB URL/filename
# rebuild the bundle as knowfirm-mcp-0.2.0.mcpb (mcpb pack)
node scripts/release-sync.mjs --hash   # recompute server.json fileSha256 from the new bundle
npm run release:check                  # must be clean
npm test                               # must pass, none skipped
```

The MCPB binary embeds `manifest.json`, so a bump requires a real rebuild of the
bundle — `--hash` records the new bundle's SHA-256 and `release:check` stays red
until both the rebuilt bundle and its hash are in place.
