# Changelog

All notable changes to `@knowfirm/knowfirm-mcp` are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

The version here is kept in sync with `package.json` and `server.json`; a unit
test (`tests/unit/mcp-repo-alignment.test.ts`) fails the build if a release
does not update this file's latest version header.

## [Unreleased]

### Added
- `kyb_check` and `vendor_due_diligence` prompts: one-click workflows that chain lookup, screening, complaint risk and lookalikes.

### Fixed
- The server now starts when launched through an npx symlinked bin (resolves the real path before the main-module check).
- An injected fetcher is honoured for every tool call; otherwise `fetch` is resolved per call.

## [0.1.0] - 2026-10-19

### Added

- Initial public release of the KnowFirm MCP server. Four read-only tools over
  KnowFirm's U.S. public-record API (bring your own API key):
  - `business_lookup` — resolve a single U.S. business by name (1 credit).
  - `business_search` — search U.S. businesses and return ranked matches (1 credit).
  - `business_screening` — screen a name against the U.S. Consolidated Screening
    List and return scored matches (2 credits).
  - `complaint_risk` — return a bounded, informational CFPB Consumer Complaint
    Database summary for a business by name or KnowFirm id; not a consumer
    report, credit score, or compliance decision (1 credit).
- Signup / upgrade funnel: keyless, `401`, `402`, and `403` responses surface
  `knowfirm.com` signup and billing links with per-channel `utm_source`
  attribution.
- Local stdio server (`npx @persooninc/knowfirm-mcp`) plus documentation of the
  remote Streamable HTTP endpoint. No card or payment credentials are handled by
  this package.

[Unreleased]: https://github.com/persooninc/knowfirm-mcp/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/persooninc/knowfirm-mcp/releases/tag/v0.1.0
