// Schema-driven scenario matrix. Test data is generated from each tool's
// inputSchema in tools.mjs, so a new tool or field is enrolled automatically:
//   - boundary values (min/max length, min/max value) are accepted and reach the API;
//   - out-of-bounds, wrong-type and non-integer values are rejected with no API call;
//   - upstream failure modes (network error, timeout, malformed JSON) become
//     isError results that do not leak the key;
//   - unicode / reserved characters are encoded safely into the request.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { server } from '../index.mjs';
import { TOOLS } from '../tools.mjs';

const KEY = 'kf_test_scenarios_secret';

async function connect(fetcher) {
  const [a, b] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'scenarios', version: '1' });
  await Promise.all([server(KEY, 'mcp', fetcher).connect(a), client.connect(b)]);
  return client;
}

function recorder(response = { ok: true, status: 200, json: async () => ({ results: [] }) }) {
  const calls = [];
  const fetcher = async (url, options) => { calls.push({ url, options }); return typeof response === 'function' ? response() : response; };
  return { calls, fetcher };
}

// A minimal valid argument set: the first example input for the tool.
const base = (tool) => ({ ...tool.examples[0] });

// Generated boundary cases per field: [label, value, shouldAccept].
function cases(spec) {
  const out = [];
  if (spec.type === 'string') {
    if (spec.minLength !== undefined) {
      out.push([`length == min (${spec.minLength})`, 'a'.repeat(spec.minLength), true]);
      if (spec.minLength > 0) out.push([`length == min-1 (${spec.minLength - 1})`, 'a'.repeat(spec.minLength - 1), false]);
    }
    if (spec.maxLength !== undefined) {
      out.push([`length == max (${spec.maxLength})`, 'a'.repeat(spec.maxLength), true]);
      out.push([`length == max+1 (${spec.maxLength + 1})`, 'a'.repeat(spec.maxLength + 1), false]);
    }
    out.push(['wrong type (number)', 42, false]);
  } else {
    if (spec.minimum !== undefined) {
      out.push([`value == min (${spec.minimum})`, spec.minimum, true]);
      out.push([`value == min-1 (${spec.minimum - 1})`, spec.minimum - 1, false]);
    }
    if (spec.maximum !== undefined) {
      out.push([`value == max (${spec.maximum})`, spec.maximum, true]);
      out.push([`value == max+1 (${spec.maximum + 1})`, spec.maximum + 1, false]);
    }
    if (spec.type === 'integer') out.push(['non-integer (1.5)', 1.5, false]);
    out.push(['wrong type (string)', '5', false]);
  }
  return out;
}

for (const tool of TOOLS) {
  for (const [field, spec] of Object.entries(tool.inputSchema)) {
    for (const [label, value, accept] of cases(spec)) {
      test(`${tool.name}.${field}: ${label} is ${accept ? 'accepted' : 'rejected'}`, async () => {
        const { calls, fetcher } = recorder();
        const client = await connect(fetcher);
        const r = await client.callTool({ name: tool.name, arguments: { ...base(tool), [field]: value } });
        if (accept) {
          assert.equal(r.isError, undefined, r.content?.[0]?.text);
          assert.equal(calls.length, 1);
        } else {
          assert.equal(r.isError, true);
          assert.equal(calls.length, 0, 'invalid input must not reach the API');
        }
        await client.close();
      });
    }
    if (spec.required) {
      test(`${tool.name}.${field}: missing required field is rejected with no API call`, async () => {
        const { calls, fetcher } = recorder();
        const client = await connect(fetcher);
        const args = base(tool); delete args[field];
        const r = await client.callTool({ name: tool.name, arguments: args });
        assert.equal(r.isError, true);
        assert.equal(calls.length, 0);
        await client.close();
      });
    }
  }

  const failures = [
    ['network error', () => { throw new TypeError('fetch failed: ECONNREFUSED'); }, /fetch failed/],
    ['timeout', () => { throw new DOMException('The operation was aborted due to timeout', 'TimeoutError'); }, /timeout/],
    ['malformed JSON body', () => ({ ok: true, status: 200, json: async () => { throw new SyntaxError('Unexpected token < in JSON'); } }), /Unexpected token/],
  ];
  for (const [label, response, pattern] of failures) {
    test(`${tool.name}: upstream ${label} becomes an isError result`, async () => {
      const client = await connect(async () => response());
      const r = await client.callTool({ name: tool.name, arguments: base(tool) });
      assert.equal(r.isError, true);
      assert.match(r.content[0].text, pattern);
      assert.ok(!r.content[0].text.includes(KEY), 'error text must not leak the key');
      await client.close();
    });
  }

  test(`${tool.name}: the API key is sent only as a header, never in the URL or body`, async () => {
    const { calls, fetcher } = recorder();
    const client = await connect(fetcher);
    await client.callTool({ name: tool.name, arguments: base(tool) });
    assert.equal(calls[0].options.headers['x-api-key'], KEY);
    assert.ok(!String(calls[0].url).includes(KEY));
    assert.ok(!String(calls[0].options.body ?? '').includes(KEY));
    await client.close();
  });
}

test('unicode and reserved characters are encoded, not injected into the URL', async () => {
  const { calls, fetcher } = recorder();
  const client = await connect(fetcher);
  const name = 'Café & Søn/../?x=1#frag 株式会社';
  await client.callTool({ name: 'business_lookup', arguments: { name } });
  const url = new URL(calls[0].url);
  assert.equal(url.origin, 'https://knowfirm.com');
  assert.equal(url.pathname, '/v1/business');
  assert.equal(url.searchParams.get('name'), name);
  assert.equal(url.searchParams.get('x'), null);
  assert.equal(url.hash, '');
  await client.close();
});

test('POST tools carry unicode names intact in the JSON body', async () => {
  const { calls, fetcher } = recorder();
  const client = await connect(fetcher);
  const name = 'Ünïcødé "quoted" \\ backslash';
  await client.callTool({ name: 'business_screening', arguments: { name } });
  assert.deepEqual(JSON.parse(calls[0].options.body), { name });
  await client.close();
});
