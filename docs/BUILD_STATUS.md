# Build status

Checked 2026-11-01 on branch `feat/sync-canonical-server`.

## Verified locally

- `npm ci` and `npm test`: 77/77 pass (`test.mjs` and `scripts/check-versions.test.mjs`).
  The tests cover the keyless handshake, all six tools, the 401/402/429/5xx error contract,
  workflow prompts, Smithery config, npm metadata and the MCPB manifest tool set.
- `node scripts/check-versions.mjs`: package.json, manifest.json and server.json agree (0.1.0).
- A stdio handshake with no key lists six tools and two prompts.

## CI

- `.github/workflows/ci.yml`: `npm test`.
- `.github/workflows/docker-smoke.yml`: builds the Dockerfile and asserts that a keyless
  `tools/list` names all six tools. This is the check Glama and Smithery run.

## Published

- npm: `@knowfirm/knowfirm-mcp@0.1.0` (four tools). The next release adds `business_screening`,
  `business_segments` and the prompts. Publishing is an owner step on the owner's npm account.
- MCP Registry: `io.github.gitdhillonai/knowfirm` 0.1.0.

Canonical source: `persooninc/knowfirm.com` `packages/mcp-server`. Keep this repo in sync with it.
