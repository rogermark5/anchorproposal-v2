// Runs the actual additive migration in an isolated copy of the schema.
// Requires local PostgreSQL command-line tools; never migrates the live schema.
require('reflect-metadata');
const fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto'),{spawn}=require('node:child_process');
const {ConfigModule}=require('@nestjs/config'),{PrismaClient}=require('@prisma/client');
const {JobPoolService}=require('../dist/job-pool/job-pool.service');
const bin=process.env.PG_BIN||'C:/Program Files/PostgreSQL/16/bin';
async function command(name,args,env){const p=spawn(path.join(bin,name+(process.platform==='win32'?'.exe':'')),args,{env,windowsHide:true,stdio:['ignore','ignore','pipe']});let error='';p.stderr.on('data',b=>error+=b);const code=await new Promise((resolve,reject)=>{p.once('error',reject);p.once('close',resolve);});if(code!==0)throw Error(name+': '+error.slice(0,1500));}
(async()=>{
 await ConfigModule.forRoot({envFilePath:'.env'});const url=new URL(process.env.DATABASE_URL),schema='qa_companies_'+randomUUID().replaceAll('-','');
 assert.match(schema,/^qa_companies_[a-f0-9]{32}$/);
 const env={...process.env,PGHOST:url.hostname,PGPORT:url.port||'5432',PGUSER:decodeURIComponent(url.username),PGPASSWORD:decodeURIComponent(url.password),PGDATABASE:decodeURIComponent(url.pathname.slice(1)),PGCONNECT_TIMEOUT:'10'};
 const folder=path.resolve('../../tmp/job-pool-qa',schema);await fs.mkdir(folder,{recursive:true});const dump=path.join(folder,'schema.sql');
 await command('pg_dump',['--schema-only','--schema=public','--no-owner','--no-acl','--file',dump],env);
 let sql=await fs.readFile(dump,'utf8');sql=sql.replace(/\bpublic\b/g,schema);await fs.writeFile(dump,sql);
 await command('psql',['-X','-v','ON_ERROR_STOP=1','-f',dump],env);
 url.searchParams.set('schema',schema);const db=new PrismaClient({datasources:{db:{url:url.toString()}}});
 try{
  // The source schema may already contain this feature on subsequent runs.
  // Remove only its cloned objects so the test always exercises an upgrade.
  assert.equal((await db.$queryRawUnsafe('SELECT current_schema() AS name'))[0].name,schema);
  for(const statement of [
   `DROP TRIGGER IF EXISTS job_pool_company_history ON "${schema}".job_pool_jobs`,
   `ALTER TABLE "${schema}".job_pool_jobs DROP COLUMN IF EXISTS "companyKey", DROP COLUMN IF EXISTS "sourceUpdatedAt"`,
   `DROP TABLE IF EXISTS "${schema}".job_pool_companies`,
   `DROP TABLE IF EXISTS "${schema}".job_pool_board_candidates`,
   `DROP FUNCTION IF EXISTS "${schema}".track_pool_company()`,
   `DROP FUNCTION IF EXISTS "${schema}".pool_company_key(text)`,
  ])await db.$executeRawUnsafe(statement);
  const old=new Date(Date.now()-5*86400000);
  await db.$executeRaw`INSERT INTO job_pool_jobs (id,"externalId","canonicalUrl","jobUrl",title,company,location,"sourceName",description,"isSoftware","workArrangement","eligibleCountries","createdAt","updatedAt") VALUES ('legacy','legacy','https://example.com/old','https://example.com/old','Software Engineer','A C M E','United States','QA','Build software.',true,'REMOTE',ARRAY['US'],${old.toISOString().slice(0,23)}::timestamp,CURRENT_TIMESTAMP)`;
  const migration=await fs.readFile(path.resolve('prisma/migrations/20261024010000_company_discovery/migration.sql'),'utf8');
  const file=path.join(folder,'migration.sql');await fs.writeFile(file,`SET search_path = "${schema}", pg_catalog;\n`+migration);await command('psql',['-X','-v','ON_ERROR_STOP=1','-f',file],env);
  assert.equal(await db.jobPoolJob.count(),1);assert.equal(await db.jobPoolSource.count({where:{provider:'himalayas'}}),21);
  const legacy=await db.jobPoolCompany.findUnique({where:{key:'acme'}});assert.equal(legacy.firstSeenAt.getTime(),old.getTime());
  const make=(id,company,publishedAt=null)=>({id,externalId:id,canonicalUrl:'https://example.com/'+id,jobUrl:'https://example.com/'+id,title:'Software Engineer',company,location:'United States',sourceName:'QA',description:'Build software and APIs.',isSoftware:true,workArrangement:'REMOTE',eligibleCountries:['US'],publishedAt});
  await db.jobPoolJob.create({data:make('another-acme','ACME',new Date())});
  assert.equal((await db.jobPoolCompany.findUnique({where:{key:'acme'}})).firstSeenAt.getTime(),old.getTime());
  for(let i=0;i<27;i++)await db.jobPoolJob.create({data:make('job-'+i,'Company '+String(i).padStart(2,'0'),i%3?new Date(Date.now()-i*60000):null)});
  await db.jobPoolJob.create({data:make('second-role','Company 02',new Date())});
  const actor=await db.user.create({data:{email:'actor@qa.invalid',passwordHash:'qa-not-login',firstName:'QA',lastName:'Actor',role:'BIDDER'}});
  const other=await db.user.create({data:{email:'other@qa.invalid',passwordHash:'qa-not-login',firstName:'QA',lastName:'Other',role:'BIDDER'}});
  const profile=await db.profile.create({data:{firstName:'QA',lastName:'Profile'}});
  await db.application.create({data:{profileId:profile.id,bidderId:actor.id,jobTitle:'Engineer',company:'ACME',normalizedCompany:'acme',jobDescription:'QA'}});
  await db.application.create({data:{profileId:profile.id,bidderId:other.id,jobTitle:'Engineer',company:'Company 03',normalizedCompany:'company03',jobDescription:'QA'}});
  await db.jobPoolApplied.create({data:{userId:actor.id,jobId:'job-1',profileId:profile.id}});
  const service=new JobPoolService(db,{matchingCompanies:async()=>({})}),user={id:actor.id,role:'BIDDER'},query={groupByCompany:'true',companyStatus:'true',status:'not-applied'};
  let page=await service.list(user,query),rows=[...page.jobs];assert.equal(page.total,26);assert.equal(page.newCompanyCount,26);assert.equal(page.jobTotal,27);
  while(page.nextCursor){page=await service.list(user,{...query,cursor:page.nextCursor});rows.push(...page.jobs);}
  assert.equal(rows.length,26);assert.equal(new Set(rows.map(j=>j.companyKey)).size,26);assert.ok(rows.some(j=>j.companyKey==='company03'));assert.ok(!rows.some(j=>['acme','company01'].includes(j.companyKey)));
  assert.equal(rows.find(j=>j.companyKey==='company02').companyJobCount,2);
  const expanded=await service.list(user,{companyStatus:'true',status:'all',company:'Company 02'});assert.equal(expanded.total,2);
  const applied=await service.list(user,{...query,status:'applied'});assert.deepEqual(new Set(applied.jobs.map(j=>j.companyKey)),new Set(['acme','company01']));
  const fresh=await service.list(user,{...query,status:'all',newCompanies:'true'});assert.equal(fresh.total,27);assert.ok(!fresh.jobs.some(j=>j.companyKey==='acme'));
  assert.equal(await db.jobPoolJob.count(),30);
  // Import order deliberately differs from source dates, with tied import times
  // crossing page boundaries. Refreshing a job must never move its first import.
  const fixture=await db.jobPoolJob.findMany({orderBy:{id:'asc'}}),importedAt=Date.now()-60000;
  for(const [index,job] of fixture.entries())await db.jobPoolJob.update({where:{id:job.id},data:{createdAt:new Date(importedAt-index%2*1000)}});
  for(const sort of ['imported','newest']){
   const all=await db.jobPoolJob.findMany(),field=sort==='imported'?'createdAt':'publishedAt';
   const date=value=>value?new Date(value).getTime():-Infinity;
   const expected=[...all].sort((a,b)=>date(b[field])-date(a[field])||(a.id<b.id?1:a.id>b.id?-1:0)).map(job=>job.id);
   const params={status:'all',companyStatus:'true',sort};
   let current=await service.list(user,params),actual=[...current.jobs];assert.equal(current.sort,sort);assert.equal(current.total,all.length);assert.ok(current.nextCursor);
   await assert.rejects(service.list(user,{...params,sort:sort==='imported'?'newest':'imported',cursor:current.nextCursor}),/Invalid job cursor/);
   await db.jobPoolJob.create({data:{...make('late-'+sort,'Late '+sort),createdAt:new Date(new Date(current.asOf).getTime()+1)}});
   while(current.nextCursor){current=await service.list(user,{...params,cursor:current.nextCursor});actual.push(...current.jobs);}
   assert.deepEqual(actual.map(job=>job.id),expected,sort+' order must include each matching job exactly once and freeze later imports');
   assert.ok(actual.some(job=>job.applied));assert.ok(actual.some(job=>job.companyKey==='acme'));
   const grouped=await service.list(user,{...params,groupByCompany:'true'}),companies=[...grouped.jobs];let more=grouped;
   while(more.nextCursor){more=await service.list(user,{...params,groupByCompany:'true',cursor:more.nextCursor});companies.push(...more.jobs);}
   assert.equal(new Set(companies.map(job=>job.companyKey)).size,grouped.total);
   assert.equal(companies.length,grouped.total);
  }
  await assert.rejects(service.list(user,{sort:'random'}),/valid job order/);
  const legacyCursor=Buffer.from(JSON.stringify({v:2,at:null,id:'zzzz',asOf:new Date().toISOString()})).toString('base64url');
  assert.ok((await service.list(user,{status:'all',cursor:legacyCursor})).jobs.every(job=>job.publishedAt===null));
  // Freshness affects genuine additions, not normal refreshes of known jobs.
  const day=86400000,clock=new Date(),recent=new Date(clock);
  const freshData=make('fresh-import','Freshness Fixture',recent);
  for(const [id,date] of [['two-days-old',new Date(clock.getTime()-2*day)],['very-old',new Date(clock.getTime()-1500*day)],['no-date',null],['future-date',new Date(clock.getTime()+day)]]){
   assert.equal(await service.saveImportedJob({...make(id,'Freshness Fixture',date),sourceUpdatedAt:clock},{isActive:true}),null);
   assert.equal(await db.jobPoolJob.findUnique({where:{canonicalUrl:'https://example.com/'+id}}),null);
  }
  const imported=await service.saveImportedJob(freshData,{});assert.ok(imported);assert.equal(imported.publishedAt.getTime(),recent.getTime());
  const batch=(await service.latestImport()).id;
  const known=await db.jobPoolJob.create({data:make('known-week-old','Retention Fixture',new Date(clock.getTime()-7*day))});
  await db.jobPoolApplied.create({data:{userId:actor.id,jobId:known.id,profileId:profile.id}});
  await db.jobPoolViewed.create({data:{userId:actor.id,jobId:known.id}});
  const applicationsBefore=await db.application.count();
  const refreshed=await service.saveImportedJob({...make('unused-id',known.company,null),canonicalUrl:known.canonicalUrl},{description:'Refreshed known job',isActive:true,lastSeenAt:new Date()});
  assert.equal(refreshed.id,known.id);assert.equal(refreshed.isActive,true);assert.equal(refreshed.publishedAt.getTime(),known.publishedAt.getTime());
  assert.equal(refreshed.addedBatchId,null);assert.equal((await service.latestImport()).id,batch);
  const oldDate=new Date(clock.getTime()-31*day);
  await db.jobPoolJob.update({where:{id:known.id},data:{publishedAt:oldDate,isActive:true}});
  assert.equal((await service.list(user,{q:'Retention Fixture',status:'all'})).total,0,'Age filter must hide stale jobs before the cleanup pass');
  const staleRefresh=await service.saveImportedJob({...make('unused-id',known.company,oldDate),canonicalUrl:known.canonicalUrl},{isActive:true,publishedAt:oldDate,lastSeenAt:new Date()});
  assert.equal(staleRefresh.isActive,false,'A source refresh must not reactivate an old posting');
  await db.jobPoolJob.update({where:{id:known.id},data:{isActive:true}});
  const boundary=await db.jobPoolJob.create({data:make('thirty-days','Retention Boundary',new Date(clock.getTime()-30*day))});
  await service.retireOldJobs(clock);
  assert.equal((await db.jobPoolJob.findUnique({where:{id:known.id}})).isActive,false);
  assert.equal((await db.jobPoolJob.findUnique({where:{id:boundary.id}})).isActive,true,'Exactly 30 days is retained; greater ages expire');
  assert.equal(await db.jobPoolApplied.count({where:{jobId:known.id}}),1);assert.equal(await db.jobPoolViewed.count({where:{jobId:known.id}}),1);
  assert.equal(await db.application.count(),applicationsBefore);assert.equal((await service.latestImport()).id,batch);
  console.log('PASS: only fresh dated jobs are inserted; known older jobs refresh; 30-day source-age cleanup preserves jobs, applications, applied/viewed marks and import groups.');
  const feedCount=require('../dist/job-pool/public-rss-feeds').USEFUL_FREE_FEEDS.length;
  await service.ensureUsefulFreeFeeds();assert.equal(await db.jobPoolSource.count(),21+feedCount);
  const customId='source-remotefirst-data';
  await db.jobPoolSource.update({where:{id:customId},data:{enabled:false,queued:false,name:'My paused feed'}});
  await service.ensureUsefulFreeFeeds();assert.equal(await db.jobPoolSource.count(),21+feedCount);
  const custom=await db.jobPoolSource.findUnique({where:{id:customId}});assert.equal(custom.enabled,false);assert.equal(custom.name,'My paused feed');
  const wwrSource=await db.jobPoolSource.findUnique({where:{id:'source-wwr-public-rss'}});
  const prior=await db.jobPoolJob.create({data:{...make('rss-existing','Rolling Feed Company',new Date(Date.now()-4*day)),sourceId:wwrSource.id}});
  const direct=await db.jobPoolSource.create({data:{provider:'greenhouse',boardToken:'qa-empty',name:'Empty authoritative board',queued:true}});
  const closed=await db.jobPoolJob.create({data:{...make('direct-closed','Closed Company',new Date(Date.now()-4*day)),sourceId:direct.id}});
  const providers=require('../dist/job-pool/job-providers'),originalFetch=providers.fetchJobPage;
  try{
   const raw=(suffix,publishedAt)=>({externalId:suffix,jobUrl:'https://weworkremotely.com/remote-jobs/qa-'+suffix,title:'Software Engineer',company:'New RSS Company',location:'United States',eligibleCountries:['US'],description:'Build production software services.',sourceName:'We Work Remotely',workArrangement:'REMOTE',publishedAt,expiresAt:null,salary:null,employmentType:null});
   providers.fetchJobPage=async source=>({jobs:source.provider==='wwr'?[raw('today',new Date()),raw('old',new Date(Date.now()-3*day)),raw('unknown',null)]:[],next:null,complete:true});
   await service.poll('feeds');await service.poll('boards');await service.poll('daily');
   const daily=await db.jobPoolSource.findUnique({where:{id:'source-onjob-public'}});
   assert.ok(daily.nextSyncAt.getTime()>Date.now()+23*3600000,'A successful OnJob daily refresh must not be queued again after only an hour');
   assert.equal((await db.jobPoolJob.findUnique({where:{id:prior.id}})).isActive,true,'Rolling feeds must not close jobs just because they fall out of a recent-results window');
   assert.equal((await db.jobPoolJob.findUnique({where:{id:closed.id}})).isActive,false,'Complete employer lists still close missing jobs');
   assert.equal(await db.jobPoolJob.count({where:{jobUrl:{startsWith:'https://weworkremotely.com/remote-jobs/qa-'}}}),1);
   assert.equal((await db.jobPoolJob.findFirst({where:{jobUrl:'https://weworkremotely.com/remote-jobs/qa-today'}})).sourceId,wwrSource.id);
  }finally{providers.fetchJobPage=originalFetch;}
  console.log('PASS: '+feedCount+' additive feed registrations preserve disabled settings; full importer enforces today-only inserts and retains older jobs absent from incremental feeds.');
  console.log('PASS: additive migration, company history and permissions, grouped/flat import and source-date pagination, tied times, unknown dates, snapshot stability and incompatible cursor rejection.');
 }finally{await db.$executeRawUnsafe(`DROP SCHEMA "${schema}" CASCADE`);await db.$disconnect();}
})().catch(error=>{console.error(error.message);process.exitCode=1;});
