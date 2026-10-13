require('reflect-metadata');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { DeepseekService } = require('../dist/deepseek/deepseek.service');
const { GenerationsService } = require('../dist/generations/generations.service');
const { eventData } = require('../dist/deepseek/event-stream');
const output = { contact: { name: 'QA Candidate' }, summary: 'Experienced engineer.', skills: [], experiences: [], educations: [], certificates: [], coverLetter: { greeting: 'Dear Hiring Manager,', paragraphs: ['My engineering experience is relevant to the system development responsibilities described in the job.'], closing: 'Sincerely,' } };
function fixture() {
  const state = { user: { id: 'user-1', role: 'BIDDER' }, permission: true, allowed: true, key: true, experienceTitleMode: 'saved', calls: 0, active: 0, error: null, events: [], saved: [], audits: [] };
  const application = { id: 'app-1', profileId: 'profile-1', bidderId: 'user-1', warnings: [], jobTitle: 'Engineer', company: 'Company', jobDescription: 'Build systems.' };
  const settings = { requireApiKey: async () => { if (!state.key) throw new Error('Ask Master to configure the API key.'); return 'server-only-key'; }, resolveGenerationPrompt: async () => ({ experienceTitleMode: state.experienceTitleMode, prompt: { id: 'prompt-1', content: '{{profileJson}}\n{{jobDescription}}' } }) };
  const prisma = {
    user: { findUnique: async () => ({ canGenerateResumes: state.permission }) },
    application: { findUnique: async () => application },
    resumeGeneration: {
      findUnique: async ({ where }) => state.saved.find(g => g.idempotencyKey === where.idempotencyKey),
      findFirst: async () => state.saved.at(-1), count: async () => state.active,
      create: async ({ data }) => { const row = { id: `gen-${state.saved.length}`, ...data }; state.saved.push(row); return row; },
      update: async ({ where, data }) => Object.assign(state.saved.find(g => g.id === where.id), data),
      updateMany: async ({ where, data }) => { if (where.id) for (const g of state.saved.filter(g => g.id === where.id && g.status === where.status)) Object.assign(g, data); return { count: 1 }; },
    },
    auditEvent: { create: async ({ data }) => state.audits.push(data) }, $queryRaw: async () => [], $transaction: async fn => fn(prisma),
  };
  const deepseek = new DeepseekService(settings);
  deepseek.generate = async (_, __, options) => { state.calls++; options.signal.throwIfAborted(); options.onProgress(1234); if (state.error) throw state.error; return { content: output, tokenUsage: 42, transcript: [{ role: 'system', content: 'System' }, { role: 'user', content: 'User' }, { role: 'assistant', content: JSON.stringify(output) }] }; };
  const service = new GenerationsService(prisma, { checkAccess: async () => {}, findOne: async () => ({ firstName: 'QA', experiences: [] }), buildProfileSnapshot: p => p }, { canGenerate: () => ({ allowed: state.allowed }) }, settings, { resolveDefaultTemplateId: async () => 'template-1', checkAccess: async () => ({ configJson: {} }) }, {}, { add: () => { throw new Error('Desktop should not wait on the queue'); } }, deepseek);
  const run = (key = 'request-key-00000001', signal = new AbortController().signal, emit = event => state.events.push(event), experienceTitleMode) => service.streamDesktopGeneration(application.id, state.user, { idempotencyKey: key, experienceTitleMode }, signal, emit);
  return { state, application, run, deepseek };
}
test('desktop stream saves the resume, conversation and audit with no key in progress events', async () => {
  const f = fixture(); await f.run(); const saved = f.state.saved[0];
  assert.equal(saved.status, 'COMPLETED'); assert.equal(saved.tokenUsage, 42); assert.equal(saved.turns.create.length, 3);
  assert.deepEqual(f.state.events.map(e => e.stage), ['generating', 'generating', 'saving', 'completed']);
  assert.ok(!JSON.stringify(f.state.events).includes('server-only-key')); assert.equal(f.state.audits[0].action, 'RESUME_DESKTOP_GENERATED');
});
test('desktop stream requires Master key, generation permission, ownership and warning approval', async () => {
  for (const deny of [f => f.state.key = false, f => f.state.permission = false, f => f.state.allowed = false, f => f.state.user.role = 'MASTER', f => f.application.bidderId = 'other-user']) {
    const f = fixture(); deny(f); await assert.rejects(f.run()); assert.equal(f.state.calls, 0); assert.equal(f.state.saved.length, 0);
  }
});
test('completed desktop request retries do not create another paid call or version', async () => {
  const f = fixture(); await f.run(); await f.run(); assert.equal(f.state.calls, 1); assert.equal(f.state.saved.length, 1);
  await f.run('request-key-00000002'); assert.equal(f.state.saved[1].version, 2);
});
test('active request keys and concurrency limits reject additional work', async () => {
  const f = fixture(); f.state.active = 2; await assert.rejects(f.run(), /capacity/); assert.equal(f.state.calls, 0);
  f.state.active = 0; f.state.error = new Error('provider interrupted'); await assert.rejects(f.run(), /interrupted/);
  await assert.rejects(f.run(), /already started/); assert.equal(f.state.calls, 1); assert.equal(f.state.saved[0].status, 'FAILED');
});
test('cancellation before a request does not reserve a generation', async () => {
  const f = fixture(); const controller = new AbortController(); controller.abort(); await assert.rejects(f.run(undefined, controller.signal)); assert.equal(f.state.saved.length, 0);
});
test('cancellation during generation is persisted and a late disconnect cannot overwrite completion', async () => {
  const f = fixture(); const controller = new AbortController();
  f.deepseek.generate = async () => { controller.abort(); throw new Error('cancelled'); };
  await assert.rejects(f.run(undefined, controller.signal)); assert.equal(f.state.saved[0].status, 'CANCELLED');
  const g = fixture(); await assert.rejects(g.run(undefined, undefined, event => { if (event.stage === 'completed') throw new Error('disconnect'); })); assert.equal(g.state.saved[0].status, 'COMPLETED');
});
test('provider SSE parser handles UTF-8 byte boundaries, comments and multi-line data', async () => {
  const bytes = new TextEncoder().encode(': heartbeat\r\ndata: {"text":\r\ndata: "résumé 😊"}\r\n\r\ndata: [DONE]\n\n');
  const events = []; for await (const data of eventData(new ReadableStream({ start(c) { for (const b of bytes) c.enqueue(Uint8Array.of(b)); c.close(); } }))) events.push(data);
  assert.equal(JSON.parse(events[0]).text, 'résumé 😊'); assert.equal(events[1], '[DONE]');
});
test('streaming provider call validates JSON, reads usage and keeps key only in the server request', async t => {
  const original = global.fetch; t.after(() => global.fetch = original);
  let request; global.fetch = async (url, options) => { request = { url, ...options }; return new Response(`data: ${JSON.stringify({ choices: [{ delta: { content: JSON.stringify(output) } }] })}\n\ndata: ${JSON.stringify({ choices: [], usage: { total_tokens: 99 } })}\n\ndata: [DONE]\n\n`); };
  const service = new DeepseekService({ requireApiKey: async () => 'only-server-key', getModel: async () => 'configured-model' });
  const progress = []; const result = await service.generate('prompt', {}, { signal: new AbortController().signal, onProgress: n => progress.push(n) });
  assert.equal(result.tokenUsage, 99); assert.ok(progress.at(-1) > 0); assert.equal(JSON.parse(request.body).stream, true); assert.equal(JSON.parse(request.body).thinking.type, 'disabled'); assert.equal(result.content.contact.name, 'QA Candidate'); assert.ok(!JSON.stringify(result).includes('only-server-key'));
});
test('truncated streams, output limits and provider errors fail rather than saving partial JSON', async t => {
  const original = global.fetch; t.after(() => global.fetch = original);
  const service = new DeepseekService({ requireApiKey: async () => 'key', getModel: async () => 'model' });
  for (const response of [new Response('data: {"choices":[{"delta":{"content":"{"}}]}\n\n'), new Response('data: {"choices":[{"finish_reason":"length"}]}\n\n'), new Response('sensitive provider body', { status: 401 })]) {
    global.fetch = async () => response;
    await assert.rejects(service.generate('prompt', {}, { signal: new AbortController().signal, onProgress: () => {} }), e => !e.message.includes('sensitive provider body'));
  }
});

test('desktop stream follows the prompt flag and preserves its mode on a completed retry', async () => {
  const f = fixture(); let received; f.state.experienceTitleMode = 'tailored';
  f.deepseek.generate = async (_, meta) => { received = meta; return { content: output, tokenUsage: 0, transcript: [] }; };
  await f.run(undefined, undefined, undefined, 'saved');
  assert.equal(received.experienceTitleMode, 'tailored'); assert.ok(received.profileSnapshot);
  assert.equal(f.state.saved[0].experienceTitleMode, 'tailored');
  f.state.experienceTitleMode = 'saved'; await f.run(); assert.equal(f.state.saved.length, 1);
  await assert.rejects(f.run('another-request-key', undefined, undefined, 'invalid'), e => e.getStatus() === 400);
});
