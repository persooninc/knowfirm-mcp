#!/usr/bin/env bash
# Builds the image and checks the MCP handshake works without a real key.
set -euo pipefail
IMG=${IMG:-knowfirm-mcp:check}
docker build -q -t "$IMG" . >/dev/null
OUT=$(printf '%s\n%s\n%s\n' \
 '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"smoke","version":"0"}}}' \
 '{"jsonrpc":"2.0","method":"notifications/initialized"}' \
 '{"jsonrpc":"2.0","id":2,"method":"tools/list"}' | timeout 20 docker run --rm -i "$IMG" 2>/dev/null || true)
echo "$OUT" | grep -q '"id":1' || { echo "FAIL initialize"; exit 1; }
for t in business_lookup business_search business_screening complaint_risk business_segments lookalike_businesses; do echo "$OUT" | grep -q "\"$t\"" || { echo "FAIL tools/list missing $t"; exit 1; }; done
echo "PASS docker handshake (initialize + tools/list, no key)"
