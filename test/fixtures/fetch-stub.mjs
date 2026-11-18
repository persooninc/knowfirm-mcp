// Preloaded with `node --import` by test/e2e-stdio.test.mjs. Replaces global fetch so the real
// stdio binary runs end to end with no network: every request echoes a deterministic fixture
// containing the URL path, query and the headers the server sent (key masked).
globalThis.fetch = async (url, options = {}) => {
  const u = new URL(url);
  const key = options.headers?.['x-api-key'] ?? '';
  if (u.searchParams.get('name') === 'force-402') return { ok: false, status: 402, headers: new Map(), json: async () => ({}) };
  return {
    ok: true,
    status: 200,
    headers: new Map(),
    json: async () => ({
      stub: true,
      host: u.host,
      path: u.pathname,
      query: Object.fromEntries(u.searchParams),
      method: options.method ?? 'GET',
      keyPrefix: key.slice(0, 8),
      results: [{ name: 'Acme Logistics LLC', ein: '12-3456789', state: 'DE' }],
    }),
  };
};
