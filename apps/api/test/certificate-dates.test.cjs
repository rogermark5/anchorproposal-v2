require('reflect-metadata');
const { test } = require('node:test'), assert = require('node:assert/strict'), { createRequire } = require('node:module');
const { certificateDates, formatCertificateLine, DESIGN_THEMES } = require('@anchorproposal/shared');
const { bindProfileOutput } = require('../dist/generations/profile-output'), { editedDocument } = require('../dist/generations/document-edits');
const { DeepseekService } = require('../dist/deepseek/deepseek.service');
const { TemplatesService } = require('../dist/templates/templates.service'), { DocumentRendererService } = require('../dist/documents/document-renderer.service');
require('ts-node').register({ transpileOnly: true, compilerOptions: { jsx: 'react-jsx' } });
const { TEMPLATE_CATALOG } = require('../prisma/template-catalog.ts');
const { editableDocument } = require('../../web/src/components/document-content-editor.tsx');
const JSZip = createRequire(require.resolve('docx'))('jszip');

test('certificate ranges preserve both saved endpoints and tolerate legacy and partial dates', () => {
  for (const [row, expected] of [
    [{ issueDate: 'Mar 2022', expirationDate: 'Mar 2024' }, 'Mar 2022 - Mar 2024'],
    [{ issueDate: ' 2022 ', expirationDate: ' 2024 ', date: '2022' }, '2022 - 2024'],
    [{ startDate: '2022-03-01', endDate: '2024-03-01' }, '2022-03-01 - 2024-03-01'],
    [{ issueDate: '2022', expirationDate: null }, '2022'],
    [{ issueDate: '', expirationDate: '2024' }, '2024'],
    [{ date: '2022' }, '2022'], [{ dates: '2022 - 2024' }, '2022 - 2024'],
    [{ date: '2022', expirationDate: '2024' }, '2022 - 2024'],
    [{ date: '2022 - 2024', expirationDate: '2024' }, '2022 - 2024'],
    [{ date: '2022 – 2024', expirationDate: '2024' }, '2022 – 2024'],
    [{ issueDate: '2022', expirationDate: '2022' }, '2022 - 2022'], [{}, ''],
  ]) assert.equal(certificateDates(row), expected, JSON.stringify(row));
  assert.equal(formatCertificateLine({ name: 'Example Cert', issuer: 'Issuer', issueDate: '2022', expirationDate: '2024' }), 'Example Cert — Issuer (2022 - 2024)');
});

test('saved dates override model dates, and opening/saving the document editor retains the range', () => {
  const source = { name: 'Example Cert', issuer: 'Issuer', issueDate: 'Mar 2022', expirationDate: 'Mar 2024' };
  const profile = { firstName: 'Saved', lastName: 'Candidate', experiences: [], education: [], certifications: [source] };
  const output = { contact: { name: 'Saved Candidate' }, summary: 'Software engineer building reliable services.', skills: [], experiences: [], educations: [], certificates: [{ ...source, expirationDate: '2099', date: '1900' }] };
  const original = structuredClone(output), snapshot = structuredClone(profile), bound = bindProfileOutput(output, profile);
  assert.equal(bound.certificates[0].date, 'Mar 2022 - Mar 2024'); assert.equal(bound.certificates[0].expirationDate, 'Mar 2024');
  const legacy = { ...bound, certificates: [{ ...source, date: 'Mar 2022' }] };
  const edits = editableDocument(legacy); assert.equal(edits.certificates[0].date, 'Mar 2022 - Mar 2024');
  const saved = editedDocument(legacy, profile, edits); assert.equal(saved.certificates[0].date, 'Mar 2022 - Mar 2024');
  assert.equal(certificateDates(saved.certificates[0]), 'Mar 2022 - Mar 2024');
  const correction = editedDocument(legacy, profile, { ...edits, certificates: [{ ...edits.certificates[0], date: 'Apr 2022 - Apr 2024' }] });
  assert.equal(certificateDates(bindProfileOutput(correction, profile, true).certificates[0]), 'Apr 2022 - Apr 2024', 'Saved user corrections remain authoritative');
  const noExpiry = bindProfileOutput(output, { ...profile, certifications: [{ name: 'No Expiry', issueDate: '2022' }] });
  assert.equal(certificateDates(noExpiry.certificates[0]), '2022'); assert.ok(!JSON.stringify(noExpiry.certificates).includes('2099'));
  assert.deepEqual(output, original); assert.deepEqual(profile, snapshot);
  assert.equal(new DeepseekService({}).normalizeCertificate(source).date, 'Mar 2022 - Mar 2024', 'AI response normalization must not discard the end date');
});

test('every built-in template and design theme renders certificate ranges in HTML and Word', async () => {
  const templates = new TemplatesService({}), renderer = new DocumentRendererService(templates, {}), content = templates.getSamplePreviewContent();
  const configs = [...TEMPLATE_CATALOG.map(row => [row.preset, row.configJson]), ...DESIGN_THEMES.map(theme => [theme.id, { pdf: { headerAccent: theme.accent, watermark: theme.watermark, sectionStyle: theme.section } }]),
    ...['single', 'double'].map(layout => [layout, { certifications: { layout } }])];
  assert.ok(TEMPLATE_CATALOG.length >= 14); assert.equal(DESIGN_THEMES.length, 12);
  for (const [name, config] of configs) {
    const html = templates.renderPreviewHtml(content, config);
    for (const range of ['Mar 2022 - Mar 2024', 'Jun 2023 - Jun 2025']) assert.ok(html.includes(range), name + ': HTML ' + range);
    const xml = await (await JSZip.loadAsync(await renderer.renderDocx(content, config))).file('word/document.xml').async('string');
    for (const range of ['Mar 2022 - Mar 2024', 'Jun 2023 - Jun 2025']) assert.ok(xml.includes(range), name + ': DOCX ' + range);
  }
  const hidden = templates.renderPreviewHtml(content, { styles: { showCertDate: false } }); assert.ok(!hidden.includes('Mar 2022 - Mar 2024'), 'Explicit date visibility settings are respected');
});
