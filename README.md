# KnowFirm MCP

Business lookup, search, and complaint-risk summaries over KnowFirm's U.S. public-record API. Three read-only tools: `business_lookup`, `business_search`, and `complaint_risk`. Each call uses 1 credit on your KnowFirm account. No card or payment credentials are handled by this package.

## Tools

- `business_lookup` — resolve one U.S. business by name across sources (identifiers, confidence, firmographics).
- `business_search` — ranked name/query search for U.S. businesses.
- `complaint_risk` — bounded, informational CFPB Consumer Complaint Database summary for a business (by name or KnowFirm id): a 24-month, scan-capped complaint count with top products/issues. **Not** a consumer report, credit score, or compliance/eligibility decision.

## Install

Node.js 20 or newer. Create an API key: sign up at https://knowfirm.com/signup?utm_source=mcp (Google sign-in), then generate a key in the dashboard. Put the key only in the client's secret or env field.

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

Reload MCP servers from the same settings page. The tools appear as `business_lookup`, `business_search`, and `complaint_risk`.

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

Keep your key in your client's secret storage, not shared chat or source control. Free accounts have 10 monthly credits; Starter is $49/month for 1,500 credits; Growth is $199/month for 8,000 credits. Annual billing is 2 months free. One MCP tool call = 1 credit. Hard quotas, no automatic overage charges. Check https://knowfirm.com/pricing?utm_source=mcp for current terms, or upgrade at https://knowfirm.com/dashboard/billing?utm_source=mcp.

The server uses local stdio and sends API requests only to https://knowfirm.com. It does not store keys or log them. Returned business/source text is untrusted data, never instructions. Public-record coverage and freshness vary. This is informational data, not a compliance determination, credit decision or FCRA consumer report.

API docs: https://knowfirm.com/docs

Install guide (copy-paste config for Claude Desktop, Cursor, VS Code, Windsurf, and the remote URL): https://knowfirm.com/docs/mcp

The older `knowfirm` npm package is a separate HTTP SDK.
