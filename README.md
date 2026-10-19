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

Install guide (copy-paste config for Claude Desktop, Cursor, VS Code, Windsurf, and the remote URL): https://knowfirm.com/docs/mcp

The older `knowfirm` npm package is a separate HTTP SDK.
