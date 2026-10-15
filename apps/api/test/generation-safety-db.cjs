require('reflect-metadata');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { ConfigModule } = require('@nestjs/config');
const { PrismaClient } = require('@prisma/client');
const { SettingsService } = require('../dist/settings/settings.service');
const { ProfilesService } = require('../dist/profiles/profiles.service');
const { TemplatesService } = require('../dist/templates/templates.service');
const { ApplicationsService } = require('../dist/applications/applications.service');
const { RulesService } = require('../dist/rules/rules.service');
const { GenerationsService } = require('../dist/generations/generations.service');
const { DeepseekService } = require('../dist/deepseek/deepseek.service');

(async () => {
  await ConfigModule.forRoot();
  const prisma = new PrismaClient();
  const rollback = new Error('Rollback generation QA fixtures');
  const previousSecret = process.env.RESUME_SHARE_SECRET;
  process.env.RESUME_SHARE_SECRET = 'generation-qa-only-secret-with-enough-length';
  try {
    try {
      await prisma.$transaction(async tx => {
        const db = new Proxy(tx, { get: (target, key) => key === '$transaction' ? (task) => typeof task === 'function' ? task(db) : Promise.all(task) : target[key] });
        const marker = randomUUID();
        const actor = await tx.user.create({ data: { firstName: 'QA', lastName: 'Owner', email: `${marker}@qa.invalid`, role: 'ADMIN', passwordHash: 'not-login-capable' } });
        const other = await tx.user.create({ data: { firstName: 'QA', lastName: 'Other', email: `${marker}-other@qa.invalid`, role: 'ADMIN', passwordHash: 'not-login-capable' } });
        const profile = await tx.profile.create({ data: { firstName: 'Jason', lastName: 'Glenn', email: 'jason@qa.invalid', profileTitle: 'Database developer',
          experiences: { create: [{ title: 'Engineer', company: 'Jason Employer', startDate: '2020', endDate: '2025', responsibilities: 'Built APIs.' }] },
          skills: { create: [{ category: 'Languages', name: 'Java' }] } }, include: { experiences: true, education: true, skills: true, certifications: true, links: true } });
        const settings = new SettingsService(db); const profiles = new ProfilesService(db, settings); const templates = new TemplatesService(db);
        const resumePrompt = await settings.createLibraryPrompt(actor, { name: 'QA resume', content: 'Use the saved database candidate. Write summary, experiences, educations and certificates.' });
        const coverPrompt = await settings.createLibraryPrompt(actor, { name: 'QA cover', content: 'Write a concise evidence-based letter.', documentKind: 'cover-letter' });
        await settings.saveProfileGenerationPreference(profile.id, actor, { resumePromptId: resumePrompt.id, coverLetterPromptId: coverPrompt.id });
        await settings.setPromptAssignmentMode(actor, 'separate');
        assert.equal((await settings.resolveGenerationPrompt(actor, profile.id)).coverLetterPrompt.id, coverPrompt.id);
        await assert.rejects(settings.saveProfileGenerationPreference(profile.id, other, { resumePromptId: resumePrompt.id }), /own prompt library/);
        console.log('PASS persisted prompt modes and ownership');
        for (const viewer of [other, {id: other.id, role:'MASTER'}]) {
          assert.equal((await settings.listAssignablePrompts(viewer)).length,0);
          await assert.rejects(settings.updateLibraryPrompt(viewer,resumePrompt.id,{content:'Changed'}));
          await assert.rejects(settings.publishOwnPrompt(viewer,resumePrompt.id));
        }
        await settings.setAnswerPrompt('Owner only answer instructions',actor.id);
        assert.notEqual(await settings.getAnswerPrompt(other.id),'Owner only answer instructions');
        const aDefault=await settings.resolvePromptForUser(actor);const bDefault=await settings.resolvePromptForUser(other);
        assert.notEqual(aDefault.id,bDefault.id);assert.equal(aDefault.ownerId,actor.id);assert.equal(bDefault.ownerId,other.id);
        console.log('PASS private libraries, editing, publishing, independent defaults and answer prompts');

        const base = await tx.templateVersion.create({ data: { name: 'QA base template', isPublished: true, configJson: {} } });
        await templates.customize(base.id, actor, { name: 'QA private style', configJson: { typography: { baseFontSize: 12 } } });
        assert.equal((await templates.checkAccess(base.id, actor)).configJson.typography.baseFontSize, 12);
        assert.deepEqual((await templates.checkAccess(base.id, other)).configJson, {});
        assert.deepEqual((await tx.templateVersion.findUnique({ where: { id: base.id } })).configJson, {});
        console.log('PASS private default customization leaves shared template unchanged');

        const apps = new ApplicationsService(db, profiles, new RulesService(db), {});
        const application = await apps.create({ profileId: profile.id, jobTitle: 'Developer', company: 'Hiring Co', jobDescription: 'Build Java APIs', jobUrl: 'https://example.com/jobs/123?utm_source=test' }, actor);
        const duplicate = await apps.create({ profileId: profile.id, jobTitle: 'Developer', company: 'Hiring Co', jobDescription: 'Build Java APIs', jobUrl: 'https://www.example.com/jobs/123/#apply' }, actor);
        assert.ok(duplicate.warnings.some(w => w.category === 'DUPLICATE' && w.behavior === 'CONFIRM'));
        assert.equal(new RulesService(db).canGenerate(duplicate.warnings).allowed, true);
        await assert.rejects(apps.update(application.id, { jobUrl: 'javascript:alert(1)' }, actor), /HTTP/);
        console.log('PASS duplicate links allow generation after confirmation, invalid URLs still fail');

        const noLink = await apps.create({ profileId: profile.id, jobTitle: 'Engineer', company: 'No Link Co', jobDescription: 'Build APIs', jobUrl: '' }, actor);
        const legacyNoLink = await apps.create({ profileId: profile.id, jobTitle: 'Engineer', company: 'Other No Link Co', jobDescription: 'Build APIs', jobUrl: 'https://' }, actor);
        for (const saved of [noLink, legacyNoLink]) {
          assert.equal(saved.jobUrl, null); assert.equal(saved.normalizedJobUrl, null);
          assert.ok(!saved.warnings.some(w => w.category === 'DUPLICATE'));
          assert.equal(new RulesService(db).canGenerate(saved.warnings).allowed, true);
        }
        await apps.update(noLink.id, { jobUrl: 'https://example.com/jobs/456' }, actor);
        await apps.update(noLink.id, { jobUrl: '' }, actor);
        const cleared = await tx.application.findUnique({ where: { id: noLink.id } });
        assert.equal(cleared.jobUrl, null); assert.equal(cleared.normalizedJobUrl, null);
        console.log('PASS no-link create, legacy clients, URL removal and generation eligibility');

        const snapshot = profiles.buildProfileSnapshot(profile);
        const output = new DeepseekService(settings).parseManualResponse(JSON.stringify({ contact: { name: 'Basil Bruce Crow', email: 'wrong@qa.invalid' }, summary: 'Java developer.',
          experiences: [{ title: 'Wrong role', company: 'Jason Employer', bullets: ['Built APIs.'] }], educations: [], certificates: [],
          coverLetter: { greeting: 'Dear Hiring Manager,', paragraphs: ['My API implementation work is relevant to your Java services.', 'I welcome a discussion of your engineering requirements.'], closing: 'Sincerely,', signatureName: 'Wrong name' } }),
          { experienceTitleMode: 'saved', profileSnapshot: snapshot, profileExperiences: snapshot.experiences, candidateName: 'Jason Glenn' });
        assert.equal(output.contact.name, 'Jason Glenn'); assert.equal(output.contact.email, 'jason@qa.invalid');
        const generation = await tx.resumeGeneration.create({ data: { applicationId: application.id, creatorId: actor.id, status: 'COMPLETED', profileSnapshotJson: snapshot, structuredOutputJson: output,
          promptVersionId: resumePrompt.id, promptSnapshot: resumePrompt.content, coverLetterPromptSnapshot: coverPrompt.content, templateVersionId: base.id, templateConfigSnapshotJson: (await templates.checkAccess(base.id, actor)).configJson } });
        const generations = new GenerationsService(db, profiles, {}, settings, templates, {}, {}, {});
        const rendered = await generations.previewHtml(generation.id, actor);
        assert.match(rendered.coverLetterHtml,/jason@qa.invalid/);
        const documentView=await generations.findOne(generation.id,actor);
        assert.equal(documentView.promptSnapshot,undefined);assert.equal(documentView.promptVersion,undefined);
        assert.match(rendered.html, /Jason Glenn/); assert.ok(!rendered.html.includes('Basil Bruce Crow'));
        assert.ok(!rendered.html.includes('border: 1px solid'));
        const link = await generations.createPublicLink(generation.id, actor);
        assert.match((await generations.publicResume(link.path.split('/').pop())).html, /Jason Glenn/);
        await generations.revokePublicLink(generation.id, actor);
        await assert.rejects(generations.publicResume(link.path.split('/').pop()), /no longer available/);
        console.log('PASS saved identity, frozen template, encrypted public view and revocation');
        throw rollback;
      }, { timeout: 120000 });
    } catch (error) { if (error !== rollback) throw error; }
    console.log('All database QA fixtures rolled back.');
  } finally {
    if (previousSecret === undefined) delete process.env.RESUME_SHARE_SECRET; else process.env.RESUME_SHARE_SECRET = previousSecret;
    await prisma.$disconnect();
  }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
