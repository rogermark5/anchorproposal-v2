const { test } = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs/promises'), path = require('node:path'), { randomUUID } = require('node:crypto');
const { JobrightBrowser, BrowserFetchError } = require('../src/browser.cjs');
const { ProgressStore } = require('../src/progress.cjs');
const { BotApi } = require('../src/api.cjs');
const { formatError } = require('../src/diagnostics.cjs');
const { JOBRIGHT_JOBS_URL } = require('@anchorproposal/shared');

const start = Date.now() - 600000;
const job = (externalId, seconds) => ({ externalId, sourceUrl: 'https://jobright.ai/jobs/info/' + externalId, publishedAt: new Date(start + seconds * 1000).toISOString(),
  title: 'Software Engineer', company: externalId + ' Co', location: 'Remote, US', workArrangement: 'REMOTE', description: 'Listing summary.', originalUrl: 'https://careers.example.org/' + externalId });
const settings = { blockedDomains: [], blockedWords: [], intervalMinutes: 2, maxJobsPerScan: 2 };
const config = { runId: 'run-1', startedAt: new Date(start).toISOString(), settings };
const ack = async jobs => jobs.map(row => ({ externalId: row.externalId, status: 'imported' }));
function fixture(rows) {
  const bot = new JobrightBrowser({ profile: 'unused', puppeteer: {}, pause: async () => {} }), reads = [];
  bot.open = async () => {};
  bot.read = async (url, id) => {
    if (!id) { assert.equal(url, JOBRIGHT_JOBS_URL); return { jobs: rows, complete: true }; }
    reads.push(id); const row = rows.find(row => row.externalId === id);
    return { jobs: [{ ...row, description: 'Full detail: responsibilities, qualifications and skills.', salary: '$100k', employmentType: 'Full-time' }] };
  };
  return { bot, reads };
}

test('job limits, persisted receipts, timestamp ties and restarts never skip unprocessed new jobs', async t => {
  const folder = path.resolve('../../tmp/jobright-qa', 'progress-' + randomUUID()); await fs.mkdir(folder, { recursive: true });
  t.after(() => fs.rm(folder, { recursive: true, force: true }));
  const file = path.join(folder, 'seen.json'), store = new ProgressStore(file); await store.load(config.runId);
  const rows = [job('newest', 300), job('middle', 200), job('oldest-new', 100), job('before-watch', -10)], f = fixture(rows), sent = [];
  const scan = () => f.bot.scan(config, { seen: store.ids, checkpoint: store.checkpoint, processed: id => store.record(id), submit: async jobs => { sent.push(...jobs); return ack(jobs); } });
  const first = await scan(); assert.equal(first.checkpoint, null, 'Limit reached with an unprocessed job');
  const second = await scan(); assert.equal(second.checkpoint.externalId, 'newest');
  assert.deepEqual(f.reads, ['newest', 'middle', 'oldest-new']); assert.ok(sent.every(row => row.description.startsWith('Full detail:')));
  assert.equal(sent[0].salary, '$100k'); assert.equal(sent[0].employmentType, 'Full-time');
  await store.advance(second.checkpoint);
  const restarted = new ProgressStore(file); await restarted.load(config.runId, second.checkpoint);
  rows.unshift(job('same-second-new-id', 300), job('later', 400));
  const next = await f.bot.scan(config, { seen: restarted.ids, checkpoint: restarted.checkpoint, processed: id => restarted.record(id), submit: ack });
  assert.deepEqual(f.reads.slice(3), ['same-second-new-id', 'later']); assert.equal(next.checkpoint.externalId, 'later');
  const again = await f.bot.scan({ ...config, checkpoint: next.checkpoint }, { seen: restarted.ids, submit: ack }); assert.equal(again.submitted, 0);
  await restarted.load('run-2'); assert.equal(restarted.ids.size, 0); assert.equal(restarted.checkpoint, null);
});

test('failed detail requests, API failures, stop and incomplete pagination retain the checkpoint', async () => {
  const rows = [job('new', 300), job('retry', 200)], f = fixture(rows), seen = new Set();
  const read = f.bot.read.bind(f.bot); let fail = true;
  f.bot.read = async (url, id) => { if (id === 'retry' && fail) throw new BrowserFetchError('Detail timed out'); return read(url, id); };
  const first = await f.bot.scan(config, { seen, submit: ack }); assert.equal(first.failed, 1); assert.equal(first.checkpoint, null); assert.ok(!seen.has('retry'));
  fail = false; const second = await f.bot.scan(config, { seen, submit: ack }); assert.equal(second.checkpoint.externalId, 'new'); assert.deepEqual(f.reads, ['new', 'retry']);
  const fresh = fixture([job('unacknowledged', 400)]), receipts = new Set();
  await assert.rejects(fresh.bot.scan(config, { seen: receipts, submit: async () => { throw Error('API offline'); } }), /API offline/); assert.equal(receipts.size, 0);
  let stopped = false; const detail = fresh.bot.read.bind(fresh.bot);
  fresh.bot.read = async (url, id) => { const result = await detail(url, id); if (id) stopped = true; return result; };
  const cancelled = await fresh.bot.scan(config, { seen: receipts, stop: () => stopped, submit: async () => { throw Error('Saved after stop'); } });
  assert.equal(cancelled.checkpoint, null); assert.equal(receipts.size, 0);
  const partial = fixture([job('partial', 400)]), readPartial = partial.bot.read.bind(partial.bot);
  partial.bot.read = async (...args) => ({ ...await readPartial(...args), complete: false });
  assert.equal((await partial.bot.scan(config, { submit: ack })).checkpoint, null);
});

test('an incomplete detail cannot be replaced with the listing summary or original link', async () => {
  const f = fixture([job('missing-detail', 300)]), read = f.bot.read.bind(f.bot), seen = new Set();
  f.bot.read = async (url, id) => id ? { jobs: [] } : read(url, id);
  const result = await f.bot.scan(config, { seen, submit: async () => { throw Error('Saved listing fallback'); } });
  assert.equal(result.failed, 1); assert.equal(result.checkpoint, null); assert.equal(seen.size, 0);
});

test('network and gateway failures retry safely and report an actionable error without secrets', async () => {
  const key = 'jrbot_' + 'a'.repeat(64); let calls = 0;
  const offline = new BotApi('http://127.0.0.1:3001', key, async () => { calls++; throw new TypeError(key, { cause: { code: 'ECONNREFUSED' } }); }, { pause: async () => {} });
  await assert.rejects(offline.call('?instanceId=qa'), error => /ECONNREFUSED/.test(error.message) && /anchor-api/.test(error.message) && !error.message.includes(key)); assert.equal(calls, 3);
  calls = 0; const recovery = new BotApi('http://127.0.0.1:3001', key, async () => ++calls < 3 ? new Response('gateway', { status: 502 }) : Response.json({ desired: 'running' }), { pause: async () => {} });
  assert.equal((await recovery.call('?instanceId=qa')).desired, 'running'); assert.equal(calls, 3);
  const html = new BotApi('http://127.0.0.1:3001', key, async () => new Response('<html>login</html>'));
  await assert.rejects(html.call('?instanceId=qa'), /invalid response.*JOBRIGHT_API_URL/);
  const trace = formatError(new Error('Request failed ' + key, { cause: new TypeError('https://user:password@example.org/backend?token=secret') }), 'API request');
  assert.match(trace, /Caused by: TypeError/); assert.match(trace, /https:\/\/example.org\/backend/);
  for (const secret of [key, 'password', 'secret', 'user:']) assert.ok(!trace.includes(secret));
});
