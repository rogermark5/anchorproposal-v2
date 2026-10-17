const {test}=require('node:test');const assert=require('node:assert/strict');
const {fetchJobPage,FeedError}=require('../dist/job-pool/job-providers');
const source={provider:'ocean',boardToken:'',name:'Ocean of Jobs'};
const row=(overrides={})=>({id:'12345678',title:'Software Engineer',company_name:'Employer',company_domain:'employer.example',ats:'workday',location:'Remote, United States',workplace_type:'remote',confidence:'verified',closed_at:null,last_seen:new Date().toISOString(),url:'https://employer.example/jobs/123',description:'Build software and APIs',posted_at:'2026-10-01T12:00:00Z',salary_text:'USD 150,000 / year',salary_is_estimate:0,...overrides});
const page=(jobs,total=jobs.length,offset=0)=>({jobs,total,offset,limit:500});

test('Ocean requests verified US remote technology roles and obtains full descriptions from its fixed API host',async()=>{
  const calls=[];const result=await fetchJobPage(source,null,async url=>{calls.push(url);return calls.length===1?page([row()]):row();});
  assert.equal(calls[0].searchParams.get('country'),'US');assert.equal(calls[0].searchParams.get('workplace'),'remote');assert.equal(calls[0].searchParams.get('confidence'),'verified');assert.equal(calls[0].searchParams.get('limit'),'500');
  assert.equal(calls[1].href,'https://oceanofjobs.com/api/jobs/12345678');assert.equal(result.jobs.length,1);assert.equal(result.jobs[0].description,'Build software and APIs');assert.equal(result.jobs[0].jobUrl,row().url);assert.equal(result.jobs[0].sourceName,'Ocean of Jobs · workday');assert.equal(result.complete,true);
});

test('Ocean skips existing primary postings and rejects metadata for unrelated, closed or non-US jobs before detail requests',async()=>{
  let details=0;const candidates=[row(),row({title:'Recruiter'}),row({location:'Canada'}),row({workplace_type:'hybrid'}),row({closed_at:new Date().toISOString()}),row({confidence:'best_effort'}),row({location:'US - Onsite'})];
  const result=await fetchJobPage(source,null,async url=>{if(url.pathname==='/api/jobs')return page(candidates);details++;return row();},()=>true);
  assert.equal(details,0);assert.equal(result.jobs.length,0);assert.equal(result.complete,true);
});

test('Ocean rechecks detail eligibility, discards stale and closed jobs, and hides estimated pay',async()=>{
  for(const change of [{closed_at:new Date().toISOString()},{last_seen:new Date(Date.now()-8*86400_000).toISOString()},{location:'Worldwide'},{workplace_type:'onsite'},{description:''}]){
    let i=0;const result=await fetchJobPage(source,null,async()=>++i===1?page([row()]):row(change));assert.equal(result.jobs.length,0);
  }
  let i=0;const result=await fetchJobPage(source,null,async()=>++i===1?page([row()]):row({salary_is_estimate:1}));assert.equal(result.jobs[0].salary,null);
});

test('Ocean pagination counts raw rows and detects incomplete and excessively deep searches',async()=>{
  const filtered=Array.from({length:500},()=>row({title:'Recruiter'}));
  const result=await fetchJobPage(source,'500',async()=>page(filtered,1001,500));assert.equal(result.next,'1000');assert.equal(result.jobs.length,0);
  await assert.rejects(fetchJobPage(source,null,async()=>page([],100)),/incomplete/);
  await assert.rejects(fetchJobPage(source,null,async()=>page([row()],500)),/incomplete/);
  await assert.rejects(fetchJobPage(source,'10000',async()=>page(filtered,11000,10000)),/pagination limit/);
  for(const cursor of ['500.1','-500','10500','http://evil.example'])await assert.rejects(fetchJobPage(source,cursor,async()=>{throw Error('Must not request')}),/cursor/);
});

test('Ocean never follows untrusted detail URLs and treats missing or failed details explicitly',async()=>{
  let i=0;await assert.rejects(fetchJobPage(source,null,async()=>++i===1?page([row({id:'../../bad'})]):row()),/posting ID/);
  i=0;const closed=await fetchJobPage(source,null,async()=>{if(++i===1)return page([row()]);throw new FeedError('gone',3600_000,404);});assert.equal(closed.jobs.length,0);
  i=0;await assert.rejects(fetchJobPage(source,null,async()=>{if(++i===1)return page([row()]);throw new FeedError('try later',3600_000,503);}),/try later/);
});

test('Ocean imports valid details when another posting has no description and reports incomplete coverage',async()=>{
  const candidates=[row(),row({id:'87654321',url:'https://employer.example/jobs/456'})];
  const result=await fetchJobPage(source,null,async url=>url.pathname==='/api/jobs'?page(candidates):url.pathname.endsWith('/87654321')?row({id:'87654321',description:null}):row());
  assert.equal(result.jobs.length,1);assert.equal(result.incomplete,true);assert.equal(result.complete,false);assert.equal(result.next,null);
});
