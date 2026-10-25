const {test}=require('node:test'),assert=require('node:assert/strict');
const {fetchJobPage}=require('../dist/job-pool/job-providers');
const {himalayasCountries,HIMALAYAS_SEARCHES}=require('../dist/job-pool/himalayas-feed');
const {JobPoolService}=require('../dist/job-pool/job-pool.service');
const row={guid:'himalayas-1',title:'Senior Software Engineer',companyName:'New Employer',description:'Build software and APIs.',locationRestrictions:['United States','United Kingdom','Ireland'],timezoneRestrictions:[],applicationLink:'https://himalayas.app/companies/new-employer/jobs/engineer',pubDate:1792800000,expiryDate:4102444800};
test('Himalayas preserves attribution links and separates update dates from original publication',async()=>{
 const page=await fetchJobPage({provider:'himalayas',boardToken:'gb-software',name:'Himalayas'},null,async url=>{assert.equal(url.searchParams.get('country'),'GB');assert.equal(url.searchParams.get('q'),'software');return{jobs:[row],totalCount:21};});
 assert.equal(page.next,'2');assert.equal(page.complete,false);assert.equal(page.jobs.length,1);
 assert.equal(page.jobs[0].jobUrl,row.applicationLink);assert.equal(page.jobs[0].publishedAt,null);assert.equal(page.jobs[0].sourceUpdatedAt.getTime(),row.pubDate*1000);assert.deepEqual(page.jobs[0].eligibleCountries,['US','GB','IE']);
});
test('successful daily feeds wait 24 hours while failed feeds can recover after their cooldown',async()=>{
 const attempt=new Date(Date.now()-2*3600000);let ids;
 const sources=[{id:'successful',provider:'himalayas',enabled:true,lastAttemptAt:attempt,lastSyncedAt:new Date(attempt.getTime()+1000),nextSyncAt:new Date(Date.now()+22*3600000),lastError:null},{id:'failed',provider:'himalayas',enabled:true,lastAttemptAt:attempt,lastSyncedAt:new Date(attempt.getTime()-86400000),nextSyncAt:new Date(Date.now()-3600000),lastError:'Source request failed.'}];
 const service=new JobPoolService({jobPoolSource:{findMany:async()=>sources,updateMany:async args=>{ids=args.where.id.in;return{count:ids.length};}}},{});service.startWorker=async()=>{};
 assert.equal((await service.sync({id:'master',role:'MASTER'},{})).queued,1);assert.deepEqual(ids,['failed']);
});
test('Himalayas handles numeric and string timezones, explicit worldwide scope, and rejects ambiguous geography',()=>{
 assert.deepEqual(himalayasCountries({...row,locationRestrictions:[],timezoneRestrictions:['UTC+0','UTC+1']},''),['GB','IE']);
 assert.deepEqual(himalayasCountries({...row,timezoneRestrictions:[-8,-5]},''),['US']);
 assert.deepEqual(himalayasCountries({...row,timezoneRestrictions:['unknown']},''),[]);
 assert.deepEqual(himalayasCountries({...row,locationRestrictions:['Germany']},''),[]);
 assert.deepEqual(himalayasCountries({...row,locationRestrictions:undefined},''),[]);
 assert.equal(HIMALAYAS_SEARCHES.length,21);
});
test('Himalayas rejects replaced application links, expired jobs and invalid cursors without requests',async()=>{
 const source={provider:'himalayas',boardToken:'us-software',name:'Himalayas'};
 const page=await fetchJobPage(source,null,async()=>({jobs:[{...row,applicationLink:'https://jobs.ashbyhq.com/another/id'},{...row,expiryDate:1},{...row,title:'Sales Manager'}],totalCount:3}));
 assert.equal(page.jobs.length,0);
 await assert.rejects(fetchJobPage(source,'https://evil.example',async()=>{throw Error('must not call');}),/Invalid Himalayas/);
});
