require('reflect-metadata');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { normalizedJobUrl } = require('../dist/applications/job-url');
const { ApplicationsService } = require('../dist/applications/applications.service');
const { RulesService } = require('../dist/rules/rules.service');

const actor = { id: 'owner', role: 'ADMIN' };
const application = { id: 'app', profileId: 'profile', jobTitle: 'Engineer', company: 'Example Co', jobDescription: 'Build APIs.', jobUrl: 'https://example.com/jobs/123' };
function fixture() {
  const writes = [];
  const validations = [];
  const db = {
    user: { findUnique: async () => ({ canCreateApplications: true }) },
    application: {
      create: async ({ data }) => { writes.push(data); return data; },
      update: async ({ data }) => { writes.push(data); return data; },
    },
  };
  const service = new ApplicationsService(db, { checkAccess: async () => {} }, {
    validateApplication: async (data) => { validations.push(data); return { warnings: [], duplicates: [] }; },
  }, {});
  service.findOne = async () => application;
  return { service, writes, validations };
}

test('missing, blank and legacy no-link values have no duplicate URL key', () => {
  for (const value of [undefined, null, '', '  ', 'https://', 'http://', ' https:// ']) {
    assert.equal(normalizedJobUrl(value), null);
  }
  for (const value of ['not a URL', 'https://?job=1', 'ftp://example.com/job', 'javascript:alert(1)', false, {}]) {
    assert.throws(() => normalizedJobUrl(value), /valid HTTP or HTTPS URL/);
  }
});

test('create stores no link as null, including payloads from older clients', async () => {
  const { service, writes, validations } = fixture();
  for (const jobUrl of [undefined, null, '', '  ', 'https://', 'http://']) {
    await service.create({ ...application, jobUrl }, actor);
    assert.equal(writes.at(-1).jobUrl, null);
    assert.equal(writes.at(-1).normalizedJobUrl, null);
    assert.equal(validations.at(-1).jobUrl, undefined);
  }
});

test('editing a linked application to no link clears both stored URL fields', async () => {
  const { service, writes, validations } = fixture();
  for (const jobUrl of [null, '', '  ', 'https://', 'http://']) {
    await service.update('app', { jobUrl }, actor);
    assert.equal(writes.at(-1).jobUrl, null);
    assert.equal(writes.at(-1).normalizedJobUrl, null);
    assert.equal(validations.at(-1).jobUrl, undefined);
    assert.equal(validations.at(-1).excludeApplicationId, 'app');
  }
});

test('unrelated edits can save an older application with a no-link placeholder', async () => {
  const { service, writes } = fixture();
  service.findOne = async () => ({ ...application, jobUrl: 'https://' });
  await service.update('app', { jobTitle: 'Senior Engineer' }, actor);
  assert.equal(writes[0].jobTitle, 'Senior Engineer');
});

test('real links still validate, persist and produce a canonical duplicate key', async () => {
  const { service, writes } = fixture();
  const jobUrl = ' https://example.com/jobs/123?utm_source=listing#apply ';
  await service.create({ ...application, jobUrl }, actor);
  assert.equal(writes[0].jobUrl, jobUrl.trim());
  assert.equal(writes[0].normalizedJobUrl, 'example.com/jobs/123');
  await service.update('app', { jobUrl }, actor);
  assert.equal(writes[1].jobUrl, jobUrl.trim());
  const count = writes.length;
  await assert.rejects(service.create({ ...application, jobUrl: 'invalid' }, actor), /HTTP/);
  await assert.rejects(service.update('app', { jobUrl: 'javascript:alert(1)' }, actor), /HTTP/);
  assert.equal(writes.length, count);
});

test('unrelated no-link applications do not generate duplicate-link warnings', async () => {
  let query;
  const service = new RulesService({
    warningRule: { findMany: async () => [] },
    application: { findMany: async (args) => { query = args; return [{ company: 'Other Co', jobUrl: 'https://', normalizedJobUrl: null }]; } },
  });
  const result = await service.validateApplication({ ...application, jobUrl: 'https://' });
  assert.equal(query.where.normalizedCompany, 'example');
  assert.equal(query.where.OR, undefined);
  assert.deepEqual(result.warnings, []);
  assert.equal(service.canGenerate(result.warnings).allowed, true);
});
