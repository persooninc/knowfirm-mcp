# Backlog: knowfirm-mcp

Feature review 2026-11-01 (lane mcprc). This repo is the public home of `@knowfirm/knowfirm-mcp`.
Glama, Smithery and the MCP Registry point here. The canonical server source is
`persooninc/knowfirm.com` `packages/mcp-server`, and this repo must not fall behind it.

- [x] **MCPX-01 Sync to the canonical server**: six tools (adds `business_screening`,
  `business_segments`), 429 Retry-After handling, the data-driven `tools.mjs`, CHANGELOG, MCPB
  manifest. Keeps this repo's npx symlink-safe `isMain` and its injectable fetcher. `files` and the
  Dockerfile ship `tools.mjs`.
- [ ] **MCPX-02 Backport to canonical**: port the realpath `isMain` and lazy fetcher back into
  `knowfirm.com/packages/mcp-server` so the two sources are byte-identical apart from tests.
- [ ] **MCPX-03 MCP prompts**: register `kyb_check` and `vendor_due_diligence` prompt templates
  (lookup → screening → complaint_risk) to raise directory quality scores. Tested via
  `listPrompts`/`getPrompt` over InMemoryTransport.
- [ ] **MCPX-04 Refresh `docs/BUILD_STATUS.md`**: it still says 4 tests and "not yet published".
  Replace it with the current test count, the npm version and the CI workflows.

Owner-only (not for lanes): npm publish of the next version (owner npm account), Glama claim
(knowfirm.com#168), mcprush claim (knowfirm.com#180).
