require('reflect-metadata');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { DeepseekService } = require('../dist/deepseek/deepseek.service');
const { GenerationProcessor } = require('../dist/generations/generation.processor');
const { parseExperienceTitleMode } = require('../dist/generations/experience-title-mode');
const snapshot = {
  firstName: 'Alex', lastName: 'Example', profileTitle: 'Software Engineer', email: 'alex@example.com', phone: '123', city: 'Seattle', country: 'USA',
  experiences: [
    { title: 'Software Engineer II', company: 'Alpha', startDate: '2022', endDate: '', location: 'Seattle', responsibilities: ['Maintained Java services'] },
    { title: 'Developer', company: 'Beta', startDate: '2019', endDate: '2022', location: 'Boston', responsibilities: ['Built APIs'] },
  ],
  education: [{ degree: 'BSc', institution: 'Example University', startDate: '2015', endDate: '2019' }],
  certifications: [{ name: 'Cloud Certificate', issuer: 'Example', issueDate: '2023' }], links: [{ label: 'LinkedIn', url: 'https://linkedin.com/in/example' }],
};
const compact = () => ({ summary: 'Experienced backend engineer.', skills: [{ Languages: 'Java, SQL' }], experiences: [
  { role: 'Senior Backend Engineer', bullets: ['Improved Java services', 'Built APIs'] },
  { role: 'Backend Developer', bullets: ['Built backend services'] },
] });
const meta = mode => ({ experienceTitleMode: mode, profileSnapshot: structuredClone(snapshot), profileExperiences: structuredClone(snapshot.experiences), candidateName: 'Alex Example', profileTitle: snapshot.profileTitle, jobTitle: 'Senior Backend Engineer' });
const service = () => new DeepseekService({ requireApiKey: () => { throw new Error('No provider calls in this test'); } });

test('compact tailored JSON fills profile facts and maps each role into the renderer title without mutating the profile', () => {
  const before = JSON.stringify(snapshot); const s = service();
  const result = s.parseManualResponse(JSON.stringify(compact()), meta('tailored'));
  assert.deepEqual(result.experiences.map(e => e.title), ['Senior Backend Engineer', 'Backend Developer']);
  assert.deepEqual(result.experiences.map(e => e.company), ['Alpha', 'Beta']);
  assert.deepEqual(result.experiences.map(e => e.dates), ['2022 – Present', '2019 – 2022']);
  assert.equal(result.experiences[0].location, 'Seattle');
  assert.deepEqual(result.experiences[0].bullets, compact().experiences[0].bullets);
  assert.equal(result.contact.email, snapshot.email); assert.equal(result.contact.title, result.experiences[0].title);
  assert.equal(result.contact.linkedin, snapshot.links[0].url); assert.equal(result.contact.address, 'Seattle, USA');
  assert.equal(result.educations[0].institution, 'Example University'); assert.equal(result.certificates[0].name, 'Cloud Certificate');
  assert.equal(result.coverLetter, undefined); assert.equal(JSON.stringify(snapshot), before);
});

test('saved mode retains exact profile positions even when a full-format custom prompt returns tailored roles', () => {
  const output = { ...compact(), contact: { name: 'Alex Example' }, educations: [], certificates: [] };
  const s = service(); const result = s.parseManualResponse(JSON.stringify(output), meta('saved'));
  assert.deepEqual(result.experiences.map(e => e.title), snapshot.experiences.map(e => e.title));
  assert.equal(result.contact.title, result.experiences[0].title);
  assert.equal(s.parseManualResponse(JSON.stringify(output), { ...meta('saved'), experienceTitleMode: undefined }).experiences[0].title, 'Software Engineer II');
  assert.deepEqual(result.experiences[0].bullets, output.experiences[0].bullets);
});

test('tailored imports reject mismatched experience counts, blank or invalid roles, bulletless and reordered full output', () => {
  const s = service();
  for (const change of [o => o.experiences.pop(), o => o.experiences.push(o.experiences[0]), o => o.experiences[0].role = '', o => o.experiences[0].role = { text: 'Engineer' }, o => o.experiences[0].bullets = [], o => o.experiences[0].bullets = [{}], o => o.experiences[0].company = 'Beta']) {
    const output = compact(); change(output);
    assert.throws(() => s.parseManualResponse(JSON.stringify(output), meta('tailored')), /experience|Experience/);
  }
});

test('tailored full and wrapped JSON use profile facts and accept title as a role alias', () => {
  const output = compact(); output.experiences.forEach(e => { e.title = e.role; delete e.role; });
  output.contact = { name: 'Wrong', email: 'wrong@example.com' }; output.educations = [{ institution: 'Wrong' }];
  const result = service().parseManualResponse(JSON.stringify({ result: output }), meta('tailored'));
  assert.equal(result.experiences[0].title, 'Senior Backend Engineer'); assert.equal(result.contact.name, 'Alex Example');
  assert.equal(result.educations[0].institution, 'Example University');
});

test('experience title mode defaults safely and rejects unsupported values', () => {
  assert.equal(parseExperienceTitleMode(undefined), 'saved'); assert.equal(parseExperienceTitleMode('tailored'), 'tailored');
  for (const bad of ['anything', '', null, true, [], {}]) assert.throws(() => parseExperienceTitleMode(bad), e => e.getStatus() === 400);
  assert.match(service().resumeSystemContent('saved'), /exactly as saved/);
  assert.match(service().resumeSystemContent('tailored'), /"role"/);
});

test('tailored custom prompts always receive the saved profile and exact experience count', () => {
  const vars = { profileJson: JSON.stringify(snapshot), jobTitle: 'Backend Engineer', company: 'Hiring', jobDescription: 'Build APIs', experienceTitleMode: 'tailored' };
  const s = service();
  const prompt = s.buildPrompt('Return four experiences. JD: {{jobDescription}}', vars);
  assert.match(prompt, /exactly 2 experiences/);
  assert.match(prompt, /Do not add employers from examples/);
  assert.ok(prompt.includes(JSON.stringify(snapshot)));
  const withPlaceholder = s.buildPrompt('{{profileJson}}\n{{jobDescription}}', vars);
  assert.equal(withPlaceholder.split(JSON.stringify(snapshot)).length - 1, 1, 'do not duplicate the full profile when the template includes it');
  const fixed = s.buildPrompt('JD: {{jobDescription}}', { ...vars, experienceTitleMode: 'saved' });
  assert.ok(fixed.startsWith('JD: Build APIs'));
  assert.ok(fixed.includes('"company":"Hiring"'));
});

test('tailored custom bullet counts above eight are supported without inventing profile rows', () => {
  const output = compact();
  output.experiences[0].bullets = Array.from({ length: 9 }, (_, i) => `Supported achievement ${i + 1}`);
  const s = service();
  assert.equal(s.parseManualResponse(JSON.stringify(output), meta('tailored')).experiences[0].bullets.length, 9);
  assert.match(s.resumeSystemContent('tailored'), /Follow the requested bullet counts/);
});

test('education and certificate placeholders expand to flat arrays with or without template brackets', () => {
  const s = service();
  for (const empty of [false, true]) {
    const profile = structuredClone(snapshot);
    profile.education = empty ? [] : [
      { degree: 'BSc', institution: 'Literal $& and {{jobDescription}} University' },
      { degree: 'MSc', institution: 'Second University' },
    ];
    profile.certifications = empty ? [] : [
      { name: 'Certificate A', issuer: 'Issuer A' }, { name: 'Certificate B', issuer: 'Issuer B' },
    ];
    const vars = { profileJson: JSON.stringify(profile), jobTitle: 'Engineer', company: 'Hiring', jobDescription: 'JD text' };
    for (const wrap of [false, true]) {
      const placeholder = name => wrap ? `[\n{{${name}}}\n]` : `{{${name}}}`;
      const template = `{"educations":${placeholder('educationsJson')},"certificates":${placeholder('certificatesJson')}}`;
      const result = JSON.parse(s.buildPrompt(template, vars).split('\n\nAPPLICATION GENERATION CONTEXT')[0]);
      assert.deepEqual(result.educations, profile.education);
      assert.deepEqual(result.certificates, profile.certifications);
      assert.ok(result.educations.every(row => !Array.isArray(row)));
      assert.ok(result.certificates.every(row => !Array.isArray(row)));
      const tailored = s.buildPrompt(template, { ...vars, experienceTitleMode: 'tailored' }).split('\n\nAPPLICATION GENERATION CONTEXT')[0];
      assert.deepEqual(JSON.parse(tailored), result);
    }
  }
});

test('expanded tailored JSON includes saved education and certificates and keeps older compact responses compatible', () => {
  const s = service();
  const template = JSON.stringify(compact()).slice(0, -1) + ',"educations":[\n{{educationsJson}}\n],"certificates":[\n{{certificatesJson}}\n]}';
  const expanded = s.buildPrompt(template, { profileJson: JSON.stringify(snapshot), jobTitle: 'Engineer', company: 'Hiring', jobDescription: 'Build APIs', experienceTitleMode: 'tailored' });
  const json = expanded.split('\n\nAPPLICATION GENERATION CONTEXT')[0];
  assert.deepEqual(JSON.parse(json).educations, snapshot.education);
  assert.deepEqual(JSON.parse(json).certificates, snapshot.certifications);
  const result = s.parseManualResponse(json, meta('tailored'));
  assert.equal(result.educations[0].institution, 'Example University');
  assert.equal(result.certificates[0].name, 'Cloud Certificate');
  assert.deepEqual(result.educations, s.parseManualResponse(JSON.stringify(compact()), meta('tailored')).educations);
  assert.match(s.resumeSystemContent('tailored'), /"educations":\[\],"certificates":\[\]/);
});

test('a count mismatch identifies the selected profile and directs the user to correct it', () => {
  const single = meta('tailored');
  single.profileExperiences = [single.profileExperiences[0]];
  single.profileSnapshot.experiences = single.profileExperiences;
  assert.throws(() => service().parseManualResponse(JSON.stringify(compact()), single), /Saved profile “Alex Example” has 1 experience, but the response contains 2\. Update the work history in Profiles/);
});

test('queued worker uses the persisted mode and profile snapshot and saves tailored titles in the answer conversation', async () => {
  const s = new DeepseekService({ requireApiKey: async () => 'test-only', getModel: async () => 'test' });
  let system, request; s.chatJson = async (_key, _model, turns) => { system = turns[0].content; request = turns[1].content; return { parsed: { ...compact(), coverLetter: { greeting: 'Dear Hiring Manager,', paragraphs: ['My Java API work is relevant to the Backend Engineer role and its service development responsibilities.'], closing: 'Sincerely,' } }, tokenUsage: 100 }; };
  const updates = [], turns = [];
  const generation = { id: 'g1', creatorId: 'user', experienceTitleMode: 'tailored', profileSnapshotJson: snapshot, promptVersion: { content: '{{profileJson}}\n{{jobDescription}}' }, application: { jobTitle: 'Backend Engineer', company: 'Hiring', jobDescription: 'Build Java APIs.' } };
  const processor = new GenerationProcessor({ resumeGeneration: { findUnique: async () => generation }, generationTurn: { count: async () => 0, createMany: async ({ data }) => turns.push(...data) }, auditEvent: { create: async () => {} } }, { withCancellation: async (_id,work) => work(new AbortController().signal), updateStatus: async (id, status, data) => updates.push({ id, status, data }) }, s);
  await processor.process({ data: { generationId: 'g1' } });
  assert.match(system, /Experience title mode: tailored/); assert.equal(updates.at(-1).status, 'COMPLETED');
  assert.match(request, /exactly 2 experiences/);
  assert.equal(updates.at(-1).data.structuredOutputJson.experiences[0].title, 'Senior Backend Engineer');
  assert.equal(JSON.parse(turns.find(t => t.role === 'assistant').content).experiences[0].company, 'Alpha');
});
