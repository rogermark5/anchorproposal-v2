// Local PostgreSQL fixtures roll back. No external providers, mail, or AI calls.
require('reflect-metadata');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { ConfigModule } = require('@nestjs/config');
const { PrismaClient } = require('@prisma/client');
const { ApplicationsService } = require('../dist/applications/applications.service');
const { ProfilesService } = require('../dist/profiles/profiles.service');
const { RulesService } = require('../dist/rules/rules.service');
(async () => {
  await ConfigModule.forRoot();
  const url = new URL(process.env.DATABASE_URL);
  if (!['localhost','127.0.0.1'].includes(url.hostname)) throw Error('Use a local test database.');
  const prisma = new PrismaClient(), marker = randomUUID(), rollback = Error('QA rollback');
  try {
    try { await prisma.$transaction(async db => {
      const makeUser = (suffix, role='BIDDER') => db.user.create({data:{email:`${marker}-${suffix}@qa.invalid`,firstName:'QA',lastName:suffix,role,passwordHash:'not-login-capable',canCreateApplications:true}});
      const me=await makeUser('me'), other=await makeUser('other'), admin=await makeUser('admin','ADMIN');
      const profile=await db.profile.create({data:{firstName:'QA',lastName:'Profile'}});
      const assignment=await db.profileAssignment.create({data:{profileId:profile.id,userId:me.id}});
      const company=`QA ${marker} Co`, normalized=company.toLowerCase().replace(/\s/g,'');
      const own=await db.application.create({data:{profileId:profile.id,bidderId:me.id,jobTitle:'QA Engineer',company,normalizedCompany:normalized,jobDescription:'Remote role'}});
      await db.application.create({data:{profileId:profile.id,bidderId:other.id,jobTitle:'Other private role',company,normalizedCompany:normalized,jobDescription:'Remote role'}});
      const rules=new RulesService(db), apps=new ApplicationsService(db,new ProfilesService(db,{}),rules,{});
      const variants=company.toUpperCase().split('').join(' \t');
      assert.deepEqual((await apps.matchingCompanies(me,[variants]))[normalized].map(row=>row.id),[own.id]);
      assert.equal((await apps.matchingCompanies(admin,[variants]))[normalized],undefined);
      await db.profileAssignment.update({where:{id:assignment.id},data:{activeTo:new Date()}});
      assert.equal((await apps.matchingCompanies(me,[variants]))[normalized],undefined);
      await assert.rejects(apps.validateDraft({profileId:profile.id,jobDescription:'Test'},me),/not assigned/);
      await db.profileAssignment.update({where:{id:assignment.id},data:{activeTo:null}});
      const token=`draft${marker.replaceAll('-','')}`;
      await rules.createRule({category:'CLEARANCE',pattern:token,severity:'BLOCK',behavior:'BLOCK'});
      const before=await Promise.all([db.application.count(),db.applicationWarning.count(),db.applicationStatusHistory.count()]);
      const preview=await apps.validateDraft({profileId:profile.id,company,jobTitle:'QA Engineer',jobDescription:`The job requires ${token}.`},me);
      assert.equal(preview.allowed,false);assert.ok(preview.warnings.some(row=>row.category==='CLEARANCE'));assert.equal(preview.duplicates,undefined);
      assert.deepEqual(await Promise.all([db.application.count(),db.applicationWarning.count(),db.applicationStatusHistory.count()]),before);
      await db.user.update({where:{id:me.id},data:{canCreateApplications:false}});
      await assert.rejects(apps.validateDraft({profileId:profile.id,jobDescription:'Test'},me),/permission/);
      throw rollback;
    },{timeout:30000}); } catch(error) {if(error!==rollback)throw error;}
    assert.equal(await prisma.user.count({where:{email:{startsWith:marker}}}),0);
    console.log('PASS Company matches, ownership, revoked profile access, draft rules and permissions; preview writes nothing; all fixtures rolled back.');
  } finally {await prisma.$disconnect();}
})().catch(error=>{console.error(error);process.exitCode=1;});
