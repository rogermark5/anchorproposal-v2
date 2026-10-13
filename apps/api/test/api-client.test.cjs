const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const source = fs.readFileSync(path.resolve(__dirname, '../../web/src/lib/api.ts'), 'utf8');
const js = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
function client(fetch) {
  const storage = new Map([['accessToken', 'old-access'], ['refreshToken', 'old-refresh']]);
  const context = { exports: {}, process: { env: {} }, fetch, structuredClone, URLSearchParams, window: { location: { href: '' } }, localStorage: {
    getItem: (key) => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, value),
    removeItem: (key) => storage.delete(key),
  } };
  context.require = name => {
    assert.ok(['./desktop-bridge', './download-filename'].includes(name), `Unexpected client import: ${name}`);
    const moduleSource = fs.readFileSync(path.resolve(__dirname, '../../web/src/lib', `${name}.ts`), 'utf8');
    const moduleContext = { ...context, exports: {} };
    vm.runInNewContext(ts.transpileModule(moduleSource, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText, moduleContext);
    return moduleContext.exports;
  };
  vm.runInNewContext(js, context);
  return { api: context.exports.api, storage };
}
const deferred = () => { let resolve; const promise = new Promise((r) => { resolve = r; }); return { promise, resolve }; };

test('parallel expired requests share one refresh and retain the session', async () => {
  let refreshes = 0;
  const entered = deferred(); const release = deferred();
  const { api, storage } = client(async (url, init) => {
    if (url.endsWith('/auth/refresh')) {
      refreshes++; entered.resolve(); await release.promise;
      return json({ accessToken: 'new-access', refreshToken: 'new-refresh' });
    }
    return init.headers.Authorization === 'Bearer new-access' ? json({ id: 'qa' }) : json({}, 401);
  });
  const requests = Promise.all([api.getMe(), api.getMe(), api.getMe()]);
  await entered.promise; release.resolve();
  assert.equal((await requests).length, 3); assert.equal(refreshes, 1);
  assert.equal(storage.get('refreshToken'), 'new-refresh');
});

test('late 401 responses reuse the already refreshed access token', async () => {
  let refreshes = 0; let reads = 0;
  const late = deferred();
  const { api } = client(async (url, init) => {
    if (url.endsWith('/auth/refresh')) { refreshes++; return json({ accessToken: 'new-access', refreshToken: 'new-refresh' }); }
    if (init.headers.Authorization === 'Bearer new-access') return json({ id: 'qa' });
    reads++;
    if (reads === 2) await late.promise;
    return json({}, 401);
  });
  const first = api.getMe(); const second = api.getMe();
  await first; late.resolve(); await second;
  assert.equal(refreshes, 1);
});

test('a pending refresh cannot restore tokens after logout', async () => {
  const entered = deferred(); const release = deferred();
  const { api, storage } = client(async (url) => {
    if (url.endsWith('/auth/refresh')) { entered.resolve(); await release.promise; return json({ accessToken: 'new-access', refreshToken: 'new-refresh' }); }
    return json({}, 401);
  });
  const result = assert.rejects(api.getMe(), /Session expired/);
  await entered.promise; api.clearTokens(); release.resolve(); await result;
  assert.equal(api.getAccessToken(), null); assert.equal(storage.size, 0);
});

test('page requests share in-flight reads and cached results are invalidated after edits and logout', async () => {
  let reads = 0;
  const { api } = client(async (_url, init) => { if (!init.method || init.method === 'GET') reads++; return json([{ id: 'profile' }]); });
  await Promise.all([api.getProfiles(), api.getProfiles(), api.getProfiles()]);
  assert.equal(reads, 1);
  await api.getProfiles(); assert.equal(reads, 1);
  await api.updateProfile('profile', { firstName: 'Changed' });
  await api.getProfiles(); assert.equal(reads, 2);
  api.clearTokens(); await api.getProfiles(); assert.equal(reads, 3);
});
