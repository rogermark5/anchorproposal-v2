require('reflect-metadata');
const {test}=require('node:test'),assert=require('node:assert/strict');
const {calendarRange,calendarDay,validCalendarDay,readableAnswer,normalizeAiText,fetchWithRecovery,responseJson}=require('../../../packages/shared/dist');
const {ApplicationsService}=require('../dist/applications/applications.service');
const {JobPoolService}=require('../dist/job-pool/job-pool.service');
const {SettingsService}=require('../dist/settings/settings.service');
const {GenerationsService}=require('../dist/generations/generations.service');
const {AuthService}=require('../dist/auth/auth.service');
const json=(value,status=200)=>new Response(JSON.stringify(value),{status});

test('date ranges include both days, handle DST and do not shift calendar dates',()=>{
 for(const [day,hours] of [['2026-03-08',23],['2026-11-01',25]]){
  const {gte,lt}=calendarRange(day,day,'America/Los_Angeles');
  assert.equal((lt-gte)/3600000,hours);assert.equal(calendarDay(gte,'America/Los_Angeles'),day);
  assert.equal(calendarDay(new Date(lt-1),'America/Los_Angeles'),day);assert.notEqual(calendarDay(lt,'America/Los_Angeles'),day);
 }
 assert.equal(calendarRange('2026-10-31','2026-11-02','Europe/Dublin').gte.toISOString(),'2026-10-31T00:00:00.000Z');
 assert.equal(calendarRange('2026-10-31','2026-10-31','Asia/Tokyo').gte.toISOString(),'2026-10-30T15:00:00.000Z');
 assert.equal(validCalendarDay('2026-02-30'),false);assert.throws(()=>calendarRange('2026-11-02','2026-11-01','UTC'));
});
test('answer envelopes, fences and double encoding render all answers as readable text',()=>{
 const envelope={answers:[{question:'First?',answer:'I built it—carefully.'},{question:'Second?',answer:'I reviewed it.'}]};
 const expected='First?\n\nI built it-carefully.\n\nSecond?\n\nI reviewed it.';
 for(const value of [JSON.stringify(envelope),'```json\n'+JSON.stringify(envelope)+'\n```',JSON.stringify(JSON.stringify(envelope))])assert.equal(readableAnswer(value),expected);
 assert.equal(readableAnswer('Plain prose—kept.'),'Plain prose-kept.');
 assert.deepEqual(normalizeAiText({summary:'A—B',bullets:['C—D'],count:2,other:null}),{summary:'A-B',bullets:['C-D'],count:2,other:null});
 assert.equal(readableAnswer('Use {x: 1} in code.'),'Use {x: 1} in code.');
});
test('account time zones are private, round-trip and reject invalid values',async()=>{
 const values=new Map(),service=new SettingsService({systemSetting:{findUnique:async({where})=>({value:values.get(where.key)}),upsert:async args=>values.set(args.where.key,args.update.value)}});
 await service.setTimeZone('owner','Europe/London');assert.equal((await service.getTimeZone('owner')).timeZone,'Europe/London');
 assert.equal((await service.getTimeZone('other')).timeZone,null);await assert.rejects(service.setTimeZone('owner','Mars/City'),/IANA/);
});
test('application date filters reach the database with account zone and keep empty ranges empty',async()=>{
 let where;
 const service=new ApplicationsService({systemSetting:{findUnique:async()=>({value:'America/Los_Angeles'})},application:{findMany:async args=>{where=args.where;return[];}}},{},{},{});
 const results=await service.findAll({id:'owner',role:'BIDDER'},{from:'2026-11-01',to:'2026-11-01'});
 assert.deepEqual(results,[]);assert.equal(where.bidderId,'owner');assert.equal(where.createdAt.gte.toISOString(),'2026-11-01T07:00:00.000Z');assert.equal(where.createdAt.lt.toISOString(),'2026-11-02T08:00:00.000Z');
 await assert.rejects(service.findAll({id:'owner',role:'BIDDER'},{from:'2026-10-31',to:'2026-10-30'}),/valid/);
});
test('profile duplicate filtering excludes the union of own applications and marks only',async()=>{
 const calls=[];const service=new JobPoolService({profile:{findMany:async args=>{calls.push(args);return[{id:'p1'},{id:'p2'}];}},application:{findMany:async args=>{calls.push(args);return[{company:' A C M E '}];}},jobPoolApplied:{findMany:async args=>{calls.push(args);return[{job:{companyKey:'secondcompany'}}];}}},{});
 const where=await service.companyFilters({id:'owner',role:'BIDDER'},{excludeProfileIds:'p1,p2,p1'},new Date());
 assert.deepEqual(new Set(where.companyKey.notIn),new Set(['acme','secondcompany']));
 assert.equal(calls[0].where.assignments.some.userId,'owner');assert.equal(calls[1].where.bidderId,'owner');assert.deepEqual(calls[1].where.profileId.in,['p1','p2']);assert.equal(calls[2].where.userId,'owner');
 await assert.rejects(service.companyFilters({id:'owner',role:'BIDDER'},{excludeProfileIds:'bad!'},new Date()),/valid profiles/);
 service.prisma.profile.findMany=async()=>[];
 await assert.rejects(service.companyFilters({id:'owner',role:'BIDDER'},{excludeProfileIds:'p3'},new Date()),/access/);
});
test('reads recover from upstream restarts but arbitrary writes are never replayed',async()=>{
 let calls=0;const options={fetcher:async()=>++calls<3?new Response('upstream unavailable',{status:502}):json({ok:true}),wait:async()=>{}};
 assert.deepEqual(await responseJson(await fetchWithRecovery('https://qa.invalid',{},options)),{ok:true});assert.equal(calls,3);
 calls=0;const response=await fetchWithRecovery('https://qa.invalid',{method:'POST',body:'{}'},options);assert.equal(response.status,502);assert.equal(calls,1);
 calls=0;const bodies=[];await fetchWithRecovery('https://qa.invalid',{method:'POST',body:'{"idempotencyKey":"same"}'},{...options,idempotent:true,fetcher:async(_url,init)=>{bodies.push(init.body);return options.fetcher();}});assert.equal(calls,3);assert.equal(new Set(bodies).size,1);
 await assert.rejects(responseJson(new Response('<html>502</html>',{status:502,headers:{'x-request-id':'qa-reference'}})),/temporarily unavailable.*qa-reference/);
});
test('cancelling aborts active work and terminal cancellation cannot be overwritten',async()=>{
 const row={id:'g',creatorId:'owner',status:'GENERATING'};
 const prisma={resumeGeneration:{findUnique:async()=>({...row}),updateMany:async({where,data})=>{if(!where.status.in.includes(row.status))return{count:0};Object.assign(row,data);return{count:1};}}};
 const service=new GenerationsService(prisma,{},{},{},{},{},{getJob:async()=>{throw Error('Redis restarting');}},{});
 service.getAccessibleGeneration=async()=>({...row});service.findOne=async()=>({...row});
 const work=service.withCancellation('g',signal=>new Promise((resolve,reject)=>{signal.addEventListener('abort',()=>reject(signal.reason));if(signal.aborted)reject(signal.reason);}));
 const stopped=assert.rejects(work,/cancelled/i);await new Promise(resolve=>setImmediate(resolve));await service.cancel('g',{id:'owner'});await stopped;
 assert.equal(row.status,'CANCELLED');await assert.rejects(service.updateStatus('g','COMPLETED',{}),/cancelled/i);assert.equal(row.status,'CANCELLED');
 await assert.rejects(service.cancel('g',{id:'other'}),/creator/);
 row.status='COMPLETED';await service.cancel('g',{id:'owner'});assert.equal(row.status,'COMPLETED');
});
test('transient database refresh failures remain server errors instead of invalidating credentials',async()=>{
 const failure=Object.assign(new Error('Database unavailable'),{code:'P1001'});
 const auth=new AuthService({user:{findUnique:async()=>{throw failure;}}},{verify:()=>({sub:'owner'})},{get:()=>undefined},{});
 await assert.rejects(auth.refresh('valid-token'),error=>error===failure);
 auth.jwt.verify=()=>{throw Object.assign(new Error('expired'),{name:'TokenExpiredError'});};await assert.rejects(auth.refresh('expired'),error=>error.getStatus()===401);
});
