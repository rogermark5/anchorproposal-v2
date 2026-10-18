const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { serverUrl, panelBounds, apiRequest, hotkey, DEFAULT_HOTKEY, DESKTOP_API_SERVER, restoreSettings } = require('../main/security.cjs');
const { DesktopSession } = require('../main/session.cjs');
const { consumeEvents, GenerationRunner } = require('../main/generation.cjs');
const secureStorage = { isEncryptionAvailable: () => true, encryptString: value => Buffer.from(`encrypted:${Buffer.from(value).toString('base64')}`), decryptString: value => Buffer.from(value.toString().slice(10), 'base64').toString() };
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const deferred = () => { let resolve; const promise = new Promise(r => resolve = r); return { promise, resolve }; };
test('saved server addresses cannot override production while personal preferences survive upgrades', () => {
  const defaults = { server: DESKTOP_API_SERVER, hotkey: DEFAULT_HOTKEY, alwaysOnTop: true, notifications: true, launchAtLogin: false };
  for (const server of ['http://localhost:3001', 'https://anchorproposal.duckdns.org/backend', 'https://other.example', '', null]) {
    const saved = { server, hotkey: 'Alt+F12', alwaysOnTop: false, notifications: false, launchAtLogin: true };
    assert.deepEqual(restoreSettings(saved, defaults), { ...saved, server: DESKTOP_API_SERVER });
  }
  assert.deepEqual(restoreSettings({ server: 'invalid', hotkey: 'invalid', notifications: 'false' }, defaults), defaults);
  assert.deepEqual(restoreSettings(null, defaults), defaults);
});
async function fixture(t, fetcher) { const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'anchor-test-')); t.after(() => fs.rm(directory, { recursive: true, force: true })); const session = new DesktopSession({ directory, secureStorage, fetcher }); await session.load('https://api.example.test/backend'); return session; }
test('first launch requires an explicit API and never contacts a local server', async () => {
  const session = new DesktopSession({ directory: '', secureStorage, fetcher: () => { throw new Error('Unexpected network request'); } });
  assert.equal(session.server, '');
  await assert.rejects(session.authenticate('/auth/login', {}), /hosted API server URL/);
});
test('authentication, resume retrieval and answer chat use the configured hosted API prefix', async t => {
  const calls = [];
  const session = await fixture(t, async (url, options) => {
    calls.push([url, options.method || 'GET']);
    if (url.endsWith('/auth/login')) return json({ accessToken: 'access', refreshToken: 'refresh', user: { id: 'user' } });
    return json({ saved: true });
  });
  await session.authenticate('/auth/login', { email: 'user@example.test', password: 'test-only' });
  await session.request('/generations/resume-1');
  await session.request('/generations/resume-1/answers', { method: 'POST', body: JSON.stringify({ question: 'Why this role?' }) });
  assert.deepEqual(calls, [
    ['https://api.example.test/backend/auth/login', 'POST'],
    ['https://api.example.test/backend/generations/resume-1', 'GET'],
    ['https://api.example.test/backend/generations/resume-1/answers', 'POST'],
  ]);
  assert.deepEqual(await fs.readdir(session.directory), ['session.json']);
});
test('remote servers require TLS and cannot embed secrets or queries', () => {
  for (const value of ['http://example.com', 'file:///x', 'https://me:secret@example.com', 'https://example.com?key=secret', 'javascript:alert(1)']) assert.throws(() => serverUrl(value));
  assert.equal(serverUrl('https://example.com/api/'), 'https://example.com/api');
  assert.equal(serverUrl('http://127.0.0.1:3001/'), 'http://127.0.0.1:3001');
});
test('shortcut is customizable and defaults to Ctrl Shift Z', () => {
  assert.equal(DEFAULT_HOTKEY, 'Control+Shift+Z'); assert.equal(hotkey('Shift+Control+Z'), DEFAULT_HOTKEY);
  assert.equal(hotkey('Alt+F12'), 'Alt+F12');
  for (const value of ['Z', 'Shift+Z', 'Control+Control+A', 'Control+Delete', 'Control+X+Y']) assert.throws(() => hotkey(value));
});
test('panel stays at the right of small and negative-coordinate monitor work areas', () => {
  for (const area of [{ x: -1920, y: 70, width: 1920, height: 1000 }, { x: 0, y: 0, width: 320, height: 480 }]) for (const compact of [true, false]) {
    const b = panelBounds(area, compact); assert.ok(b.x >= area.x && b.y >= area.y); assert.ok(b.x + b.width <= area.x + area.width && b.y + b.height <= area.y + area.height);
  }
  assert.ok(panelBounds({ x: 0, y: 0, width: 1920, height: 1080 }, true).height < 400);
});
test('renderer requests cannot access credentials, arbitrary hosts or destructive endpoints', () => {
  apiRequest('/applications', 'POST'); apiRequest('/applications/abc', 'PATCH'); apiRequest('/generations/abc/answers', 'POST');
  for (const [route, method] of [['https://evil.example', 'GET'], ['/auth/login', 'GET'], ['/auth/refresh', 'POST'], ['/applications/abc/generations/stream', 'POST'], ['/profiles/../../settings/ai', 'GET'], ['/profiles/%2e%2e/settings/ai', 'GET'], ['//evil.example/profiles', 'GET']]) assert.throws(() => apiRequest(route, method));
  for (const [route, method] of [['/settings/ai', 'GET'], ['/applications/abc', 'DELETE'], ['/profiles', 'POST'], ['/generations/abc/export', 'POST'], ['/profiles/abc', 'PUT'], ['/desktop/manage/releases', 'POST'], ['/users/abc/permissions', 'PATCH']]) apiRequest(route, method);
});

test('document editing and header appearance use only their supported native request methods', () => {
  apiRequest('/settings/document-display', 'PATCH');
  for (const action of ['draft-preview', 'edits']) {
    apiRequest(`/generations/gen-1/${action}`, 'POST');
    for (const method of ['GET', 'PUT', 'PATCH', 'DELETE']) assert.throws(() => apiRequest(`/generations/gen-1/${action}`, method));
  }
  assert.throws(() => apiRequest('/settings/document-display', 'POST'));
  assert.throws(() => apiRequest('/generations/gen-1/edits/all', 'POST'));
});

test('Job Pool supports browsing, master management and applying with exact native routes', () => {
  for (const [route, method] of [['/job-pool/updates?since=2026-10-18T00%3A00%3A00.000Z', 'GET'], ['/job-pool?q=engineer&page=2', 'GET'], ['/job-pool', 'POST'], ['/job-pool/manage', 'GET'], ['/job-pool/manage', 'PATCH'], ['/job-pool/sources', 'POST'], ['/job-pool/sources/source-1', 'PATCH'], ['/job-pool/sync', 'POST'], ['/job-pool/jobs/job-1', 'GET'], ['/job-pool/jobs/job-1', 'PATCH'], ['/job-pool/jobs/job-1/apply', 'POST'], ['/job-pool/jobs/job-1/applied', 'PATCH'], ['/job-pool/jobs/job-1/viewed', 'PATCH']]) apiRequest(route, method);
  for (const [route, method] of [['/job-pool/updates', 'POST'], ['/job-pool/updates', 'PATCH'], ['/job-pool/manage', 'POST'], ['/job-pool/sync', 'GET'], ['/job-pool/jobs/job-1/apply', 'PATCH'], ['/job-pool/jobs/job-1/applied', 'POST'], ['/job-pool/jobs/job-1/viewed', 'POST'], ['/job-pool/sources/source-1', 'DELETE']]) assert.throws(() => apiRequest(route, method));
});
test('only an encrypted refresh token is persisted; access token and password never reach disk', async t => {
  const s = await fixture(t, async () => json({ user: { id: 'test' }, accessToken: 'qa-access-secret', refreshToken: 'qa-refresh-secret' }));
  await s.authenticate('/auth/login', { password: 'qa-password-secret' });
  const stored = await fs.readFile(path.join(s.directory, 'session.json'), 'utf8');
  assert.ok(!stored.includes('qa-')); assert.ok(JSON.parse(stored).encrypted);
  const restored = new DesktopSession({ directory: s.directory, secureStorage }); await restored.load(s.server);
  assert.equal(restored.access, null); assert.equal(restored.refresh, 'qa-refresh-secret');
  const other = new DesktopSession({ directory: s.directory, secureStorage }); await other.load('https://other.example'); assert.equal(other.refresh, null);
});
test('concurrent expired requests rotate the session only once', async t => {
  let refreshes = 0;
  const s = await fixture(t, async (url, options) => {
    if (url.endsWith('/auth/refresh')) { refreshes++; await new Promise(r => setTimeout(r, 30)); return json({ accessToken: 'new', refreshToken: 'refresh-new' }); }
    return options.headers.Authorization === 'Bearer new' ? json({ ok: true }) : json({}, 401);
  });
  await s.saveTokens({ accessToken: 'old', refreshToken: 'refresh-old' });
  const results = await Promise.all(Array.from({ length: 8 }, () => s.request('/auth/me')));
  assert.equal(refreshes, 1); assert.ok(results.every(r => r.ok));
});
test('pending login cannot resurrect a signed-out session', async t => {
  const release = deferred(); const entered = deferred();
  const s = await fixture(t, async () => { entered.resolve(); await release.promise; return json({ accessToken: 'access', refreshToken: 'refresh' }); });
  const login = s.authenticate('/auth/login', {}); await entered.promise; await s.clear(); release.resolve();
  await assert.rejects(login, /session changed/); assert.equal(s.access, null); await assert.rejects(fs.readFile(path.join(s.directory, 'session.json')));
});
test('pending refresh cannot resurrect a signed-out session', async t => {
  const release = deferred(); const entered = deferred();
  const s = await fixture(t, async () => { entered.resolve(); await release.promise; return json({ accessToken: 'access-new', refreshToken: 'refresh-new' }); });
  await s.saveTokens({ accessToken: 'access', refreshToken: 'refresh' });
  const renewal = s.renew(); await entered.promise; await s.clear(); release.resolve(); await assert.rejects(renewal, /session changed/); assert.equal(s.access, null);
});
test('credential encryption failure never falls back to plain text', async t => {
  const s = await fixture(t); s.secureStorage = { isEncryptionAvailable: () => false };
  await assert.rejects(s.saveTokens({ accessToken: 'access', refreshToken: 'refresh' }), /encryption/);
  await assert.rejects(fs.readFile(path.join(s.directory, 'session.json')));
});
test('invalidated sessions are cleared on refresh rejection', async t => {
  const s = await fixture(t, async () => json({}, 401)); await s.saveTokens({ accessToken: 'access', refreshToken: 'refresh' });
  await assert.rejects(s.renew(), /expired/); assert.equal(s.refresh, null);
});
test('progress decoder handles UTF-8 split into individual bytes and heartbeat lines', async () => {
  const bytes = new TextEncoder().encode(': keep alive\r\ndata: {"stage":"generating","message":"résumé 😊"}\r\n\r\ndata: {"stage":"completed"}\n\n'); const events = [];
  await consumeEvents(new ReadableStream({ start(c) { for (const byte of bytes) c.enqueue(Uint8Array.of(byte)); c.close(); } }), e => events.push(e));
  assert.equal(events[0].message, 'résumé 😊'); assert.equal(events[1].stage, 'completed');
});
test('generation starts only once and completes without exposing tokens', async () => {
  const gate = deferred(); const updates = []; let calls = 0;
  const runner = new GenerationRunner({ request: async () => { calls++; await gate.promise; return new Response('data: {"stage":"generating","characters":100}\n\ndata: {"stage":"completed","generationId":"gen-1"}\n\n', { headers: { 'content-type': 'text/event-stream' } }); } }, job => updates.push(job));
  runner.start({ applicationId: 'app-1', title: 'Engineer' }); assert.throws(() => runner.start({ applicationId: 'app-1' }), /already generating/);
  gate.resolve(); await runner.promise; assert.equal(calls, 1); assert.equal(runner.job.stage, 'completed'); assert.equal(runner.active, false); assert.equal(runner.job.generationId, 'gen-1');
});
test('generation reports missing provider settings and interrupted streams', async () => {
  for (const [response, message] of [[json({ message: 'Ask Master to set the API key.' }, 400), /Ask Master/], [new Response('data: {"stage":"generating"}\n\n', { headers: { 'content-type': 'text/event-stream' } }), /connection ended/]]) {
    const runner = new GenerationRunner({ request: async () => response, parse: async r => { throw new Error((await r.json()).message); } }, () => {});
    runner.start({ applicationId: 'app-1' }); await runner.promise; assert.equal(runner.job.stage, 'failed'); assert.match(runner.job.message, message);
  }
});
test('cancel aborts the stream and leaves a recoverable cancelled state', async () => {
  const runner = new GenerationRunner({ request: async (_, options) => new Promise((_, reject) => options.signal.addEventListener('abort', () => reject(new Error('aborted')))) }, () => {});
  runner.start({ applicationId: 'app-1' }); runner.cancel(); await runner.promise; assert.equal(runner.job.stage, 'cancelled'); assert.equal(runner.active, false);
});


test('generation runner leaves experience positions to the server prompt flag', async () => {
  const { GenerationRunner } = require('../main/generation.cjs');
  let body;
  const runner = new GenerationRunner({ request: async (_route, options) => {
    body = JSON.parse(options.body);
    return new Response('data: {"stage":"completed","generationId":"gen-1"}\n\n', { headers: { 'content-type': 'text/event-stream' } });
  } }, () => {});
  assert.equal(runner.active, false);
  runner.start({ applicationId: 'app-1', templateId: 'template-1', experienceTitleMode: 'tailored' });
  await runner.promise;
  assert.equal(body.experienceTitleMode, undefined); assert.equal(runner.job.stage, 'completed');
  runner.start({ applicationId: 'app-1' }); await runner.promise; assert.equal(body.experienceTitleMode, undefined);
});


test('new sharing and private prompt routes allow only their intended methods', () => {
  for (const [route, methods] of [
    ['/settings/generation-workflow', ['GET']],
    ['/profiles/profile-1/generation-preference', ['GET', 'PUT']],
    ['/generations/gen-1/public-link', ['POST', 'DELETE']],
  ]) {
    for (const method of ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']) {
      if (methods.includes(method)) assert.doesNotThrow(() => apiRequest(route, method));
      else assert.throws(() => apiRequest(route, method), /Unsupported/);
    }
  }
});
