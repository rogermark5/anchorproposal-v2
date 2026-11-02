require('reflect-metadata');
const { test } = require('node:test'), assert = require('node:assert/strict');
const { Module } = require('@nestjs/common'), { NestFactory, Reflector } = require('@nestjs/core'), { JwtService } = require('@nestjs/jwt');
const { Strategy, ExtractJwt } = require('passport-jwt'), passport = require('passport');
const { JwtAuthGuard } = require('../dist/auth/jwt-auth.guard');
const { JobrightBotService } = require('../dist/job-pool/jobright-bot.service');
const { JobrightBotController, JobrightBotWorkerController, JobrightWorkerGuard } = require('../dist/job-pool/jobright-bot.controller');

test('HTTP: Master-only controls and scoped worker authentication stay separate from user sessions', async t => {
  const secret = 'jobright-http-qa', jwt = new JwtService({ secret }); let workerCalls = 0, managementCalls = 0;
  passport.use('jwt', new Strategy({ jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(), secretOrKey: secret }, (data, done) => done(null, { id: data.role, role: data.role })));
  const workerKey = 'jrbot_' + 'a'.repeat(64), service = {
    ...Object.fromEntries(['status', 'settings', 'rotateKey', 'command'].map(name => [name, async () => { managementCalls++; return { ok: true }; }])),
    authenticate: async header => { if (header !== 'Bearer ' + workerKey) { const { UnauthorizedException } = require('@nestjs/common'); throw new UnauthorizedException(); } return 'digest'; },
    ...Object.fromEntries(['workerConfig', 'heartbeat', 'ingest'].map(name => [name, async () => { workerCalls++; return { ok: true }; }])),
  };
  class TestModule {}
  Module({ controllers: [JobrightBotController, JobrightBotWorkerController], providers: [{ provide: JobrightBotService, useValue: service }, JobrightWorkerGuard] })(TestModule);
  const app = await NestFactory.create(TestModule, { logger: false }); app.useGlobalGuards(new JwtAuthGuard(new Reflector())); await app.listen(0, '127.0.0.1'); t.after(() => app.close());
  const base = (await app.getUrl()) + '/job-pool/jobright-bot';
  const request = (route, token, method = 'GET') => fetch(base + route, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, ...(method === 'GET' ? {} : { body: '{}' }) });
  for (const role of [null, 'ADMIN', 'BIDDER', 'MASTER']) for (const [route, method] of [['', 'GET'], ['', 'PATCH'], ['/key', 'POST'], ['/command', 'POST']]) {
    const before = managementCalls, response = await request(route, role && jwt.sign({ role }), method);
    assert.equal(response.status, role === 'MASTER' ? method === 'POST' ? 201 : 200 : role ? 403 : 401, `${role} ${method} ${route}`);
    if (role !== 'MASTER') assert.equal(managementCalls, before);
  }
  for (const token of [null, jwt.sign({ role: 'MASTER' }), workerKey]) for (const [route, method] of [['/worker?instanceId=1', 'GET'], ['/worker/heartbeat', 'POST'], ['/worker/jobs', 'POST']]) {
    const before = workerCalls, response = await request(route, token, method);
    assert.equal(response.status, token === workerKey ? method === 'POST' ? 201 : 200 : 401);
    if (token !== workerKey) assert.equal(workerCalls, before);
  }
  assert.equal((await request('', workerKey)).status, 401, 'Worker keys cannot manage the bot or access user routes');
});

test('desktop and extension bridges expose management but cannot call worker ingestion routes', async () => {
  const { apiRequest } = require('../../desktop/main/security.cjs'), { apiRoute } = await import('../../extension/src/security.mjs');
  for (const validate of [apiRequest, apiRoute]) {
    for (const [route, method] of [['/job-pool/jobright-bot', 'GET'], ['/job-pool/jobright-bot', 'PATCH'], ['/job-pool/jobright-bot/key', 'POST'], ['/job-pool/jobright-bot/command', 'POST']]) assert.doesNotThrow(() => validate(route, method));
    for (const [route, method] of [['/job-pool/jobright-bot/worker', 'GET'], ['/job-pool/jobright-bot/worker/jobs', 'POST'], ['/job-pool/jobright-bot/worker/heartbeat', 'POST'], ['/job-pool/jobright-bot', 'DELETE']]) assert.throws(() => validate(route, method), /Unsupported/);
  }
});
