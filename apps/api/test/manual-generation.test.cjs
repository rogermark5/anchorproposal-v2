require('reflect-metadata');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { DeepseekService } = require('../dist/deepseek/deepseek.service');
const { GenerationsService } = require('../dist/generations/generations.service');

const response = () => ({
  contact: { name: 'Alex Example', title: 'Target Job', email: 'alex@example.com' },
  summary: 'Backend engineer building dependable services.',
  skills: [{ Languages: 'Java, TypeScript' }],
  experiences: [{ title: 'Engineer', company: 'Previous Co', dates: '2020 – Present', bullets: ['Built services', 'Improved reliability'] }],
  educations: [], certificates: [],
});

function fixture() {
  const state = {
    user: { id: 'user-1', role: 'BIDDER', email: 'test@example.com', firstName: 'Test', lastName: 'User' },
    permission: true, allowed: true, assigned: true, published: true, template: 'template-1',
    application: { id: 'app-1', profileId: 'profile-1', bidderId: 'user-1', warnings: [], jobTitle: 'Target Job', company: 'Hiring Co', jobDescription: 'Build reliable Java services.' },
    snapshot: { firstName: 'Alex', lastName: 'Example', profileTitle: 'Backend Engineer', experiences: [{ title: 'Engineer', company: 'Previous Co', startDate: '2020' }], education: [], certifications: [], skills: [{ category: 'Languages', name: 'Java' }] },
    prompt: { id: 'prompt-1', content: 'Profile: {{profileJson}}\nJob: {{jobTitle}} at {{company}}\nDescription: {{jobDescription}}', version: 1 },
    saved: [], audits: [], queued: [], providerCalls: 0,
  };
  const provider = () => { state.providerCalls++; throw new Error('Manual generation called AI provider'); };
  const settings = {
    resolveGenerationPrompt: async () => ({ experienceTitleMode: state.prompt.experienceTitleMode || 'saved', prompt: state.prompt, promptName: 'Assigned prompt', profileName: 'Alex Example', usedDefault: false }),
    getApiKey: provider, requireApiKey: provider, getModel: provider,
  };
  const deepseek = new DeepseekService(settings);
  const prisma = {
    user: { findUnique: async () => ({ canGenerateResumes: state.permission }) },
    application: { findUnique: async () => state.application },
    templateVersion: { findUnique: async () => ({ isPublished: state.published }) },
    resumeGeneration: {
      findUnique: async ({ where }) => state.saved.find((g) => g.idempotencyKey === where.idempotencyKey),
      findFirst: async () => state.saved.at(-1),
      create: async ({ data }) => { const generation = { id: `gen-${state.saved.length + 1}`, ...data }; state.saved.push(generation); return generation; },
    },
    auditEvent: { create: async ({ data }) => { state.audits.push(data); } },
    $queryRaw: async () => [{ id: 'app-1' }],
    $transaction: async (fn) => fn(prisma),
  };
  const service = new GenerationsService(
    prisma,
    { checkAccess: async () => {}, findOne: async () => state.snapshot, buildProfileSnapshot: (p) => p },
    { canGenerate: () => ({ allowed: state.allowed }) },
    settings,
    { resolveDefaultTemplateId: async () => state.template, checkAccess: async () => { if (!state.assigned) throw new Error('Template access denied'); return { configJson: {} }; } },
    {},
    { add: async (name, data) => state.queued.push({ name, data }) },
    deepseek,
  );
  const preview = () => service.previewManualGeneration('app-1', state.user);
  const input = (prepared, json = JSON.stringify(response())) => ({ responseJson: json, contextHash: prepared.contextHash, templateId: prepared.templateId, idempotencyKey: 'request-key-00000001' });
  const save = (data) => service.importManualGeneration('app-1', state.user, data);
  return { state, settings, service, deepseek, preview, input, save };
}

test('complete prompt uses the automatic system instructions and expanded profile/job', async () => {
  const f = fixture();
  const prepared = await f.preview();
  assert.ok(prepared.prompt.includes(f.deepseek.resumeSystemContent()));
  for (const text of ['Alex', 'Backend Engineer', 'Target Job', 'Hiring Co', 'Build reliable Java services.']) assert.ok(prepared.prompt.includes(text), text);
  assert.ok(!prepared.prompt.includes('{{'));
  assert.equal(prepared.templateId, 'template-1');
  assert.equal(f.state.saved.length, 0);
  assert.equal(f.state.providerCalls, 0);
});

test('tailored manual preview expands bracketed education and certificate placeholders and saves their profile facts', async () => {
  const f = fixture();
  f.state.prompt.experienceTitleMode = 'tailored';
  f.state.snapshot.experiences = [{ title: 'Engineer', company: 'Previous Co', startDate: '2020', responsibilities: ['Built services'] }];
  f.state.snapshot.education = [{ degree: 'BSc', institution: 'Example University' }];
  f.state.snapshot.certifications = [{ name: 'Example Certificate', issuer: 'Example Issuer' }];
  f.state.prompt.content = '{"summary":"Engineer building services","skills":[{"Languages":"Java"}],"experiences":[{"role":"Backend Engineer","bullets":["Built services"]}],"educations":[{{educationsJson}}],"certificates":[{{certificatesJson}}]}';
  const prepared = await f.preview();
  const json = prepared.prompt.split('\n\nRESUME REQUEST\n')[1].split('\n\nAPPLICATION GENERATION CONTEXT')[0];
  assert.deepEqual(JSON.parse(json).educations, f.state.snapshot.education);
  assert.deepEqual(JSON.parse(json).certificates, f.state.snapshot.certifications);
  const saved = await f.save(f.input(prepared, json));
  assert.equal(saved.structuredOutputJson.educations[0].institution, 'Example University');
  assert.equal(saved.structuredOutputJson.certificates[0].name, 'Example Certificate');
  assert.equal(saved.structuredOutputJson.experiences[0].title, 'Backend Engineer');
  assert.equal(f.state.providerCalls, 0);
});

test('manual import saves a completed version, snapshot, template, conversation and audit without AI or queue', async () => {
  const f = fixture();
  const prepared = await f.preview();
  const saved = await f.save(f.input(prepared, '```json\n' + JSON.stringify(response()) + '\n```'));
  assert.equal(saved.status, 'COMPLETED');
  assert.equal(saved.version, 1);
  assert.ok(saved.completedAt instanceof Date);
  assert.equal(saved.templateVersionId, 'template-1');
  assert.equal(saved.promptVersionId, 'prompt-1');
  assert.equal(saved.structuredOutputJson.contact.title, f.state.snapshot.experiences[0].title);
  assert.equal(saved.structuredOutputJson.coverLetter, undefined, 'resume-only imports must not silently create a default letter');
  assert.deepEqual(saved.profileSnapshotJson, f.state.snapshot);
  assert.deepEqual(saved.turns.create.map((t) => t.purpose), ['resume_system', 'resume_user', 'resume_assistant']);
  assert.ok(prepared.prompt.includes(saved.turns.create[1].content));
  assert.equal(f.state.audits[0].action, 'RESUME_MANUALLY_GENERATED');
  assert.equal(f.state.providerCalls, 0);
  assert.equal(f.state.queued.length, 0);
});

test('retry is idempotent and the next manual request creates the next version', async () => {
  const f = fixture();
  const data = f.input(await f.preview());
  const first = await f.save(data);
  assert.equal((await f.save(data)).id, first.id);
  assert.equal(f.state.saved.length, 1);
  assert.equal(f.state.audits.length, 1);
  const second = await f.save({ ...data, idempotencyKey: 'request-key-00000002' });
  assert.equal(second.version, 2);
});

test('invalid, empty, incomplete and bulletless responses are rejected without saving', async () => {
  const f = fixture();
  const prepared = await f.preview();
  const missingBullets = response();
  delete missingBullets.experiences[0].bullets;
  const missingSkills = response();
  delete missingSkills.skills;
  for (const raw of ['broken JSON', '{}', '[]', 'null', JSON.stringify(missingBullets)]) {
    await assert.rejects(f.save(f.input(prepared, raw)), (error) => error.getStatus() === 400, raw);
  }
  assert.equal(f.state.saved.length, 0);
  assert.equal(f.state.providerCalls, 0);
});

test('wrapped and legacy output and plain-string bullet normalization remain compatible', () => {
  const { deepseek } = fixture();
  assert.equal(deepseek.parseManualResponse(JSON.stringify({ data: response() })).contact.name, 'Alex Example');
  const r = response();
  const legacy = { resume: { header: r.contact, summary: r.summary, skills: r.skills, experience: r.experiences, education: [], certifications: [] } };
  assert.equal(deepseek.parseManualResponse(JSON.stringify(legacy)).experiences.length, 1);
  r.experiences[0].bullets = [{ text: 'Built services' }];
  assert.deepEqual(deepseek.parseManualResponse(JSON.stringify(r)).experiences[0].bullets, ['Built services']);
});

test('stale profile, job and prompt are rejected while retaining zero saved versions', async () => {
  for (const edit of [(s) => { s.snapshot.profileTitle = 'Changed'; }, (s) => { s.application.jobDescription = 'Changed'; }, (s) => { s.prompt.content += '\nChanged'; }]) {
    const f = fixture();
    const data = f.input(await f.preview());
    edit(f.state);
    await assert.rejects(f.save(data), (error) => error.getStatus() === 409);
    assert.equal(f.state.saved.length, 0);
  }
});

test('manual preparation and import enforce permissions, ownership, warnings and template access', async () => {
  for (const deny of [(s) => { s.permission = false; }, (s) => { s.user.role = 'MASTER'; }, (s) => { s.application.bidderId = 'someone-else'; }, (s) => { s.allowed = false; }]) {
    const f = fixture();
    const data = f.input(await f.preview());
    deny(f.state);
    await assert.rejects(f.preview());
    await assert.rejects(f.save(data));
    assert.equal(f.state.saved.length, 0);
  }
  const f = fixture();
  const data = f.input(await f.preview());
  f.state.assigned = false;
  await assert.rejects(f.save(data), /Template access denied/);
  f.state.assigned = true;
  f.state.published = false;
  await assert.rejects(f.save(data), /published templates/);
});

test('automatic generation still queues the resolved prompt and snapshot', async () => {
  const f = fixture();
  f.settings.requireApiKey = async () => 'qa-saved-key';
  const saved = await f.service.startGeneration('app-1', f.state.user);
  assert.equal(saved.status, 'QUEUED');
  assert.equal(saved.templateVersionId, 'template-1');
  assert.equal(saved.promptVersionId, 'prompt-1');
  assert.deepEqual(saved.profileSnapshotJson, f.state.snapshot);
  assert.equal(f.state.queued[0].data.generationId, saved.id);
});


test('tailored manual mode has its own context and persists compact output without changing saved positions', async () => {
  const f = fixture();
  f.state.snapshot.experiences = [{ title: 'Developer', company: 'Original Co', startDate: '2020', endDate: '', responsibilities: ['Built services'] }];
  f.state.snapshot.email = 'alex@example.com';
  const savedPrompt = await f.preview();
  f.state.prompt.experienceTitleMode = 'tailored';
  const tailored = await f.service.previewManualGeneration('app-1', f.state.user);
  assert.equal(tailored.experienceTitleMode, 'tailored'); assert.notEqual(savedPrompt.contextHash, tailored.contextHash);
  assert.match(tailored.prompt, /"role"/);
  const input = { ...f.input(tailored, JSON.stringify({ summary: 'Backend engineer.', skills: [{ Languages: 'Java' }], experiences: [{ role: 'Backend Engineer', bullets: ['Built Java services'] }] })), experienceTitleMode: 'tailored' };
  f.state.prompt.experienceTitleMode = 'saved';
  await assert.rejects(f.save(input), e => e.getStatus() === 409);
  f.state.prompt.experienceTitleMode = 'tailored';
  const result = await f.save(input);
  assert.equal(result.experienceTitleMode, 'tailored'); assert.equal(result.structuredOutputJson.experiences[0].title, 'Backend Engineer');
  assert.equal(result.structuredOutputJson.experiences[0].company, 'Original Co'); assert.equal(result.structuredOutputJson.contact.email, 'alex@example.com');
  assert.equal(f.state.snapshot.experiences[0].title, 'Developer'); assert.equal(f.state.providerCalls, 0);
  assert.equal((await f.save(input)).id, result.id);
  assert.equal((await f.save({ ...input, experienceTitleMode: 'saved' })).id, result.id);
});

test('automatic generation follows the prompt flag, ignores client mode overrides, and keeps retry snapshots', async () => {
  const f = fixture(); f.settings.requireApiKey = async () => 'test-only';
  f.state.prompt.experienceTitleMode = 'tailored';
  const generation = await f.service.startGeneration('app-1', f.state.user, undefined, 'mode-request-key-0001', 'saved');
  assert.equal(generation.experienceTitleMode, 'tailored');
  f.state.prompt.experienceTitleMode = 'saved';
  assert.equal((await f.service.startGeneration('app-1', f.state.user, undefined, 'mode-request-key-0001', 'saved')).experienceTitleMode, 'tailored');
  await assert.rejects(f.service.startGeneration('app-1', f.state.user, undefined, undefined, 'invalid'), e => e.getStatus() === 400);
  await assert.rejects(f.service.previewManualGeneration('app-1', f.state.user, undefined, 'invalid'), e => e.getStatus() === 400);
  assert.equal(f.state.saved.length, 1);
});
