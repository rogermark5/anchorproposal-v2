require('reflect-metadata');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { RulesService } = require('../dist/rules/rules.service');
const { contextualWarningText } = require('../dist/rules/warning-context');
const { ApplicationsService } = require('../dist/applications/applications.service');

const rule = (pattern, category = 'REMOTE_CONFLICT') => ({ id: pattern, category, pattern, severity: 'CONFIRM', behavior: 'CONFIRM', isActive: true });
const data = { profileId: 'profile-1', jobTitle: 'Engineer', company: 'Example Co', location: 'Boston', workArrangement: 'HYBRID', jobDescription: 'Build services. This is a hybrid role with two office days per week. Apply today.' };

test('warnings retain the whole matching sentence, original case, and negation', () => {
  const service = new RulesService({});
  const warning = service.scanText('Build APIs. No security clearance is required for this role. Apply today.', [rule('security\\s+clearance', 'CLEARANCE')])[0];
  assert.equal(warning.matchedText, 'No security clearance is required for this role.');
  assert.equal(service.scanText('Benefits are included! This role requires on-site work three days per week. Apply now.', [rule('on[- ]?site')])[0].matchedText, 'This role requires on-site work three days per week.');
});

test('hybrid/onsite warnings prefer the job description over bare metadata', async () => {
  const service = new RulesService({ warningRule: { findMany: async () => [rule('hybrid')] }, application: { findMany: async () => [] } });
  const result = await service.validateApplication(data);
  assert.equal(result.warnings[0].matchedText, 'This is a hybrid role with two office days per week.');
  const metadata = await service.validateApplication({ ...data, workArrangement: 'ONSITE', jobDescription: 'Build services.' });
  assert.equal(metadata.warnings.length, 0);
  service.getRules = async () => [rule('onsite')];
  assert.equal((await service.validateApplication({ ...data, workArrangement: 'ONSITE', jobDescription: 'Build services.' })).warnings[0].matchedText, 'The job is marked as onsite work.');
});

test('duplicate warning explains the existing application and excludes the edited application', async () => {
  let query;
  const service = new RulesService({ warningRule: { findMany: async () => [] }, application: { findMany: async (args) => { query = args; return [{ jobTitle: 'Previous Role', status: 'APPLIED', company: data.company }]; } } });
  const result = await service.validateApplication({ ...data, excludeApplicationId: 'app-being-edited' });
  assert.deepEqual(query.where.id, { not: 'app-being-edited' });
  assert.equal(result.warnings[0].matchedText, 'Duplicate application: this profile already has an application to Example Co, including “Previous Role” (applied). You can continue and generate a resume.');
});

test('old keyword-only warnings are contextualized for existing applications', () => {
  assert.equal(contextualWarningText('HYBRID', 'REMOTE_CONFLICT', data), 'This is a hybrid role with two office days per week.');
  assert.equal(contextualWarningText('Duplicate application to Example Co', 'DUPLICATE', data), 'Duplicate application: this profile already has an application to Example Co.');
  const sentence = 'This is a hybrid role with two office days per week.';
  assert.equal(contextualWarningText(sentence, 'REMOTE_CONFLICT', data), sentence);
});

test('editing warning source fields refreshes warnings atomically and preserves unrelated edits', async () => {
  let validated;
  let update;
  const service = new ApplicationsService({ application: { update: async (args) => { update = args; return args; } } }, {}, {
    validateApplication: async (input) => { validated = input; return { warnings: [{ category: 'REMOTE_CONFLICT', matchedText: 'The job is marked as onsite work.', severity: 'CONFIRM', behavior: 'CONFIRM' }] }; },
  }, {});
  service.findOne = async () => ({ ...data, id: 'app-1' });
  await service.update('app-1', { workArrangement: 'ONSITE' }, { role: 'ADMIN' });
  assert.equal(validated.excludeApplicationId, 'app-1');
  assert.equal(update.data.warnings.create[0].matchedText, 'The job is marked as onsite work.');
  assert.deepEqual(update.data.warnings.deleteMany, {});
  validated = undefined;
  await service.update('app-1', { source: 'LinkedIn' }, { role: 'ADMIN' });
  assert.equal(validated, undefined);
  assert.equal(update.data.warnings, undefined);
});

test('context changes preserve the existing block and review policies', () => {
  const service = new RulesService({});
  assert.equal(service.canGenerate([{ behavior: 'BLOCK' }]).allowed, false);
  assert.equal(service.canGenerate([{ behavior: 'ADMIN_REVIEW' }]).allowed, false);
  assert.equal(service.canGenerate([{ behavior: 'CONFIRM' }]).requiresConfirmation, true);
});
