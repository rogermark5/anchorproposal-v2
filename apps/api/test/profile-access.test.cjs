require('reflect-metadata');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { timeZoneOffset } = require('../../../packages/shared/dist');
const { ProfilesService } = require('../dist/profiles/profiles.service');
const { UsersService } = require('../dist/users/users.service');
const { profileAccessWhere } = require('../dist/common/utils/profile-access');
const admin = { id: 'admin-a', role: 'ADMIN' }, master = { id: 'master', role: 'MASTER' };

test('GMT offsets include DST transitions, zero and fractional hours', () => {
  const winter = new Date('2026-01-15T12:00:00Z'), summer = new Date('2026-07-15T12:00:00Z');
  for (const [zone, at, expected] of [
    ['UTC', winter, 'GMT+00:00'], ['America/Los_Angeles', winter, 'GMT-08:00'],
    ['America/Los_Angeles', summer, 'GMT-07:00'], ['Europe/London', winter, 'GMT+00:00'],
    ['Europe/London', summer, 'GMT+01:00'], ['Asia/Kolkata', winter, 'GMT+05:30'],
    ['Asia/Kathmandu', winter, 'GMT+05:45'], ['America/St_Johns', winter, 'GMT-03:30'],
  ]) assert.equal(timeZoneOffset(zone, at), expected, zone);
});

test('Admin scope requires ownership or explicit Master grant; bidders retain assignments', () => {
  assert.deepEqual(profileAccessWhere(master), {});
  assert.deepEqual(profileAccessWhere(admin), { OR: [{ ownerId: admin.id }, { assignments: { some: { userId: admin.id, activeTo: null, grantedByMaster: true } } }] });
  assert.deepEqual(profileAccessWhere({ id: 'bidder', role: 'BIDDER' }), { assignments: { some: { userId: 'bidder', activeTo: null } } });
});

test('all profile mutations and default selection reject foreign profiles before writing', async () => {
  const service = new ProfilesService({ profile: { findFirst: async () => null } }, {});
  for (const call of [() => service.findOne('foreign', admin), () => service.update('foreign', {}, admin),
    () => service.archive('foreign', admin), () => service.clone('foreign', admin),
    () => service.setDefaultProfile('foreign', admin), () => service.saveGenerationPreference('foreign', admin, {})]) {
    await assert.rejects(call(), /not owned by or assigned/);
  }
});

test('creator ownership cannot be overridden through posted fields or clone data', async () => {
  let created;
  const service = new ProfilesService({ profile: { create: async args => { created = args.data; return created; } } }, {});
  await service.create({ firstName: 'Alex', lastName: 'One', ownerId: 'another-admin', id: 'stolen-id', assignments: { create: [{ userId: 'other' }] } }, admin);
  assert.equal(created.ownerId, admin.id); assert.equal(created.id, undefined); assert.equal(created.assignments, undefined);
  await assert.rejects(service.create({ firstName: 'No', lastName: 'Permission' }, { id: 'bidder', role: 'BIDDER' }));
});

test('only Master can assign Admin profiles and Admin cannot grant an inaccessible profile to a bidder', async () => {
  const target = { id: 'admin-b', role: 'ADMIN' }; let update;
  const db = { user: { findUnique: async () => target, update: async args => { update = args; } }, profile: { count: async () => 1 }, auditEvent: { create: async () => {} } };
  const service = new UsersService(db, {});
  await assert.rejects(service.updateAssignments(target.id, [{ profileId: 'p' }], admin), /Only Master/);
  await service.updateAssignments(target.id, [{ profileId: 'p' }], master);
  assert.equal(update.data.profileAssignments.create[0].grantedByMaster, true);
  target.role = 'BIDDER'; target.managedByAdminId = admin.id;
  db.profile.count = async ({ where }) => { assert.deepEqual(where.OR, profileAccessWhere(admin).OR); return 0; };
  await assert.rejects(service.updateAssignments(target.id, [{ profileId: 'foreign' }], admin), /you can access/);
});
