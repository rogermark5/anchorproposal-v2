const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const source = fs.readFileSync(path.resolve(__dirname, '../../web/src/lib/api.ts'), 'utf8');
const js = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
function client(fetch, anchor) {
  const storage = new Map([['accessToken', 'old-access'], ['refreshToken', 'old-refresh']]);
  const context = { exports: {}, process: { env: {} }, fetch, structuredClone, URL, URLSearchParams, FormData, window: { anchor, location: { href: '', origin: 'https://web.example.test' } }, localStorage: {
    getItem: (key) => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, value),
    removeItem: (key) => storage.delete(key),
  } };
  context.require = name => {
    if (name === '@anchorproposal/shared') return require('../../../packages/shared/dist');
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


test('public share URLs use the website origin in browsers and the hosted server in desktop', async () => {
  const share = { path: '/resume/qa-token', expiresAt: '2026-11-12T00:00:00Z' };
  const web = client(async () => json(share));
  assert.equal((await web.api.createResumePublicLink('g')).url, 'https://web.example.test/resume/qa-token');
  const calls = [];
  const desktop = client(() => { throw new Error('Desktop must use its native API bridge'); }, {
    request: async (...args) => { calls.push(args); return share; },
    bootstrap: async () => ({ settings: { server: 'https://anchorproposal.giize.com/backend' } }),
  });
  const result = await desktop.api.createResumePublicLink('g');
  assert.equal(result.url, 'https://anchorproposal.giize.com/resume/qa-token');
  assert.equal(result.path, share.path);
  assert.equal(calls[0][0], '/generations/g/public-link');
  assert.equal(calls[0][1], 'POST');
});

test('a temporary refresh failure preserves credentials and a later request can recover', async () => {
  let unavailable=true;
  const {api,storage}=client(async(url,options)=>{
    if(url.endsWith('/auth/refresh'))return unavailable?json({},503):json({accessToken:'new-access',refreshToken:'new-refresh'});
    return options.headers.Authorization==='Bearer new-access'?json({id:'owner'}):json({},401);
  });
  await assert.rejects(api.getMe(),/busy|restarting/);assert.equal(storage.get('refreshToken'),'old-refresh');
  unavailable=false;assert.equal((await api.getMe()).id,'owner');assert.equal(storage.get('refreshToken'),'new-refresh');
});
