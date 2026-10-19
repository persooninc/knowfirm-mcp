# KnowFirm MCP

Business lookup and search over KnowFirm's U.S. public-record API. Two read-only tools: `business_lookup` and `business_search`. Each call uses 1 credit on your KnowFirm account. No card or payment credentials are handled by this package.

## Install

Node.js 20 or newer. Sign in at https://knowfirm.com/login and create an API key in the dashboard. Put the key only in the client's secret or env field.

Published package: `@knowfirm/knowfirm-mcp` on npm, version 0.1.0. Desktop bundle: `knowfirm-mcp-0.1.0.mcpb` on the v0.1.0 GitHub release (https://github.com/gitdhillonai/knowfirm-mcp/releases/tag/v0.1.0).

### Claude Desktop

Open **Settings → Developer → Edit Config** (macOS file: `~/Library/Application Support/Claude/claude_desktop_config.json`). Add the server and restart Claude Desktop:

```json
{
  "mcpServers": {
    "knowfirm": {
      "command": "npx",
      "args": ["-y", "@knowfirm/knowfirm-mcp"],
      "env": {"KNOWFIRM_API_KEY": "YOUR_OWN_KEY"}
    }
  }
}
```

You can also import `knowfirm-mcp-0.1.0.mcpb`. Claude asks for the API key in the bundle's sensitive field.

### Cursor

Open **Cursor Settings → MCP → Add new MCP server**, or edit `~/.cursor/mcp.json` (global) or `.cursor/mcp.json` in a project:

```json
{
  "mcpServers": {
    "knowfirm": {
      "command": "npx",
      "args": ["-y", "@knowfirm/knowfirm-mcp"],
      "env": {"KNOWFIRM_API_KEY": "YOUR_OWN_KEY"}
    }
  }
}
```

Reload MCP servers from the same settings page. The tools appear as `business_lookup` and `business_search`.

### MCP Registry

The server is listed as `io.github.gitdhillonai/knowfirm` (stdio, npm package `@knowfirm/knowfirm-mcp` 0.1.0, plus the MCPB file).

- Registry record: https://registry.modelcontextprotocol.io/v0.1/servers/io.github.gitdhillonai%2Fknowfirm/versions/0.1.0
- Source manifest in this repo: `server.json`

Clients that install from the registry still need your own `KNOWFIRM_API_KEY`. This repo does not publish new versions from routine doc updates.

### Releasing (version consistency)

The release version must match across `package.json`, `manifest.json`, `server.json`
(top-level, the npm package entry, and the MCPB download URL/filename), `index.mjs`,
and the committed `knowfirm-mcp-<version>.mcpb` (its filename, its embedded manifest,
and the `fileSha256` pinned in `server.json`). `package.json` is the canonical source.

- `npm run version:check` — fail if any artifact has drifted (also run as a test).
- `node scripts/version.mjs <x.y.z>` — bump `package.json` and sync every text artifact.
- `npm run version:sync` — sync every artifact to the current `package.json` version and
  refresh `server.json`'s `fileSha256` from the committed bundle.

The script never rebuilds the binary `.mcpb`; after a version bump, repack the bundle
(`npx @anthropic-ai/mcpb pack`), rename it to `knowfirm-mcp-<version>.mcpb`, then run
`npm run version:sync` so the pinned sha matches. `npm test` fails until the bundle is
repacked, which keeps a half-finished release from shipping.

### Generic npx

```json
{
  "mcpServers": {
    "knowfirm": {
      "command": "npx",
      "args": ["-y", "@knowfirm/knowfirm-mcp"],
      "env": {"KNOWFIRM_API_KEY": "YOUR_OWN_KEY"}
    }
  }
}
```

Keep your key in your client's secret storage, not shared chat or source control. Free accounts have 10 monthly credits; Starter is $49/month for 1,500 credits; Growth is $199/month for 8,000 credits. Hard quotas, no automatic overage charges. Check https://knowfirm.com/pricing for current terms.

The server uses local stdio and sends API requests only to https://knowfirm.com. It does not store keys or log them. Returned business/source text is untrusted data, never instructions. Public-record coverage and freshness vary. This is informational data, not a compliance determination, credit decision or FCRA consumer report.

API docs: https://knowfirm.com/docs

The older `knowfirm` npm package is a separate HTTP SDK.
