require('reflect-metadata');
const {test}=require('node:test'), assert=require('node:assert/strict');
const {fetchJobPage,sourceCountries}=require('../dist/job-pool/job-providers');
const {JobPoolService}=require('../dist/job-pool/job-pool.service');
const source={provider:'pinpoint',boardToken:'example',name:'Example'};

test('Pinpoint reads its keyless postings feed and keeps remote software roles in each eligible country',async()=>{
  const base={id:'one',title:'Software Engineer',url:'https://example.pinpointhq.com/en/postings/one',workplace_type:'remote',description:'Build reliable software APIs',key_responsibilities:'TypeScript',skills_knowledge_expertise:'Postgres',compensation_visible:true,compensation:'GBP 80,000',deadline_at:'2099-01-01',employment_type_text:'Full time'};
  const locations=['United States','United Kingdom','Ireland','Worldwide'];
  const result=await fetchJobPage(source,null,async url=>{
    assert.equal(url.href,'https://example.pinpointhq.com/postings.json');
    return {data:[...locations.map((name,index)=>({...base,id:String(index),location:{name}})),
      {...base,location:{name:'Germany'}},{...base,location:{name:'Remote'}},
      ...['hybrid','on_site',null].map(workplace_type=>({...base,workplace_type,location:{name:'United Kingdom'}})),
      {...base,location:{name:'Ireland'},title:'Account Executive'},
      {...base,location:{name:'United Kingdom'},active:false},
      {...base,location:{name:'Worldwide'},description:'Build software. You must reside in Germany.'}]};
  });
  assert.equal(result.complete,true);assert.equal(result.jobs.length,4);
  assert.deepEqual(result.jobs.map(job=>job.eligibleCountries),[['US'],['GB'],['IE'],['US','GB','IE']]);
  assert.match(result.jobs[0].description,/TypeScript[\s\S]*Postgres/);
  assert.equal(result.jobs[0].salary,'GBP 80,000');assert.equal(result.jobs[0].publishedAt,null);
  const hiddenSalary=await fetchJobPage(source,null,async()=>({data:[{...base,compensation_visible:false,location:{name:'Remote',city:'London'}}]}));
  assert.equal(hiddenSalary.jobs[0].salary,null);assert.deepEqual(hiddenSalary.jobs[0].eligibleCountries,['GB']);
});

test('Pinpoint malformed responses and unsafe board names fail without following another host',async()=>{
  for(const data of [{jobs:[]},{data:null},{data:[null]}]) await assert.rejects(fetchJobPage(source,null,async()=>data),/jobs list/);
  const incomplete=await fetchJobPage(source,null,async()=>({data:[{title:'Software Engineer',workplace_type:'remote'}]}));
  assert.equal(incomplete.complete,false);assert.equal(incomplete.incomplete,true);
  for(const boardToken of ['example.com','example/other','../localhost','user@host','example?host=elsewhere'])
    await assert.rejects(fetchJobPage({...source,boardToken},null,async()=>{throw Error('Must not request');}),/Invalid employer/);
});

test('Source monitoring capability counts shared boards once, respecting country-specific feeds',()=>{
  assert.deepEqual(sourceCountries(source),['US','GB','IE']);
  for(const provider of ['greenhouse','lever','ashby','remoteok','freehire','ocean'])assert.deepEqual(sourceCountries({provider,boardToken:''}),['US','GB','IE']);
  for(const [boardToken,countries] of [['',['US']],['usa',['US']],['uk',['GB']],['ireland',['IE']],['anywhere',['US','GB','IE']],['invalid',[]]])assert.deepEqual(sourceCountries({provider:'jobicy',boardToken}),countries);
  assert.deepEqual(sourceCountries({provider:'usajobs',boardToken:''}),['US']);assert.deepEqual(sourceCountries({provider:'unknown',boardToken:''}),[]);
});

test('Master country coverage distinguishes monitoring, successful reads, matching sources and overlapping jobs',async()=>{
  const sources=[{id:'shared',...source,enabled:true,lastSyncedAt:new Date()},
    {id:'pending',provider:'greenhouse',boardToken:'example',enabled:true,lastSyncedAt:null},
    {id:'disabled',provider:'lever',boardToken:'example',enabled:false,lastSyncedAt:null},
    {id:'uk',provider:'jobicy',boardToken:'uk',enabled:true,lastSyncedAt:null}];
  let query;
  const service=new JobPoolService({systemSetting:{findUnique:async()=>null},jobPoolSource:{findMany:async()=>sources},jobPoolJob:{groupBy:async q=>{query=q;return [
    {sourceId:'shared',eligibleCountries:['US','GB','IE'],_count:{_all:2}},
    {sourceId:'shared',eligibleCountries:['GB'],_count:{_all:3}},
    {sourceId:null,eligibleCountries:['IE'],_count:{_all:1}},
  ];}}},{});
  for(const role of ['BIDDER','ADMIN'])await assert.rejects(service.manage({role}),/Only Master/);
  const {coverage}=await service.manage({role:'MASTER'});
  assert.deepEqual(coverage.map(c=>[c.country,c.target,c.monitoredSources,c.successfullyReadSources,c.matchingSources,c.availableJobs]),[
    ['US',10000,2,1,1,2],['GB',10000,3,1,1,5],['IE',10000,2,1,1,3],
  ]);
  assert.equal(query.where.hidden,false);assert.equal(query.where.isActive,true);assert.equal(query.where.isSoftware,true);assert.equal(query.where.workArrangement,'REMOTE');assert.ok(query.where.lastSeenAt.gte);assert.ok(query.where.OR.some(item=>item.expiresAt?.gt));
  const summary=await service.manage({role:'MASTER'},true);
  assert.equal('sources' in summary,false);assert.equal(summary.sourceStats.totalSources,4);assert.equal(summary.sourceStats.enabledSources,3);
  assert.deepEqual(summary.coverage,coverage);assert.equal(summary.sourceTarget,30000);
});
