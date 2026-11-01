// Upgrade and concurrency checks in a temporary schema on local PostgreSQL.
// The existing schema/data are read only. No AI or job-provider calls are made.
require('reflect-metadata');
const fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto'),{spawn}=require('node:child_process');
const {ConfigModule}=require('@nestjs/config'),{PrismaClient}=require('@prisma/client');
const {AnswersService}=require('../dist/generations/answers.service');
const {ApplicationsService}=require('../dist/applications/applications.service');
const {JobPoolService}=require('../dist/job-pool/job-pool.service');
const {ProfilesService}=require('../dist/profiles/profiles.service');
const {GenerationsService}=require('../dist/generations/generations.service');
const bin=process.env.PG_BIN||'C:/Program Files/PostgreSQL/16/bin';
async function command(name,args,env){const child=spawn(path.join(bin,name+(process.platform==='win32'?'.exe':'')),args,{env,windowsHide:true,stdio:['ignore','ignore','pipe']});let error='';child.stderr.on('data',b=>error+=b);const code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',resolve);});if(code!==0)throw Error(name+': '+error.slice(0,1000));}
(async()=>{
 await ConfigModule.forRoot();const url=new URL(process.env.DATABASE_URL);assert.ok(['localhost','127.0.0.1'].includes(url.hostname),'Use local PostgreSQL for QA.');
 const schema='qa_reliability_'+randomUUID().replaceAll('-','');assert.match(schema,/^qa_reliability_[a-f0-9]{32}$/);
 const env={...process.env,PGHOST:url.hostname,PGPORT:url.port||'5432',PGUSER:decodeURIComponent(url.username),PGPASSWORD:decodeURIComponent(url.password),PGDATABASE:decodeURIComponent(url.pathname.slice(1)),PGCONNECT_TIMEOUT:'10'};
 const folder=path.resolve('../../tmp/job-pool-qa',schema);await fs.mkdir(folder,{recursive:true});const dump=path.join(folder,'schema.sql');
 await command('pg_dump',['--schema-only','--schema=public','--no-owner','--no-acl','--file',dump],env);
 await fs.writeFile(dump,(await fs.readFile(dump,'utf8')).replace(/\bpublic\b/g,schema));await command('psql',['-X','-v','ON_ERROR_STOP=1','-f',dump],env);
 url.searchParams.set('schema',schema);const db=new PrismaClient({datasources:{db:{url:url.toString()}}});
 try{
  assert.equal((await db.$queryRawUnsafe('SELECT current_schema() AS name'))[0].name,schema);
  await db.$executeRawUnsafe('DROP TABLE IF EXISTS generation_answer_requests');await db.$executeRawUnsafe('ALTER TABLE generation_turns DROP COLUMN IF EXISTS "requestId"');
  if (!(await db.$queryRawUnsafe(`SELECT 1 FROM information_schema.columns WHERE table_schema='${schema}' AND table_name='profiles' AND column_name='ownerId'`)).length) {
    const ownership=await fs.readFile(path.resolve('prisma/migrations/20261031020000_profile_ownership/migration.sql'),'utf8'),file=path.join(folder,'ownership.sql');
    await fs.writeFile(file,`SET search_path = "${schema}", pg_catalog;\n`+ownership);await command('psql',['-X','-v','ON_ERROR_STOP=1','-f',file],env);
  }
  const owner=await db.user.create({data:{email:'owner@qa.invalid',passwordHash:'qa-only',firstName:'QA',lastName:'Owner',role:'BIDDER'}}),other=await db.user.create({data:{email:'other@qa.invalid',passwordHash:'qa-only',firstName:'QA',lastName:'Other',role:'BIDDER'}});
  const profiles=await Promise.all(['One','Two','Other'].map(lastName=>db.profile.create({data:{firstName:'QA',lastName}})));
  await db.profileAssignment.createMany({data:profiles.slice(0,2).map(profile=>({profileId:profile.id,userId:owner.id}))});
  const app=await db.application.create({data:{profileId:profiles[0].id,bidderId:owner.id,jobTitle:'Engineer',company:' A C M E ',normalizedCompany:'acme',jobDescription:'Build software.',createdAt:new Date('2026-11-01T07:00:00Z')}});
  const generation=await db.resumeGeneration.create({data:{applicationId:app.id,creatorId:owner.id,status:'COMPLETED',structuredOutputJson:{summary:'QA'},profileSnapshotJson:{}}});
  await db.$executeRaw`INSERT INTO generation_turns (id,"generationId",sequence,role,purpose,content) VALUES (${randomUUID()},${generation.id},1,'assistant','resume_assistant','Legacy resume—kept.')`;
  const migration=await fs.readFile(path.resolve('prisma/migrations/20261031010000_reliable_answer_requests/migration.sql'),'utf8'),file=path.join(folder,'upgrade.sql');
  await fs.writeFile(file,`SET search_path = "${schema}", pg_catalog;\n`+migration);await command('psql',['-X','-v','ON_ERROR_STOP=1','-f',file],env);
  assert.equal(await db.application.count(),1);assert.equal((await db.generationTurn.findFirst()).content,'Legacy resume—kept.');
  await db.systemSetting.create({data:{key:'time_zone:'+owner.id,value:'America/Los_Angeles'}});
  const apps=new ApplicationsService(db,new ProfilesService(db,{}),{contextualizeWarnings:rows=>rows},{});
  assert.equal((await apps.findAll(owner,{from:'2026-11-01',to:'2026-11-01'})).length,1);assert.equal((await apps.findAll(owner,{from:'2026-10-31',to:'2026-10-31'})).length,0);
  for(const [id,company]of [['a','ACME'],['b','Second Co'],['c','Other Co']])await db.jobPoolJob.create({data:{id,externalId:id,canonicalUrl:'https://qa.invalid/'+id,jobUrl:'https://qa.invalid/'+id,title:'Software Engineer',company,location:'US',sourceName:'QA',description:'Build software',isSoftware:true,eligibleCountries:['US'],workArrangement:'REMOTE',publishedAt:new Date()}});
  await db.jobPoolApplied.create({data:{jobId:'b',userId:owner.id,profileId:profiles[1].id}});
  await db.application.create({data:{profileId:profiles[0].id,bidderId:other.id,jobTitle:'Other role',company:'Other Co',normalizedCompany:'otherco',jobDescription:'Other user.'}});
  const pool=new JobPoolService(db,{matchingCompanies:async()=>({})});const where=await pool.companyFilters(owner,{excludeProfileIds:profiles.slice(0,2).map(p=>p.id).join(',')},new Date());
  assert.deepEqual((await db.jobPoolJob.findMany({where})).map(row=>row.id),['c']);
  await assert.rejects(pool.companyFilters(owner,{excludeProfileIds:profiles[2].id},new Date()),/access/);
  let calls=0;const jobs=new Map();const answers=new AnswersService(db,{getAnswerPrompt:async()=>'Prime; reply yes'},{completeChat:async messages=>{calls++;return{content:messages.at(-1).content.startsWith('Prime')?'yes':'{"answers":[{"question":"Why?","answer":"My experience—matches."}]}',tokenUsage:7};}},{getAccessibleGeneration:async(id,user)=>{const row=await db.resumeGeneration.findUnique({where:{id},include:{application:true}});if(row.creatorId!==user.id)throw Error('Access denied');return row;}},{add:async(_name,data,opts)=>jobs.set(opts.jobId,data)});
  const key=randomUUID();const [first,second]=await Promise.all([answers.submit(generation.id,owner,'Why?',key),answers.submit(generation.id,owner,'Why?',key)]);
  assert.equal(first.id,second.id);assert.equal(jobs.size,1);assert.equal(calls,0);assert.equal((await answers.list(generation.id,owner)).pending.id,first.id);
  await answers.processRequest(first.id);assert.equal(calls,2);await answers.processRequest(first.id);assert.equal(calls,2);
  const result=await answers.requestStatus(generation.id,first.id,owner);assert.equal(result.status,'COMPLETED');assert.equal(result.view.pending,null);assert.equal(result.view.items[0].answer,'Why?\n\nMy experience-matches.');assert.equal(await db.generationTurn.count({where:{requestId:first.id}}),2);
  await assert.rejects(answers.requestStatus(generation.id,first.id,other),/Access denied/);await assert.rejects(answers.submit(generation.id,owner,'Different?',key),/already used/);
  // Database cancellation wins even if a worker has just received its AI result.
  const working=await db.resumeGeneration.create({data:{applicationId:app.id,creatorId:owner.id,status:'GENERATING',version:2}});
  const generations=new GenerationsService(db,new ProfilesService(db,{}),{},{},{},{},{getJob:async()=>null},{});
  generations.getAccessibleGeneration=async()=>working;generations.findOne=async id=>db.resumeGeneration.findUnique({where:{id}});
  await generations.cancel(working.id,owner);await assert.rejects(generations.updateStatus(working.id,'COMPLETED',{structuredOutputJson:{summary:'late result'}}),/cancelled/i);
  assert.equal((await db.resumeGeneration.findUnique({where:{id:working.id}})).status,'CANCELLED');
  console.log('PASS: additive upgrade preserves applications and legacy turns; DST filters, multi-profile ownership, durable idempotent answers and cancellation use actual PostgreSQL.');
 }finally{await db.$executeRawUnsafe(`DROP SCHEMA "${schema}" CASCADE`);await db.$disconnect();}
})().catch(error=>{console.error(error.message);process.exitCode=1;});
