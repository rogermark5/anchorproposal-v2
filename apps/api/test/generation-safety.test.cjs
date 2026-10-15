require('reflect-metadata');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { DeepseekService } = require('../dist/deepseek/deepseek.service');
const { bindProfileOutput, hasProfileIdentityConflict } = require('../dist/generations/profile-output');
const { encryptResumeLink, decryptResumeLink } = require('../dist/generations/public-resume');
const { normalizedJobUrl } = require('../dist/applications/job-url');
const { TemplatesService } = require('../dist/templates/templates.service');
const { SettingsService } = require('../dist/settings/settings.service');
const { GenerationsService } = require('../dist/generations/generations.service');

const profile = { firstName: 'Jason', lastName: 'Glenn', profileTitle: 'Developer', email: 'jason@example.com', phone: '123', city: 'London', country: 'UK',
  skills: [{ category: 'Languages', name: 'Java' }], links: [{ type: 'GitHub', url: 'https://github.com/jason' }],
  experiences: [{ title: 'Engineer', company: 'Jason Co', startDate: '2021', endDate: '2025', responsibilities: 'Built Java services.' }], education: [], certifications: [] };
const letter = { greeting: 'Dear Hiring Manager,', paragraphs: ['My Java service development experience supports the requirements of this role.', 'I would welcome an opportunity to discuss contributing to your team.'], closing: 'Sincerely,', signatureName: 'Basil Bruce Crow' };
const response = () => ({ contact: { name: 'Basil Bruce Crow', email: 'basil@example.com', phone: '999', linkedin: 'https://linkedin.com/other', title: 'CEO' }, summary: 'Java engineer.', skills: [{ Fake: 'Unrelated skills' }], experiences: [{ title: 'Wrong title', company: 'Jason Co', dates: '1900 – Present', location: 'Wrong city', bullets: ['Built Java services.'] }], educations: [], certificates: [], coverLetter: letter });
const meta = mode => ({ profileSnapshot: profile, profileExperiences: profile.experiences, candidateName: 'Jason Glenn', experienceTitleMode: mode });

test('saved/manual generation protects identity and employers while using response JSON skills', () => {
  const service = new DeepseekService({});
  const result = service.parseManualResponse(JSON.stringify(response()), meta('saved'));
  assert.equal(result.contact.name, 'Jason Glenn'); assert.equal(result.contact.email, profile.email); assert.equal(result.contact.phone, profile.phone);
  assert.equal(result.contact.title, result.experiences[0].title); assert.equal(result.contact.linkedin, undefined);
  assert.deepEqual(result.skills, response().skills); assert.deepEqual(result.contact.links, [{ type: 'GitHub', url: 'https://github.com/jason' }]);
  assert.equal(result.experiences[0].title, 'Engineer'); assert.equal(result.experiences[0].dates, '2021 – 2025');
  assert.equal(result.coverLetter.signatureName, 'Jason Glenn');
  const html = new TemplatesService({}).renderPreviewHtml(result, {});
  assert.equal(html.split('https://github.com/jason').length - 1, 1);
  const withoutContact = response(); delete withoutContact.contact; delete withoutContact.skills;
  assert.equal(service.parseManualResponse(JSON.stringify(withoutContact), meta('saved')).contact.name, 'Jason Glenn');
});
test('foreign employer histories and missing experiences fail before storage in both modes', () => {
  const service = new DeepseekService({});
  for (const mode of ['saved', 'tailored']) {
    const bad = response(); bad.experiences[0].company = 'Anchorstacktech';
    assert.throws(() => service.parseManualResponse(JSON.stringify(bad), meta(mode)), /another employer|saved company/);
    bad.experiences = [];
    assert.throws(() => service.parseManualResponse(JSON.stringify(bad), meta(mode)), /exactly 1|has 1 experience/);
  }
});
test('legacy documents are identified as conflicting while database identity remains authoritative', () => {
  assert.equal(hasProfileIdentityConflict(response(), profile), true);
  const safe = bindProfileOutput(response(), profile);
  assert.equal(safe.contact.name, 'Jason Glenn');
  safe.experiences[0].company = 'Other company';
  assert.equal(hasProfileIdentityConflict(safe, profile), true);
});
test('every custom prompt receives the authoritative saved profile, even without placeholders', () => {
  const service = new DeepseekService({});
  for (const experienceTitleMode of ['saved', 'tailored']) {
    const prompt = service.buildPrompt('Write for Basil Bruce Crow', { profileJson: JSON.stringify(profile), jobTitle: 'Developer', company: 'Hiring Co', jobDescription: 'Java services', experienceTitleMode });
    assert.ok(prompt.includes('"firstName":"Jason"')); assert.match(prompt, /authoritative/); assert.match(prompt, /ignore other candidate identities/);
  }
});
test('combined generation makes one call; separate generation makes two and uses its own letter prompt', async () => {
  for (const separate of [false, true]) {
    const calls = [];
    const service = new DeepseekService({ requireApiKey: async () => 'test', getModel: async () => 'test' });
    service.chatJson = async (_key, _model, messages) => { calls.push(messages); return { parsed: calls.length === 1 ? response() : { coverLetter: letter }, tokenUsage: 10 }; };
    const result = await service.generate('Resume instructions', { ...meta('saved'), ...(separate ? { coverLetterPrompt: 'MY SEPARATE LETTER STYLE' } : {}) });
    assert.equal(calls.length, separate ? 2 : 1); assert.equal(result.tokenUsage, separate ? 20 : 10); assert.equal(result.content.coverLetter.signatureName, 'Jason Glenn');
    if (separate) assert.match(calls[1][1].content, /MY SEPARATE LETTER STYLE/);
  }
});
test('job URL validation ignores attribution and preserves distinct job IDs', () => {
  assert.equal(normalizedJobUrl('https://www.example.com/jobs/123/?utm_source=x#apply'), normalizedJobUrl('http://example.com/jobs/123'));
  assert.equal(normalizedJobUrl('https://x.com/job?b=2&a=1'), normalizedJobUrl('https://x.com/job?a=1&b=2'));
  assert.notEqual(normalizedJobUrl('https://x.com/job?id=1'), normalizedJobUrl('https://x.com/job?id=2'));
  assert.throws(() => normalizedJobUrl('javascript:alert(1)'), /HTTP/);
  assert.throws(() => normalizedJobUrl('https://user:secret@x.com/job'), /HTTP/);
});
test('public resume tokens hide IDs, reject tampering, wrong secrets and expiration', () => {
  const secret = 'a strong test secret with sufficient length';
  const payload = { id: 'private-generation-id', nonce: 'revocable-nonce', expires: Date.now() + 10000 };
  const token = encryptResumeLink(payload, secret);
  assert.ok(!token.includes(payload.id)); assert.deepEqual(decryptResumeLink(token, secret), payload);
  const tampered = Buffer.from(token, 'base64url'); tampered[15] ^= 1;
  assert.throws(() => decryptResumeLink(tampered.toString('base64url'), secret));
  assert.throws(() => decryptResumeLink(token, 'different secret'));
  assert.throws(() => decryptResumeLink(encryptResumeLink({ ...payload, expires: Date.now() - 1 }, secret), secret), /Expired/);
});
test('custom template save is private, selects a default, and never updates the shared template', async () => {
  const custom = new Map(); let sharedWrites = 0; let defaults = 0;
  const template = { id: 'base', name: 'Base', configJson: {}, isPublished: true, archivedAt: null };
  const prisma = { templateVersion: { findUnique: async () => template, update: async () => { sharedWrites++; } },
    userTemplateCustomization: { findUnique: async ({ where }) => custom.get(where.userId_templateVersionId.userId) || null,
      upsert: async ({ create }) => { custom.set(create.userId, create); } } };
  const service = new TemplatesService(prisma);
  service.setDefaultTemplate = async () => { defaults++; };
  await service.customize('base', { id: 'user-a', role: 'ADMIN' }, { name: 'My format', configJson: { typography: { baseFontSize: 12 } } });
  assert.equal((await service.checkAccess('base', { id: 'user-a', role: 'ADMIN' })).configJson.typography.baseFontSize, 12);
  assert.deepEqual((await service.checkAccess('base', { id: 'user-b', role: 'ADMIN' })).configJson, {});
  assert.equal(sharedWrites, 0); assert.equal(defaults, 1);
});
test('all three generation modes resolve personal profile prompts and separate mode requires both', async () => {
  const user = { id: 'a', role: 'ADMIN', generationPromptMode: 'user' };
  const prompts = { resume: { id: 'resume', name: 'Resume', content: 'Resume style', experienceTitleMode: 'saved', ownerId: 'a', isPublished: true, archivedAt: null }, cover: { id: 'cover', name: 'Cover', content: 'Cover style', ownerId: 'a', isPublished: true, archivedAt: null } };
  const preference = { resumePromptId: 'resume', coverLetterPromptId: 'cover' };
  const service = new SettingsService({ profile: { findUnique: async () => profile }, user: { findUnique: async () => user }, profileGenerationPreference: { findUnique: async () => preference }, promptVersion: { findFirst: async ({ where }) => Object.values(prompts).find(prompt => prompt.id === where.id && prompt.ownerId === where.ownerId) } });
  service.findProfileAssignedPrompt = async () => ({ profile, prompt: null });
  service.resolvePromptForUser = async () => ({ id: 'default', name: 'Default', content: 'Default style' });
  assert.equal((await service.resolveGenerationPrompt(user, 'p')).prompt.id, 'default');
  user.generationPromptMode = 'profile'; assert.equal((await service.resolveGenerationPrompt(user, 'p')).prompt.id, 'resume');
  user.generationPromptMode = 'separate'; assert.equal((await service.resolveGenerationPrompt(user, 'p')).coverLetterPrompt.id, 'cover');
  preference.coverLetterPromptId = null; await assert.rejects(service.resolveGenerationPrompt(user, 'p'), /Assign both/);
  preference.resumePromptId = 'another-users-prompt'; user.generationPromptMode = 'profile';
  await assert.rejects(service.resolveGenerationPrompt(user, 'p'), /own prompt library/);
});

test('public resume links require creator access, return only rendered resume, and can be revoked', async () => {
  const oldSecret = process.env.RESUME_SHARE_SECRET;
  process.env.RESUME_SHARE_SECRET = 'a test-only share secret with sufficient length';
  try {
    const generation = { id: 'g', creatorId: 'owner', status: 'COMPLETED', profileSnapshotJson: profile,
      structuredOutputJson: bindProfileOutput(response(), profile), templateConfigSnapshotJson: {}, application: { profileId: 'p', bidderId: 'owner' } };
    generation.structuredOutputJson.experiences[0].title = profile.experiences[0].title;
    const prisma = { resumeGeneration: { findUnique: async () => generation, update: async ({ data }) => Object.assign(generation, data) } };
    const templates = { renderPreviewHtml: output => `<p>${output.contact.name}</p>`, pdfLayout: () => ({ pageSize: 'LETTER' }) };
    const service = new GenerationsService(prisma, { checkAccess: async () => {} }, {}, { getDocumentDisplay: async () => ({ showJobTitle: true }) }, templates, {}, {}, {});
    service.assertAppAccess = async () => {};
    await assert.rejects(service.createPublicLink('g', { id: 'other', role: 'ADMIN' }), /creator/);
    const share = await service.createPublicLink('g', { id: 'owner', role: 'ADMIN' });
    const token = share.path.split('/').pop();
    assert.deepEqual(await service.publicResume(token), { html: '<p>Jason Glenn</p>', pageSize: 'LETTER' });
    await service.revokePublicLink('g', { id: 'owner', role: 'ADMIN' });
    await assert.rejects(service.publicResume(token), /no longer available/);
  } finally { if (oldSecret === undefined) delete process.env.RESUME_SHARE_SECRET; else process.env.RESUME_SHARE_SECRET = oldSecret; }
});
