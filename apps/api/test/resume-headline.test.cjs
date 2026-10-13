require('reflect-metadata');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { TemplatesService } = require('../dist/templates/templates.service');
const { DocumentRendererService } = require('../dist/documents/document-renderer.service');
const { GenerationsService } = require('../dist/generations/generations.service');
const { DeepseekService } = require('../dist/deepseek/deepseek.service');
const { bindProfileOutput } = require('../dist/generations/profile-output');
const { encryptResumeLink } = require('../dist/generations/public-resume');
const JSZip = require(require.resolve('jszip', { paths: [require.resolve('docx')] }));

const recentRole = 'Senior Python Fullstack Engineer';
const profile = () => ({
  firstName: 'Alex', lastName: 'Example', profileTitle: 'Senior AI/ML Engineer', email: 'alex@qa.invalid',
  experiences: [{ title: 'Senior Software Engineer', company: 'Example Systems', startDate: '2021', endDate: '2026' }],
  skills: [], education: [], certifications: [],
});
const content = () => ({
  contact: { name: 'Alex Example', title: 'Senior AI/ML Engineer' },
  summary: `${recentRole} with experience building backend services.`,
  skills: [{ Languages: 'TypeScript' }],
  experiences: [{ title: recentRole, company: 'Example Systems', dates: '2021 – 2026', bullets: ['Built backend services.'] }],
  educations: [], certificates: [],
});
const assertHeadline = html => {
  assert.ok(html.includes(`<div class="headline">${recentRole}</div>`));
  assert.ok(html.includes(`${recentRole} — Example Systems`));
  assert.ok(!html.includes('Senior AI/ML Engineer'));
};

test('HTML/PDF preview aligns a stale headline with the first rendered experience, preserving source and summary', () => {
  const source = content(); const before = structuredClone(source);
  source.experiences.push({ title: 'Older Developer', company: 'Previous Co' });
  const html = new TemplatesService({}).renderPreviewHtml(source, {});
  assertHeadline(html);
  assert.ok(html.includes(before.summary));
  assert.equal(source.contact.title, before.contact.title);
  assert.deepEqual(source.experiences[0], before.experiences[0]);
});

test('Word export matches the recent role and does not mutate saved content', async () => {
  const source = content(); const before = structuredClone(source);
  const buffer = await new DocumentRendererService(new TemplatesService({}), null).renderDocx(source, {});
  const xml = await (await JSZip.loadAsync(buffer)).file('word/document.xml').async('string');
  assert.equal((xml.match(new RegExp(recentRole, 'g')) || []).length, 3, 'headline, summary and experience must agree');
  assert.ok(!xml.includes('Senior AI/ML Engineer'));
  assert.deepEqual(source, before);
});

test('profile identity binding keeps the accepted experience role instead of overwriting it with the profile headline', () => {
  const source = content(), snapshot = profile();
  const before = structuredClone({ source, snapshot });
  const bound = bindProfileOutput(source, snapshot);
  assert.equal(bound.contact.title, recentRole);
  assert.equal(bound.contact.name, 'Alex Example');
  assert.equal(bound.contact.email, snapshot.email);
  assert.equal(bound.summary, source.summary);
  assert.deepEqual({ source, snapshot }, before);
});

test('legacy experience aliases align the headline and preserve HTML escaping', () => {
  for (const key of ['title', 'jobTitle', 'position', 'role']) {
    const source = content(); source.experiences = [{ [key]: 'Senior R&D <Lead>', company: 'Example Systems' }];
    const bound = bindProfileOutput(source, profile());
    assert.equal(bound.contact.title, 'Senior R&D <Lead>');
    const html = new TemplatesService({}).renderPreviewHtml(source, {});
    assert.ok(html.includes('<div class="headline">Senior R&amp;D &lt;Lead&gt;</div>'));
  }
});

test('resumes without a recent role retain their saved headline instead of borrowing an older role', async () => {
  for (const experiences of [[], [{ company: 'Current Co' }, { title: 'Older Developer', company: 'Previous Co' }]]) {
    const source = { ...content(), experiences };
    assert.equal(bindProfileOutput(source, profile()).contact.title, profile().profileTitle);
    assert.ok(new TemplatesService({}).renderPreviewHtml(source, {}).includes('<div class="headline">Senior AI/ML Engineer</div>'));
    const buffer = await new DocumentRendererService(new TemplatesService({}), null).renderDocx(source, {});
    const xml = await (await JSZip.loadAsync(buffer)).file('word/document.xml').async('string');
    assert.ok(xml.includes('Senior AI/ML Engineer'));
  }
});

test('automatic generation persists the final role for both saved and tailored modes', async () => {
  for (const mode of ['saved', 'tailored']) {
    const service = new DeepseekService({ requireApiKey: async () => 'test', getModel: async () => 'test' });
    service.chatJson = async () => ({ parsed: { ...content(), coverLetter: {
      greeting: 'Dear Hiring Manager,', paragraphs: ['My backend engineering experience includes building reliable API services.', 'I would welcome a discussion of your engineering requirements.'],
      closing: 'Sincerely,', signatureName: 'Alex Example',
    } }, tokenUsage: 1 });
    const snapshot = profile();
    const result = await service.generate('Use the saved profile.', { profileSnapshot: snapshot, profileExperiences: snapshot.experiences, candidateName: 'Alex Example', experienceTitleMode: mode });
    const expected = mode === 'saved' ? snapshot.experiences[0].title : recentRole;
    assert.equal(result.content.contact.title, expected);
    assert.equal(result.content.experiences[0].title, expected);
  }
});

test('existing stored resumes align private JSON, preview, public links and fresh PDF/Word exports without regenerating AI output', async () => {
  const previousSecret = process.env.RESUME_SHARE_SECRET;
  process.env.RESUME_SHARE_SECRET = 'headline-regression-test-secret-only';
  try {
    const stored = content();
    const generation = { id: 'g', applicationId: 'a', status: 'COMPLETED', version: 1, publicShareNonce: 'n',
      profileSnapshotJson: profile(), structuredOutputJson: stored, templateConfigSnapshotJson: {},
      application: { bidderId: 'owner', company: 'Hiring Co', jobTitle: 'Target job' }, files: [],
    };
    const seen = [];
    const prisma = { resumeGeneration: { findUnique: async () => generation }, user: { findUnique: async () => ({ canDownloadDocuments: true }) },
      generationFile: { create: async ({ data }) => ({ ...data, id: 'new-file' }) } };
    const renderer = { renderAll: async (_applicationId, _generationId, output, _config, _name, [type]) => {
      seen.push({ output, type }); return [{ type, kind: 'RESUME', storagePath: 'qa-output' }];
    } };
    const service = new GenerationsService(prisma, {}, {}, {}, new TemplatesService({}), renderer, {}, {});
    service.assertAppAccess = async () => {};
    const user = { id: 'owner', role: 'MASTER' };
    assert.equal((await service.findOne('g', user)).structuredOutputJson.contact.title, recentRole);
    assertHeadline((await service.previewHtml('g', user)).html);
    const token = encryptResumeLink({ id: 'g', nonce: 'n', expires: Date.now() + 60000 }, process.env.RESUME_SHARE_SECRET);
    assertHeadline((await service.publicResume(token)).html);
    for (const type of ['PDF', 'DOCX']) await service.exportFile('g', user, 'RESUME', type);
    assert.deepEqual(seen.map(row => row.type), ['PDF', 'DOCX']);
    for (const row of seen) assert.equal(row.output.contact.title, recentRole);
    assert.equal(stored.contact.title, 'Senior AI/ML Engineer', 'read/export repair must not rewrite the stored generation');
  } finally {
    if (previousSecret === undefined) delete process.env.RESUME_SHARE_SECRET; else process.env.RESUME_SHARE_SECRET = previousSecret;
  }
});
