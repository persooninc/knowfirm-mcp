#!/usr/bin/env node
// Stress / capacity suite for the KnowFirm MCP server. Targets live in
// docs/perf-targets.md; this script exits 1 if any target is missed.
//
//   npm run stress                 # default load
//   STRESS_CALLS=20000 npm run stress
//
// The upstream KnowFirm API is replaced by an in-process stub with simulated
// latency, so this measures the MCP server's own overhead and stability (no
// network, no credits, no real key).
import { performance } from 'node:perf_hooks';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { server } from '../../index.mjs';
import { TOOLS } from '../../tools.mjs';

const CALLS = Number(process.env.STRESS_CALLS ?? 5000);
const CONCURRENCY = Number(process.env.STRESS_CONCURRENCY ?? 100);
const UPSTREAM_MS = 5;
const KEY = 'kf_test_stress';

export const TARGETS = {
  successRate: 1.0, // every 200 call returns a non-error result
  minThroughput: 300, // calls/second at concurrency 100
  maxSerialP95OverheadMs: 10, // concurrency 1: p95 latency minus simulated upstream latency
  maxLoadP95Ms: 150, // concurrency 100: p95 end-to-end latency (includes queueing)
  maxLoadP99Ms: 250,
  maxHeapGrowthMB: 64, // heap after load vs. before, after GC
  errorStormHandled: 1.0, // share of 429/5xx calls returned as isError, never thrown
  validationRejected: 1.0, // share of invalid inputs rejected with no upstream call
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let upstreamCalls = 0;
const stub = (status) => async () => {
  upstreamCalls++;
  await sleep(UPSTREAM_MS);
  return {
    ok: status < 400,
    status,
    headers: { get: () => '1' },
    json: async () => ({ canonicalName: 'Acme', results: [], complaintRisk: null }),
  };
};

async function connect(fetcher) {
  const [a, b] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'stress', version: '1' });
  await Promise.all([server(KEY, 'stress', fetcher).connect(a), client.connect(b)]);
  return client;
}

async function pool(n, concurrency, task) {
  let next = 0;
  const workers = Array.from({ length: concurrency }, async () => {
    while (next < n) await task(next++);
  });
  await Promise.all(workers);
}

const pct = (sorted, p) => sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];

async function loadPhase(calls = CALLS, concurrency = CONCURRENCY) {
  const client = await connect(stub(200));
  const latencies = [];
  let ok = 0;
  global.gc?.();
  const heapBefore = process.memoryUsage().heapUsed;
  const t0 = performance.now();
  await pool(calls, concurrency, async (i) => {
    const tool = TOOLS[i % TOOLS.length];
    const s = performance.now();
    const r = await client.callTool({ name: tool.name, arguments: tool.examples[0] });
    latencies.push(performance.now() - s);
    if (!r.isError) ok++;
  });
  const seconds = (performance.now() - t0) / 1000;
  global.gc?.();
  const heapAfter = process.memoryUsage().heapUsed;
  latencies.sort((a, b) => a - b);
  await client.close();
  return {
    calls,
    concurrency,
    successRate: ok / calls,
    throughput: calls / seconds,
    p50Ms: pct(latencies, 50),
    p95Ms: pct(latencies, 95),
    p99Ms: pct(latencies, 99),
    heapGrowthMB: (heapAfter - heapBefore) / 1024 / 1024,
  };
}

async function errorStorm() {
  const n = 1000;
  let handled = 0;
  for (const status of [429, 503]) {
    const client = await connect(stub(status));
    await pool(n / 2, CONCURRENCY, async (i) => {
      const tool = TOOLS[i % TOOLS.length];
      try {
        const r = await client.callTool({ name: tool.name, arguments: tool.examples[0] });
        if (r.isError && r.content[0].text.includes(String(status))) handled++;
      } catch { /* a thrown error counts as unhandled */ }
    });
    await client.close();
  }
  return handled / n;
}

async function validationStorm() {
  const client = await connect(stub(200));
  const before = upstreamCalls;
  const n = 1000;
  let rejected = 0;
  const lookup = TOOLS.find((t) => t.name === 'business_lookup');
  await pool(n, CONCURRENCY, async (i) => {
    const args = i % 2 ? { name: 'x'.repeat(5000) } : { name: '' };
    try {
      const r = await client.callTool({ name: lookup.name, arguments: args });
      if (r.isError) rejected++;
    } catch { rejected++; }
  });
  await client.close();
  return { rate: rejected / n, upstreamCalls: upstreamCalls - before };
}

const serial = await loadPhase(500, 1);
const load = await loadPhase();
const storm = await errorStorm();
const validation = await validationStorm();

const checks = [
  ['success rate', load.successRate, '>=', TARGETS.successRate],
  ['throughput (calls/s)', load.throughput, '>=', TARGETS.minThroughput],
  ['serial success rate', serial.successRate, '>=', TARGETS.successRate],
  ['serial p95 overhead (ms)', serial.p95Ms - UPSTREAM_MS, '<=', TARGETS.maxSerialP95OverheadMs],
  ['load p95 latency (ms)', load.p95Ms, '<=', TARGETS.maxLoadP95Ms],
  ['load p99 latency (ms)', load.p99Ms, '<=', TARGETS.maxLoadP99Ms],
  ['heap growth (MB)', load.heapGrowthMB, '<=', TARGETS.maxHeapGrowthMB],
  ['429/5xx storm handled', storm, '>=', TARGETS.errorStormHandled],
  ['invalid input rejected', validation.rate, '>=', TARGETS.validationRejected],
  ['upstream calls for invalid input', validation.upstreamCalls, '<=', 0],
];
let failed = 0;
console.log(`stress: ${load.calls} calls @ concurrency ${load.concurrency}, upstream stub ${UPSTREAM_MS}ms, p50 ${load.p50Ms.toFixed(2)}ms`);
for (const [name, value, op, target] of checks) {
  const pass = op === '>=' ? value >= target : value <= target;
  if (!pass) failed++;
  console.log(`  ${pass ? 'PASS' : 'FAIL'} ${name}: ${Number(value).toFixed(2)} (target ${op} ${target})`);
}
console.log(`stress: ${checks.length - failed}/${checks.length} targets met`);
process.exitCode = failed ? 1 : 0;
