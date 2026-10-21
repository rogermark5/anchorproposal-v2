require('reflect-metadata');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Module } = require('@nestjs/common');
const { NestFactory } = require('@nestjs/core');
const { JwtService } = require('@nestjs/jwt');
const { Strategy, ExtractJwt } = require('passport-jwt');
const passport = require('passport');
const { JobPoolController } = require('../dist/job-pool/job-pool.controller');
const { JobPoolService } = require('../dist/job-pool/job-pool.service');

test('HTTP permissions allow all signed-in users to browse and only Master to publish or manage imports', async t => {
  const secret = 'job-pool-test-only'; const jwt = new JwtService({ secret }); let calls = 0;
  passport.use('jwt', new Strategy({ jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(), secretOrKey: secret }, (data, done) => done(null, { id: data.role, role: data.role })));
  const service = Object.fromEntries(['list', 'updates', 'manage', 'updateSettings', 'addSource', 'updateSource', 'sync', 'addJob', 'detail', 'hide', 'apply', 'markApplied', 'markViewed'].map(name => [name, () => { calls++; return { ok: true }; }]));
  class TestModule {}
  Module({ controllers: [JobPoolController], providers: [{ provide: JobPoolService, useValue: service }] })(TestModule);
  const app = await NestFactory.create(TestModule, { logger: false }); await app.listen(0, '127.0.0.1'); t.after(() => app.close());
  const base = await app.getUrl();
  const request = (route, role, method = 'GET') => fetch(base + route, { method, headers: { 'Content-Type': 'application/json', ...(role ? { Authorization: `Bearer ${jwt.sign({ role })}` } : {}) }, ...(method !== 'GET' ? { body: '{}' } : {}) });
  const management = [['/job-pool/manage','GET'],['/job-pool/manage?summary=1','GET'],['/job-pool/manage','PATCH'],['/job-pool/sources','POST'],['/job-pool/sources/source-1','PATCH'],['/job-pool/sync','POST'],['/job-pool','POST'],['/job-pool/jobs/job-1','PATCH']];
  for (const role of [null, 'ADMIN', 'BIDDER', 'MASTER']) {
    for (const route of ['/job-pool', '/job-pool/updates?since=2026-10-17', '/job-pool/jobs/job-1']) assert.equal((await request(route, role)).status, role ? 200 : 401);
    assert.equal((await request('/job-pool/jobs/job-1/applied', role, 'PATCH')).status, role ? 200 : 401);
    assert.equal((await request('/job-pool/jobs/job-1/viewed', role, 'PATCH')).status, role ? 200 : 401);
    for (const [route, method] of management) {
      const before = calls; const response = await request(route, role, method);
      assert.equal(response.status, role === 'MASTER' ? (method === 'POST' ? 201 : 200) : role ? 403 : 401, `${role} ${method} ${route}`);
      if (role !== 'MASTER') assert.equal(calls, before, 'Denied request reached service');
    }
  }
});
test('service checks prevent role escalation and delegate applications to existing permission checks', async () => {
  let saved;
  const job = { id: 'job', title: 'DB title', company: 'DB company', location: 'USA', jobUrl: 'https://example.com/jobs/1', description: 'DB description', workArrangement: 'REMOTE', sourceName: 'Jobicy' };
  const service = new JobPoolService({ systemSetting: { findUnique: async () => null }, jobPoolJob: { findFirst: async () => job } }, { create: async (data, user) => { saved = { data, user }; return { id: 'app' }; } });
  for (const role of ['ADMIN','BIDDER']) for (const operation of [() => service.addJob({role}, {}), () => service.hide({role}, 'job', {hidden:true}), () => service.sync({role}, {}), () => service.updateSettings({role}, {enabled:true}), () => service.addSource({role}, {})]) await assert.rejects(operation(), /Only Master/);
  await assert.rejects(service.apply({role:'MASTER'}, 'job', {profileId:'profile'}), /Master accounts/);
  await assert.rejects(service.apply({role:'BIDDER'}, 'job', {}), /Select one/);
  await service.apply({id:'user',role:'BIDDER'}, 'job', {profileId:'profile', jobTitle:'forged title', jobDescription:'forged description', bidderId:'other'});
  assert.equal(saved.data.jobTitle, 'DB title'); assert.equal(saved.data.jobDescription, 'DB description'); assert.equal(saved.user.id,'user'); assert.equal(saved.data.bidderId, undefined);
  service.applications.create = async () => { throw Error('Profile access denied'); };
  await assert.rejects(service.apply({role:'BIDDER'}, 'job', {profileId:'another-profile'}), /Profile access denied/);
  service.prisma.jobPoolJob.findFirst = async () => null;
  await assert.rejects(service.apply({role:'BIDDER'}, 'job', {profileId:'profile'}), /no longer available/);
});
