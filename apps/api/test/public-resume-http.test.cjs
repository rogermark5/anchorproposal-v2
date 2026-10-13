require('reflect-metadata');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomBytes } = require('node:crypto');
const { Module } = require('@nestjs/common');
const { APP_GUARD, NestFactory } = require('@nestjs/core');
const { PassportModule } = require('@nestjs/passport');
const { ConfigService } = require('@nestjs/config');
const { JwtService } = require('@nestjs/jwt');
const { JwtAuthGuard } = require('../dist/auth/jwt-auth.guard');
const { JwtStrategy } = require('../dist/auth/jwt.strategy');
const { PrismaService } = require('../dist/prisma/prisma.service');
const { PublicResumeController } = require('../dist/generations/public-resume.controller');
const { GenerationsController } = require('../dist/generations/generations.controller');
const { GenerationsService } = require('../dist/generations/generations.service');
const { AnswersService } = require('../dist/generations/answers.service');
const { TemplatesService } = require('../dist/templates/templates.service');
const { bindProfileOutput } = require('../dist/generations/profile-output');
const { encryptResumeLink } = require('../dist/generations/public-resume');

test('public links work through the real HTTP authentication guard, while management remains private', async t => {
  const previousSecret = process.env.RESUME_SHARE_SECRET;
  const secret = randomBytes(32).toString('hex');
  process.env.RESUME_SHARE_SECRET = secret;
  const profile = { firstName: 'Public', lastName: 'Resume Test', email: 'resume@qa.invalid', profileTitle: 'Engineer', experiences: [{ title: 'Engineer', company: 'QA Company', startDate: '2020', responsibilities: 'Built APIs.' }], skills: [], education: [], certifications: [] };
  const generation = { id: 'qa-generation', creatorId: 'owner', status: 'COMPLETED', publicShareNonce: null,
    application: { profileId: 'qa-profile', bidderId: 'owner' }, profileSnapshotJson: profile,
    templateConfigSnapshotJson: {}, promptSnapshot: 'PRIVATE PROMPT MUST NOT LEAK',
    structuredOutputJson: bindProfileOutput({ contact: { name: 'Public Resume Test' }, summary: 'Engineer building reliable services.', skills: [],
      experiences: [{ title: 'Engineer', company: 'QA Company', bullets: ['Built APIs.'] }], educations: [], certificates: [] }, profile) };
  const prisma = {
    resumeGeneration: { findUnique: async ({ where }) => where.id === generation.id ? generation : null, update: async ({ data }) => Object.assign(generation, data) },
    user: { findUnique: async ({ where }) => ['owner', 'other'].includes(where.id) ? { id: where.id, status: 'ACTIVE', role: 'BIDDER', email: `${where.id}@qa.invalid`, firstName: 'QA', lastName: where.id } : null },
  };
  const service = new GenerationsService(prisma, { checkAccess: async () => {} }, {}, {}, new TemplatesService({}), {}, {}, {});
  class HttpTestModule {}
  Module({
    imports: [PassportModule.register({ defaultStrategy: 'jwt' })],
    controllers: [PublicResumeController, GenerationsController],
    providers: [
      { provide: APP_GUARD, useClass: JwtAuthGuard }, JwtStrategy,
      { provide: ConfigService, useValue: { get: () => secret } },
      { provide: PrismaService, useValue: prisma },
      { provide: GenerationsService, useValue: service },
      { provide: AnswersService, useValue: {} },
    ],
  })(HttpTestModule);
  let app;
  try {
    app = await NestFactory.create(HttpTestModule, { logger: false, abortOnError: false });
    await app.listen(0, '127.0.0.1');
    const base = await app.getUrl();
    const jwt = new JwtService({ secret });
    const headers = who => ({ Authorization: `Bearer ${jwt.sign({ sub: who }, { expiresIn: '5m' })}` });
    const request = (route, options = {}) => fetch(base + route, { signal: AbortSignal.timeout(5000), ...options });
    let token;

    await t.test('create, revoke, private JSON and preview require login', async () => {
      for (const [method, route] of [['POST', '/generations/qa-generation/public-link'], ['DELETE', '/generations/qa-generation/public-link'], ['GET', '/generations/qa-generation'], ['GET', '/generations/qa-generation/preview']]) {
        assert.equal((await request(route, { method })).status, 401, `${method} ${route}`);
      }
      assert.equal(generation.publicShareNonce, null);
      assert.equal((await request('/generations/qa-generation/public-link', { method: 'POST', headers: headers('other') })).status, 403);
    });
    await t.test('the creator creates a link that anonymous and stale-session visitors can open', async () => {
      const created = await request('/generations/qa-generation/public-link', { method: 'POST', headers: headers('owner') });
      assert.equal(created.status, 201);
      const share = await created.json(); token = share.path.split('/').pop();
      for (const auth of [undefined, { Authorization: 'Bearer expired-or-invalid-session' }]) {
        const result = await request(`/public/resumes/${token}`, { headers: auth });
        assert.equal(result.status, 200, 'A valid public token must not require a JWT');
        assert.equal(result.headers.get('cache-control'), 'no-store');
        assert.equal(result.headers.get('x-robots-tag'), 'noindex, nofollow');
        assert.equal(result.headers.get('referrer-policy'), 'no-referrer');
        const body = await result.json(); assert.deepEqual(Object.keys(body).sort(), ['html', 'pageSize']);
        assert.match(body.html, /Public Resume Test/); assert.ok(!JSON.stringify(body).includes(generation.promptSnapshot));
      }
    });
    await t.test('invalid, tampered, expired and missing-generation tokens still fail', async () => {
      const tampered = Buffer.from(token, 'base64url'); tampered[15] ^= 1;
      const badTokens = ['invalid-token', tampered.toString('base64url'),
        encryptResumeLink({ id: generation.id, nonce: generation.publicShareNonce, expires: Date.now() - 1 }, secret),
        encryptResumeLink({ id: 'missing', nonce: generation.publicShareNonce, expires: Date.now() + 60000 }, secret)];
      for (const bad of badTokens) assert.equal((await request(`/public/resumes/${bad}`)).status, 404);
    });
    await t.test('only the creator can revoke, and revocation removes public access', async () => {
      assert.equal((await request('/generations/qa-generation/public-link', { method: 'DELETE', headers: headers('other') })).status, 403);
      assert.equal((await request(`/public/resumes/${token}`)).status, 200);
      assert.equal((await request('/generations/qa-generation/public-link', { method: 'DELETE', headers: headers('owner') })).status, 200);
      assert.equal((await request(`/public/resumes/${token}`)).status, 404);
    });
  } finally {
    await app?.close();
    if (previousSecret === undefined) delete process.env.RESUME_SHARE_SECRET; else process.env.RESUME_SHARE_SECRET = previousSecret;
  }
});
