require('reflect-metadata');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { ApplicationsService } = require('../dist/applications/applications.service');
const { JobPoolService } = require('../dist/job-pool/job-pool.service');

test('source posting windows are exact rolling hours, including the lower boundary, and compose with site/status/country', () => {
  const service = new JobPoolService({}, {}), now = new Date('2026-11-02T01:35:00Z');
  for (const days of [1,3,7,14,30]) {
    const where = service.jobFilters({id:'me',role:'BIDDER'}, {days:String(days),site:'greenhouse',country:'GB',status:'applied'}, now, now);
    assert.equal(where.publishedAt.gte.getTime(), now.getTime()-days*24*3600000);
    assert.equal(where.publishedAt.lte.getTime(), now.getTime());
    assert.equal(where.createdAt, undefined);
    assert.equal(where.postedAt, undefined);
    assert.deepEqual(where.source,{is:{provider:'greenhouse'}});
    assert.deepEqual(where.eligibleCountries,{has:'GB'});
    assert.deepEqual(where.appliedBy,{some:{userId:'me'}});
  }
});

test('company matching ignores case and every whitespace character, preserves punctuation and suffixes, and scopes to my accessible apps', async () => {
  let query;
  const rows = [
    {id:'a',company:'A C\tM\nE',jobTitle:'Engineer'},
    {id:'b',company:'ACME Inc.',jobTitle:'Developer'},
    {id:'c',company:'constructor',jobTitle:'Architect'},
  ];
  const service = new ApplicationsService({application:{findMany:async args=>{query=args;return rows;}}},{},{},{});
  const matches = await service.matchingCompanies({id:'me',role:'BIDDER'},['acme','con structor','Acme-Inc.']);
  assert.deepEqual(matches.acme,[{...rows[0],profileName:'Profile not recorded'}]);
  assert.deepEqual(matches.constructor,[{...rows[2],profileName:'Profile not recorded'}]);
  assert.equal(matches['acme-inc.'],undefined);
  assert.deepEqual(query.where,{bidderId:'me',profile:{assignments:{some:{userId:'me',activeTo:null}}}});
  for (const role of ['MASTER','ADMIN']) { await service.matchingCompanies({id:'me',role},['acme']);assert.deepEqual(query.where,{bidderId:'me'}); }
});

test('draft validation uses existing rules and permissions without creating records or returning other bidders applications', async () => {
  let checked = 0, input;
  const warning = {category:'REMOTE_CONFLICT',matchedText:'Hybrid work is required.',behavior:'BLOCK',severity:'BLOCK'};
  const service = new ApplicationsService({user:{findUnique:async()=>({canCreateApplications:true})}}, {checkAccess:async(id,user)=>{assert.equal(id,'profile');assert.equal(user.id,'me');checked++;}}, {
    validateApplication:async data=>{input=data;return {warnings:[warning],duplicates:[{id:'private-other-app'}]};},
    canGenerate:()=>({allowed:false,requiresConfirmation:false,requiresAdminReview:false}),
  }, {});
  const result = await service.validateDraft({profileId:'profile',jobDescription:'Hybrid work is required.'},{id:'me',role:'BIDDER'});
  assert.equal(checked,1);assert.equal(input.jobDescription,'Hybrid work is required.');
  assert.deepEqual(result.warnings,[warning]);assert.equal(result.allowed,false);assert.equal(result.duplicates,undefined);
  await assert.rejects(service.validateDraft({profileId:'profile',jobDescription:5},{id:'me',role:'BIDDER'}),/Invalid application/);
  await assert.rejects(service.validateDraft({}, {id:'me',role:'MASTER'}),/Master/);
  service.profilesService.checkAccess=async()=>{throw Error('Profile not assigned');};
  await assert.rejects(service.validateDraft({profileId:'profile'}, {id:'me',role:'BIDDER'}),/Profile not assigned/);
  service.prisma.user.findUnique=async()=>({canCreateApplications:false});
  await assert.rejects(service.validateDraft({profileId:'profile'}, {id:'me',role:'BIDDER'}),/permission/);
});

test('source posting filters compose with import snapshots and new-import notices', async () => {
  const queries=[];
  const service=new JobPoolService({systemSetting:{findUnique:async()=>null},jobPoolJob:{findMany:async args=>{queries.push(args);return [];},count:async args=>{queries.push(args);return 0;}}},{matchingCompanies:async()=>({})});
  const now = Date.now(), since = new Date(now-2*86400000).toISOString();
  const result=await service.list({id:'me',role:'BIDDER'},{days:'1'});
  assert.ok(queries[0].where.AND[0].publishedAt.gte instanceof Date);
  assert.ok(queries[0].where.AND[1].createdAt.lte instanceof Date);
  assert.deepEqual(queries[0].orderBy,[{publishedAt:{sort:'desc',nulls:'last'}},{id:'desc'}]);
  assert.ok(result.sites.length<30);assert.equal(result.sources,undefined);
  queries.length=0;
  await service.updates({id:'me',role:'BIDDER'},{days:'1',since});
  assert.ok(queries[1].where.AND[0].publishedAt.gte > new Date(since));
  assert.equal(queries[1].where.AND[1].createdAt.gt.toISOString(),since);
});

test('viewed writes use only authenticated ownership, preserve first view time, and reject inaccessible jobs', async () => {
  let lookup, write;
  const viewedAt=new Date('2026-10-18T10:00:00Z');
  const db={systemSetting:{findUnique:async()=>null},jobPoolJob:{findFirst:async args=>{lookup=args;return {id:'job'};}},jobPoolViewed:{upsert:async args=>{write=args;return {viewedAt};}}};
  const service=new JobPoolService(db,{});
  const result=await service.markViewed({id:'me',role:'BIDDER'},'job');
  assert.deepEqual(result,{viewed:true,viewedAt});
  assert.deepEqual(write,{where:{userId_jobId:{userId:'me',jobId:'job'}},create:{userId:'me',jobId:'job'},update:{}});
  assert.equal(lookup.where.hidden,false);assert.equal(lookup.where.isSoftware,true);assert.equal(lookup.where.workArrangement,'REMOTE');
  await service.markViewed({id:'master',role:'MASTER'},'job');
  assert.equal(lookup.where.id,'job');assert.equal(lookup.where.isSoftware,true);assert.equal(lookup.where.workArrangement,'REMOTE');assert.equal(lookup.where.NOT.length,6);
  db.jobPoolJob.findFirst=async()=>null;
  await assert.rejects(service.markViewed({id:'me',role:'BIDDER'},'job'),/no longer available/);
});

test('keyword edits during automatic imports preserve schedules without reading or rewriting the source catalog', async () => {
  let value = JSON.stringify({enabled:true,intervalHours:6,excludedTitleKeywords:['lead']});
  const db = {systemSetting:{findUnique:async()=>({value}),upsert:async args=>{value=args.update.value;}},$queryRaw:async()=>[],
    jobPoolSource:{findMany:async()=>{throw Error('Keyword changes must not reschedule sources');}}};
  db.$transaction = async callback=>callback(db);
  const service = new JobPoolService(db,{});let starts=0;service.startWorker=async()=>{starts++;};
  const result=await service.updateSettings({id:'master',role:'MASTER'},{excludedTitleKeywords:[' LEAD ','Director']});
  assert.deepEqual(result,{enabled:true,intervalHours:6,excludedTitleKeywords:['lead','director']});
  assert.deepEqual(JSON.parse(value),result);assert.equal(starts,1);
});
