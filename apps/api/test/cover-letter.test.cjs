require('reflect-metadata');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { DeepseekService } = require('../dist/deepseek/deepseek.service');
const { usableCoverLetter } = require('../dist/deepseek/cover-letter');
const { GenerationsService } = require('../dist/generations/generations.service');
const { DocumentsController } = require('../dist/documents/documents.controller');
const letter = () => ({ greeting: 'Dear Hiring Manager,', paragraphs: ['The Backend Engineer position at Hiring Co connects directly with my Java service development experience.', 'I built tested Java APIs and improved query performance, work relevant to your reliable backend services.', 'I would welcome a discussion about contributing these service design and testing skills to Hiring Co.'], closing: 'Sincerely,', signatureName: 'Wrong model name' });
const resume = () => ({ contact: { name: 'Alex Example' }, summary: 'Backend engineer.', skills: [{ Languages: 'Java' }], experiences: [{ title: 'Engineer', company: 'Past Co', bullets: ['Built tested APIs'] }], educations: [], certificates: [] });
const legacy = () => ({ greeting: 'Dear Hiring Manager,', paragraphs: ['I am writing to express my interest in the Backend Engineer position at Hiring Co.', 'My experience and skills, as outlined in my resume, align well with what you are looking for, and I would welcome the opportunity to contribute to your team.', 'Thank you for your time and consideration. I look forward to discussing how I can help.'], closing: 'Sincerely,' });
function ai(responses) {
  const calls = [];
  const service = new DeepseekService({ requireApiKey: async () => 'test-key', getModel: async () => 'test-model' });
  service.chatJson = async (_key, _model, messages, stream) => {
    calls.push({ messages, stream });
    const parsed = responses.shift();
    if (parsed instanceof Error) throw parsed;
    return { parsed, tokenUsage: 10 };
  };
  return { service, calls };
}
test('automatic generation requests a tailored letter and preserves it in one provider call', async () => {
  const f = ai([{ ...resume(), coverLetter: letter() }]);
  const result = await f.service.generate('JD: Build reliable Java APIs at Hiring Co', { candidateName: 'Alex Example' });
  assert.equal(f.calls.length, 1);
  assert.match(f.calls[0].messages[0].content, /coverLetter/);
  assert.match(f.calls[0].messages[0].content, /job description and company/);
  assert.deepEqual(result.content.coverLetter.paragraphs, letter().paragraphs);
  assert.equal(result.content.coverLetter.signatureName, 'Alex Example');
  assert.equal(result.tokenUsage, 10);
});
test('custom prompts receive the target job and company even when their placeholders are omitted', () => {
  const service = new DeepseekService({});
  for (const mode of ['saved', 'tailored']) {
    const prompt = service.buildPrompt('My custom resume instructions', { profileJson: '{}', jobTitle: 'AI Engineer', company: 'Zavvis', jobDescription: 'Improve agentic workflows', experienceTitleMode: mode });
    assert.ok(prompt.includes('"company":"Zavvis"'));
    assert.ok(prompt.includes('"jobTitle":"AI Engineer"'));
    assert.ok(prompt.includes('"jobDescription":"Improve agentic workflows"'));
  }
});
test('missing or legacy letters get one focused repair, retain resume content, tokens and conversation', async () => {
  for (const omitted of [undefined, legacy(), { paragraphs: [] }]) {
    const f = ai([{ ...resume(), coverLetter: omitted }, { coverLetter: letter() }]);
    const signal = new AbortController().signal;
    const stream = { signal, onProgress() {} };
    const result = await f.service.generate('JD: Build reliable Java APIs at Hiring Co', { candidateName: 'Alex Example' }, stream);
    assert.equal(f.calls.length, 2);
    assert.equal(f.calls[1].stream.signal, signal);
    assert.match(f.calls[1].messages.at(-1).content, /Do not rewrite the resume/);
    assert.match(f.calls[1].messages[1].content, /Hiring Co/);
    assert.equal(result.content.summary, resume().summary);
    assert.deepEqual(result.content.coverLetter.paragraphs, letter().paragraphs);
    assert.equal(result.tokenUsage, 20);
    assert.equal(result.transcript.length, 5);
    assert.deepEqual(JSON.parse(result.transcript.at(-1).content).coverLetter, result.content.coverLetter);
  }
});
test('invalid repair and provider failure never substitute a default or loop indefinitely', async () => {
  for (const repair of [{}, { coverLetter: legacy() }, new Error('provider failed')]) {
    const f = ai([resume(), repair]);
    await assert.rejects(f.service.generate('JD'), /valid tailored cover letter|provider failed/);
    assert.equal(f.calls.length, 2);
  }
});
test('manual import supports tailored letter JSON and resume-only responses without provider calls', () => {
  const s = new DeepseekService({ requireApiKey() { throw new Error('Must not call provider'); } });
  assert.equal(s.parseManualResponse(JSON.stringify(resume())).coverLetter, undefined);
  const full = s.parseManualResponse(JSON.stringify({ ...resume(), coverLetter: letter() }), { candidateName: 'Alex Example' });
  assert.equal(full.coverLetter.signatureName, 'Alex Example');
  assert.deepEqual(full.coverLetter.paragraphs, letter().paragraphs);
  for (const bad of [legacy(), { greeting: '', paragraphs: [' '], closing: '' }, 'Plain text letter']) {
    assert.throws(() => s.parseManualResponse(JSON.stringify({ ...resume(), coverLetter: bad })), /coverLetter must contain/);
  }
});
test('wrapped legacy resume output preserves a nested cover letter', () => {
  const s = new DeepseekService({});
  const result = s.parseManualResponse(JSON.stringify({ resume: { header: { name: 'Alex Example' }, ...resume(), coverLetter: letter() } }), { candidateName: 'Alex Example' });
  assert.deepEqual(result.coverLetter.paragraphs, letter().paragraphs);
});
test('exact historical default text and blank letters are rejected, while specific letters remain usable', () => {
  for (const value of [null, undefined, legacy(), { greeting: 'Hi', paragraphs: [' '], closing: 'Thanks' }, { greeting: 'Hi', paragraphs: ['I am writing to express my interest in the Engineer role at Hiring Co.'], closing: 'Thanks' }]) assert.equal(usableCoverLetter(value), undefined);
  assert.ok(usableCoverLetter(letter()));
});
test('cover exports reject absent or old defaults before rendering or deleting existing files; resume export remains available', async () => {
  for (const cover of [undefined, legacy(), letter()]) {
    const output = { ...resume(), coverLetter: cover };
    let rendered, deleted = 0;
    const generation = { id: 'g1', applicationId: 'a1', version: 1, status: 'COMPLETED', structuredOutputJson: output, profileSnapshotJson: { firstName: 'Alex', lastName: 'Example' }, application: { bidderId: 'u1', profileId: 'p1', jobTitle: 'Backend Engineer', company: 'Hiring Co' }, templateVersion: { configJson: {} }, files: [{ id: 'old', kind: 'COVER_LETTER', type: 'PDF' }] };
    const prisma = { user: { findUnique: async () => ({ canDownloadDocuments: true }) }, resumeGeneration: { findUnique: async () => generation }, generationFile: { delete: async () => { deleted++; }, create: async ({ data }) => ({ id: 'new', ...data }) } };
    const renderer = { renderCoverLetter: async (_a, _g, data) => { rendered = data; return [{ type: 'PDF', kind: 'COVER_LETTER', filename: 'cover.pdf', storagePath: 'cover.pdf' }]; }, renderAll: async () => [{ type: 'PDF', kind: 'RESUME', filename: 'resume.pdf', storagePath: 'resume.pdf' }] };
    const s = new GenerationsService(prisma, { checkAccess: async () => {} }, {}, { getTimeZone: async () => ({timeZone:'UTC'}) }, {}, renderer, {}, {});
    const user = { id: 'u1', role: 'BIDDER' };
    if (!usableCoverLetter(cover)) {
      await assert.rejects(s.exportFile('g1', user, 'COVER_LETTER', 'PDF'), /no tailored cover letter/);
      assert.equal(rendered, undefined); assert.equal(deleted, 0);
    } else {
      assert.equal((await s.exportFile('g1', user, 'COVER_LETTER', 'PDF')).filename, 'Alex Example_cover letter.pdf');
      assert.deepEqual(rendered.paragraphs, cover.paragraphs); assert.equal(rendered.signatureName, 'Alex Example');
    }
    assert.equal((await s.exportFile('g1', user, 'RESUME', 'PDF')).filename, 'Alex Example.pdf');
  }
});
test('cached default cover PDFs cannot bypass validation by downloading their file ID', async () => {
  let reads = 0;
  const controller = new DocumentsController({ generationFile: { findUnique: async () => ({ kind: 'COVER_LETTER', generation: { application: { bidderId: 'u1' }, structuredOutputJson: { coverLetter: legacy() } } }) }, user: { findUnique: async () => ({ canDownloadDocuments: true }) } }, { readFile: async () => { reads++; } });
  await assert.rejects(controller.download('f1', { user: { id: 'u1', role: 'BIDDER' } }, {}), /no tailored cover letter/);
  assert.equal(reads, 0);
});
