// End-to-end: spawn the published entrypoint (index.mjs) as a real stdio MCP server, as an MCP
// client (Claude Desktop, Cursor) would, and drive initialize -> tools/list -> tools/call.
// Network is replaced by test/fixtures/fetch-stub.mjs (preloaded via --import), so the run is
// deterministic and offline.
import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { TOOLS } from '../tools.mjs';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');
const STUB = join(REPO, 'test', 'fixtures', 'fetch-stub.mjs');

async function launch(env = {}) {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ['--import', STUB, join(REPO, 'index.mjs')],
    env: { PATH: process.env.PATH ?? '', KNOWFIRM_API_KEY: 'kf_test_e2e_stdio_key', ...env },
    stderr: 'pipe',
  });
  const client = new Client({ name: 'e2e-stdio', version: '1' });
  await client.connect(transport);
  return client;
}

test('stdio binary: initialize advertises server info and lists every tool', async () => {
  const client = await launch();
  try {
    assert.ok(client.getServerVersion()?.name);
    const { tools } = await client.listTools();
    assert.deepEqual(tools.map((t) => t.name).sort(), TOOLS.map((t) => t.name).sort());
  } finally { await client.close(); }
});

test('stdio binary: business_lookup calls /v1/business on knowfirm.com with the key and returns JSON', async () => {
  const client = await launch();
  try {
    const res = await client.callTool({ name: 'business_lookup', arguments: { name: 'Acme Logistics LLC' } });
    assert.notEqual(res.isError, true);
    const text = res.content.map((c) => c.text).join('');
    const body = JSON.parse(text);
    assert.equal(body.stub, true);
    assert.equal(body.host, 'knowfirm.com');
    assert.equal(body.path, '/v1/business');
    assert.equal(body.query.name, 'Acme Logistics LLC');
    assert.equal(body.keyPrefix, 'kf_test_');
    assert.ok(!text.includes('kf_test_e2e_stdio_key'), 'full key must never be echoed');
  } finally { await client.close(); }
});

test('stdio binary: invalid arguments are rejected as a tool error', async () => {
  const client = await launch();
  try {
    const res = await client.callTool({ name: 'business_lookup', arguments: { name: 12345 } }).catch((e) => ({ isError: true, content: [{ text: String(e) }] }));
    assert.equal(res.isError, true);
  } finally { await client.close(); }
});

test('stdio binary: upstream 402 becomes an out-of-credits tool error', async () => {
  const client = await launch();
  try {
    const res = await client.callTool({ name: 'business_lookup', arguments: { name: 'force-402' } });
    assert.equal(res.isError, true);
    assert.match(res.content.map((c) => c.text).join(''), /credit/i);
  } finally { await client.close(); }
});

test('stdio binary: no key yields a keyless sign-up error, not a crash', async () => {
  const client = await launch({ KNOWFIRM_API_KEY: '' });
  try {
    const res = await client.callTool({ name: 'business_lookup', arguments: { name: 'Acme Logistics LLC' } });
    assert.equal(res.isError, true);
    assert.match(res.content.map((c) => c.text).join(''), /knowfirm\.com/);
  } finally { await client.close(); }
});
