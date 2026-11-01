// Upgrade and concurrency checks in a temporary schema on local PostgreSQL.
// The existing schema/data are read only. No AI or job-provider calls are made.
require('reflect-metadata');
const fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto'),{spawn}=require('node:child_process');
const {ConfigModule}=require('@nestjs/config'),{PrismaClient}=require('@prisma/client');
const {AnswersService}=require('../dist/generations/answers.service');
const {ApplicationsService}=require('../dist/applications/applications.service');
const {JobPoolService}=require('../dist/job-pool/job-pool.service');
const {ProfilesService}=require('../dist/profiles/profiles.service');
const {SettingsService}=require('../dist/settings/settings.service');
const {UsersService}=require('../dist/users/users.service');
const {GenerationsService}=require('../dist/generations/generations.service');
const bin=process.env.PG_BIN||'C:/Program Files/PostgreSQL/16/bin';
async function command(name,args,env){const child=spawn(path.join(bin,name+(process.platform==='win32'?'.exe':'')),args,{env,windowsHide:true,stdio:['ignore','ignore','pipe']});let error='';child.stderr.on('data',b=>error+=b);const code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',resolve);});if(code!==0)throw Error(name+': '+error.slice(0,1000));}
(async()=>{
 await ConfigModule.forRoot();const url=new URL(process.env.DATABASE_URL);assert.ok(['localhost','127.0.0.1'].includes(url.hostname),'Use local PostgreSQL for QA.');
 const schema='qa_profile_access_'+randomUUID().replaceAll('-','');assert.match(schema,/^qa_profile_access_[a-f0-9]{32}$/);
 const env={...process.env,PGHOST:url.hostname,PGPORT:url.port||'5432',PGUSER:decodeURIComponent(url.username),PGPASSWORD:decodeURIComponent(url.password),PGDATABASE:decodeURIComponent(url.pathname.slice(1)),PGCONNECT_TIMEOUT:'10'};
 const folder=path.resolve('../../tmp/job-pool-qa',schema);await fs.mkdir(folder,{recursive:true});const dump=path.join(folder,'schema.sql');
 await command('pg_dump',['--schema-only','--schema=public','--no-owner','--no-acl','--file',dump],env);
 await fs.writeFile(dump,(await fs.readFile(dump,'utf8')).replace(/\bpublic\b/g,schema));await command('psql',['-X','-v','ON_ERROR_STOP=1','-f',dump],env);
 url.searchParams.set('schema',schema);const db=new PrismaClient({datasources:{db:{url:url.toString()}}});
 try{

  assert.equal((await db.$queryRawUnsafe('SELECT current_schema() AS name'))[0].name,schema);
  await db.$executeRawUnsafe('ALTER TABLE profiles DROP COLUMN IF EXISTS "ownerId" CASCADE');
  await db.$executeRawUnsafe('ALTER TABLE profile_assignments DROP COLUMN IF EXISTS "grantedByMaster"');
  const legacyId=randomUUID();
  await db.$executeRawUnsafe('INSERT INTO profiles (id,"firstName","lastName","updatedAt") VALUES ($1, $2, $3, now())',legacyId,'Legacy','Profile');
  const migration=await fs.readFile(path.resolve('prisma/migrations/20261031020000_profile_ownership/migration.sql'),'utf8'),file=path.join(folder,'ownership.sql');
  await fs.writeFile(file,'SET search_path = "'+schema+'", pg_catalog;\n'+migration);await command('psql',['-X','-v','ON_ERROR_STOP=1','-f',file],env);
  assert.equal((await db.profile.findUnique({where:{id:legacyId}})).ownerId,null);
  const makeUser=(name,role,extra={})=>db.user.create({data:{email:name+'@qa.invalid',passwordHash:'qa-only',firstName:name,lastName:'QA',role,...extra}});
  const master=await makeUser('master','MASTER'),a=await makeUser('admin-a','ADMIN'),b=await makeUser('admin-b','ADMIN'),bidder=await makeUser('bidder','BIDDER',{managedByAdminId:a.id});
  const settings=new SettingsService(db),service=new ProfilesService(db,settings),users=new UsersService(db,settings);
  const own=await service.create({firstName:'A',lastName:'Own',ownerId:b.id},a),foreign=await service.create({firstName:'B',lastName:'Own'},b);
  assert.equal(own.ownerId,a.id);
  await db.profileAssignment.create({data:{userId:a.id,profileId:legacyId,isDefault:true}});
  assert.deepEqual((await service.findAll(a)).map(p=>p.id),[own.id]);assert.equal(await service.getDefaultProfile(a),null);
  assert.equal((await service.findAll(master)).length,3);await assert.rejects(service.findOne(foreign.id,a),/not owned/);
  await assert.rejects(service.setDefaultProfile(legacyId,a),/not owned/);
  for(const operation of [()=>service.update(foreign.id,{summary:'steal'},a),()=>service.archive(foreign.id,a),()=>service.clone(foreign.id,a)])await assert.rejects(operation(),/not owned/);
  await users.updateAssignments(a.id,[{profileId:legacyId}],master);
  assert.equal((await service.getDefaultProfile(a)).id,legacyId);assert.ok((await service.findAll(a)).some(p=>p.id===legacyId));
  assert.equal((await service.findOne(legacyId,a)).id,legacyId);
  const clone=await service.clone(legacyId,a);assert.equal(clone.ownerId,a.id);
  await service.update(own.id,{ownerId:b.id,summary:'allowed'},a);assert.equal((await db.profile.findUnique({where:{id:own.id}})).ownerId,a.id);
  await users.updateAssignments(bidder.id,[{profileId:own.id}],a);assert.equal((await service.findAll(bidder))[0].id,own.id);
  await assert.rejects(users.updateAssignments(bidder.id,[{profileId:foreign.id}],a),/you can access/);
  await assert.rejects(users.updateAssignments(b.id,[{profileId:own.id}],a),/Only Master/);
  settings.getMyPromptSettings=async()=>({assignmentMode:'user',effectivePrompt:{},myPrompts:[]});
  const workflow=await settings.getGenerationWorkflow(a);assert.ok(!workflow.profiles.some(p=>p.id===foreign.id));
  const app=await db.application.create({data:{profileId:legacyId,bidderId:a.id,jobTitle:'Engineer',company:'Legacy Co',normalizedCompany:'legacyco',jobDescription:'Build software.'}});
  const generation=await db.resumeGeneration.create({data:{applicationId:app.id,creatorId:a.id,status:'COMPLETED'}});
  const apps=new ApplicationsService(db,service,{contextualizeWarnings:rows=>rows},{}),generations=new GenerationsService(db,service,{},{},{},{},{},{});
  assert.equal((await apps.findOne(app.id,a)).id,app.id);
  await users.updateAssignments(a.id,[],master);
  assert.equal(await service.getDefaultProfile(a),null);await assert.rejects(service.findOne(legacyId,a),/not owned/);
  await assert.rejects(apps.findOne(app.id,a),/not owned/);assert.deepEqual(await apps.findAll(a,{}),[]);
  await assert.rejects(generations.findOne(generation.id,a),/not owned/);
  await assert.rejects(apps.profileForPool(legacyId,a),/not owned/);
  const pool=new JobPoolService(db,apps);await assert.rejects(pool.companyFilters(a,{excludeProfileIds:legacyId},new Date()),/access/);
  assert.equal((await db.profile.findUnique({where:{id:legacyId}})).firstName,'Legacy');assert.equal(await db.application.count(),1);
  assert.equal((await service.findAll(a)).length,2);assert.equal((await service.findAll(b)).length,1);
  console.log('PASS: additive ownership upgrade preserves legacy data; independent admin ownership, explicit Master grants/revocation, default selection, mutation, workflow, application, generation and job-pool access verified on PostgreSQL.');
 }finally{await db.$executeRawUnsafe('DROP SCHEMA "'+schema+'" CASCADE');await db.$disconnect();}
})().catch(error=>{console.error(error.stack);process.exitCode=1;});
