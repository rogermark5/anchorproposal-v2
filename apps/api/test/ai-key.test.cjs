require('reflect-metadata');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Reflector } = require('@nestjs/core');
const { SettingsService } = require('../dist/settings/settings.service');
const { SettingsController } = require('../dist/settings/settings.controller');
const { RolesGuard } = require('../dist/auth/roles.guard');
const { GenerationsService } = require('../dist/generations/generations.service');
const { DeepseekService } = require('../dist/deepseek/deepseek.service');

function fixture(role = 'ADMIN') {
  const values = new Map();
  const actor = { id: 'qa-user', role, canGenerateResumes: true };
  const saved = [];
  const queued = [];
  let prepared = 0;
  const prisma = {
    systemSetting: {
      findUnique: async ({ where }) => values.has(where.key) ? { key: where.key, value: values.get(where.key) } : null,
      upsert: async ({ where, create, update }) => { values.set(where.key, values.has(where.key) ? update.value : create.value); },
    },
    user: { findUnique: async () => actor },
    application: { findUnique: async () => ({ id: 'qa-app', bidderId: actor.id, profileId: 'qa-profile', warnings: [] }) },
    resumeGeneration: {
      findUnique: async ({ where }) => saved.find((g) => g.idempotencyKey === where.idempotencyKey),
      findFirst: async () => saved.at(-1),
      create: async ({ data }) => { const row = { id: `qa-gen-${saved.length}`, ...data }; saved.push(row); return row; },
    },
  };
  const settings = new SettingsService(prisma);
  prisma.$transaction = async fn => fn(prisma);
  prisma.$queryRaw = async () => [];
  settings.resolveGenerationPrompt = async () => { prepared++; return { prompt: { id: 'qa-prompt', content: 'Write a resume', version: 1 } }; };
  const deepseek = new DeepseekService(settings);
  const generations = new GenerationsService(
    prisma,
    { checkAccess: async () => {}, findOne: async () => ({ firstName: 'QA' }), buildProfileSnapshot: (p) => p },
    { canGenerate: () => ({ allowed: true }) }, settings,
    { resolveDefaultTemplateId: async () => 'qa-template', checkAccess: async () => ({ configJson: {} }) }, {},
    { add: async (name, data) => { queued.push({ name, data }); } }, deepseek,
  );
  return { values, actor, saved, queued, settings, deepseek, generations, get prepared() { return prepared; } };
}

function environmentKey(t) {
  const original = process.env.DEEPSEEK_API_KEY;
  process.env.DEEPSEEK_API_KEY = 'qa-environment-only-key';
  t.after(() => { if (original === undefined) delete process.env.DEEPSEEK_API_KEY; else process.env.DEEPSEEK_API_KEY = original; });
}

const missingKey = (error) => error.getStatus?.() === 400 && /Ask Master.*API key/.test(error.message);

test('an environment key cannot enable generation or change the displayed key status', async (t) => {
  environmentKey(t);
  const f = fixture();
  for (const value of [undefined, '', ' \n\t ']) {
    if (value === undefined) f.values.delete('deepseek_api_key');
    else f.values.set('deepseek_api_key', value);
    assert.equal(await f.settings.getApiKey(), null);
    assert.equal((await f.settings.getAiSettings()).hasApiKey, false);
    await assert.rejects(f.settings.requireApiKey(), missingKey);
  }
});

for (const role of ['ADMIN', 'BIDDER']) {
  test(`${role} cannot queue or create an automatic resume without Master's saved key`, async (t) => {
    environmentKey(t);
    const f = fixture(role);
    await assert.rejects(f.generations.startGeneration('qa-app', f.actor), missingKey);
    assert.equal(f.saved.length, 0);
    assert.equal(f.queued.length, 0);
    assert.equal(f.prepared, 0);
  });

  test(`${role} can queue a resume once Master has saved a key`, async () => {
    const f = fixture(role);
    await f.settings.updateAiSettings({ apiKey: '  qa-master-saved-key  ' });
    const generation = await f.generations.startGeneration('qa-app', f.actor);
    assert.equal(generation.status, 'QUEUED');
    assert.equal(f.saved.length, 1);
    assert.equal(f.queued.length, 1);
  });
}

test('saving a key trims it and makes Settings and generation agree without revealing it', async (t) => {
  environmentKey(t);
  const f = fixture();
  const result = await f.settings.updateAiSettings({ apiKey: '  qa-master-saved-key  ', model: 'qa-model' });
  assert.deepEqual(result, { hasApiKey: true, model: 'qa-model' });
  assert.equal(await f.settings.requireApiKey(), 'qa-master-saved-key');
  await f.settings.updateAiSettings({ apiKey: '   ', model: 'qa-other-model' });
  assert.equal(await f.settings.requireApiKey(), 'qa-master-saved-key', 'blank key input must keep the current saved key');
});

test('invalid settings input cannot replace the saved key', async () => {
  const f = fixture();
  await f.settings.updateAiSettings({ apiKey: 'qa-master-saved-key' });
  await assert.rejects(f.settings.updateAiSettings({ apiKey: 123 }), (error) => error.getStatus() === 400);
  await assert.rejects(f.settings.updateAiSettings({ apiKey: 'qa-replacement', model: {} }), (error) => error.getStatus() === 400);
  assert.equal(await f.settings.requireApiKey(), 'qa-master-saved-key');
});

test('only Master can read or change platform AI settings', () => {
  const guard = new RolesGuard(new Reflector());
  for (const handler of ['getAiSettings', 'updateAiSettings']) {
    for (const role of ['MASTER', 'ADMIN', 'BIDDER']) {
      const context = {
        getHandler: () => SettingsController.prototype[handler],
        getClass: () => SettingsController,
        switchToHttp: () => ({ getRequest: () => ({ user: { role } }) }),
      };
      assert.equal(guard.canActivate(context), role === 'MASTER', `${handler}: ${role}`);
    }
  }
});

test('the worker provider path and answer chat both reject missing keys before any network call', async (t) => {
  environmentKey(t);
  const fetch = t.mock.method(globalThis, 'fetch', async () => { throw new Error('Unexpected provider request'); });
  const f = fixture();
  await assert.rejects(f.deepseek.generate('Write a resume'), missingKey);
  await assert.rejects(f.deepseek.completeChat([{ role: 'user', content: 'Answer a question' }]), missingKey);
  assert.equal(fetch.mock.callCount(), 0);
});

test('provider calls use the Master-saved key even if an environment key exists', async (t) => {
  environmentKey(t);
  const f = fixture();
  await f.settings.updateAiSettings({ apiKey: 'qa-master-saved-key' });
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    calls.push({ url, options });
    const jsonMode = JSON.parse(options.body).response_format;
    return { ok: true, json: async () => ({ choices: [{ message: { content: jsonMode ? JSON.stringify({ contact: { name: 'QA Candidate' }, summary: 'Engineer', skills: [], experiences: [], educations: [], certificates: [], coverLetter: { greeting: 'Dear Hiring Manager,', paragraphs: ['My engineering experience is relevant to the advertised responsibilities.'], closing: 'Sincerely,' } }) : 'QA answer' } }], usage: { total_tokens: 1 } }) };
  });
  await f.deepseek.generate('Write a resume');
  await f.deepseek.completeChat([{ role: 'user', content: 'Answer a question' }]);
  assert.equal(calls.length, 2);
  for (const call of calls) assert.equal(call.options.headers.Authorization, 'Bearer qa-master-saved-key');
});

test('removing a saved key blocks future requests without invalidating already completed work', async () => {
  const f = fixture();
  await f.settings.updateAiSettings({ apiKey: 'qa-master-saved-key' });
  const original = await f.generations.startGeneration('qa-app', f.actor, undefined, 'qa-existing-request');
  original.status = 'COMPLETED';
  f.values.delete('deepseek_api_key');
  assert.equal((await f.settings.getAiSettings()).hasApiKey, false);
  assert.equal((await f.generations.startGeneration('qa-app', f.actor, undefined, 'qa-existing-request')).id, original.id);
  await assert.rejects(f.generations.startGeneration('qa-app', f.actor), missingKey);
  assert.equal(f.saved.length, 1);
  assert.equal(f.queued.length, 1);
});
