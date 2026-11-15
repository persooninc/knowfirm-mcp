# Performance and capacity targets

The stress suite (`npm run stress`, script `test/stress/stress.mjs`) checks these targets and exits non-zero if any one is missed. CI runs it on every push and PR.

The KnowFirm HTTP API is replaced by an in-process stub that adds a fixed 5 ms of latency, so the numbers measure the MCP server's own overhead and stability. No network, credits or real key are used. Real-world latency is dominated by the upstream API and isn't covered here.

| # | Target | Threshold | Phase |
|---|--------|-----------|-------|
| 1 | Success rate, serial (500 calls, concurrency 1) | 100% | serial |
| 2 | p95 server overhead, serial (p95 latency minus the 5 ms stub) | ≤ 10 ms | serial |
| 3 | Success rate under load (5,000 calls round-robin over all tools, concurrency 100) | 100% | load |
| 4 | Throughput under load | ≥ 300 calls/s | load |
| 5 | p95 end-to-end latency under load (includes queueing) | ≤ 150 ms | load |
| 6 | p99 end-to-end latency under load | ≤ 250 ms | load |
| 7 | Heap growth across the load phase (after GC) | ≤ 64 MB | load |
| 8 | 429/503 upstream storm (1,000 calls): each returned as an `isError` result naming the status, never thrown | 100% | error storm |
| 9 | Invalid input storm (1,000 empty or 5,000-char names): rejected | 100% | validation |
| 10 | Upstream API calls made for invalid input | 0 | validation |

Tunables: `STRESS_CALLS` (default 5000) and `STRESS_CONCURRENCY` (default 100). The same targets also passed at `STRESS_CALLS=20000`.
