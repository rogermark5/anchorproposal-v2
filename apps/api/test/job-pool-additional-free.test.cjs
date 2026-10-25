require('reflect-metadata');
const {test}=require('node:test'),assert=require('node:assert/strict');
const {fetchJobPage,JOB_PROVIDERS}=require('../dist/job-pool/job-providers');
const {ADDITIONAL_FREE_FEEDS}=require('../dist/job-pool/additional-free-feeds');
const {FREEHIRE_SOURCES,freehireCursor,freehireUrl}=require('../dist/job-pool/freehire-feed');
const now=()=>new Date().toISOString(),source=(provider,boardToken='')=>({provider,boardToken,name:'Feed'});
const job={title:'Software Engineer',company:'Example',location:'United States',description:'Build production software and APIs.'};

test('all additions are keyless fixed-endpoint providers and employer cursors retain append-only indexes',()=>{
 assert.equal(ADDITIONAL_FREE_FEEDS.length,11);
 for(const name of ['arbeitnow','onjob','nomado','remote-network'])assert.ok(JOB_PROVIDERS.some(p=>p.id===name));
 assert.equal(FREEHIRE_SOURCES.length,188);assert.equal(new Set(FREEHIRE_SOURCES).size,188);
 assert.equal(freehireCursor(null,'workday').index,0);assert.equal(freehireCursor(null,'trinethire').index,68);
 const tail=FREEHIRE_SOURCES.at(-1),index=FREEHIRE_SOURCES.length-1;
 assert.equal(freehireUrl(`${index}:100`,tail).searchParams.get('source'),tail);
 for(const bad of ['188:0','999:0','1:99','1000:0'])assert.throws(()=>freehireCursor(bad));
});

test('Arbeitnow preserves source date, explicit remote status and country without inferring UK eligibility from the feed',async()=>{
 const published=Math.floor(Date.now()/1000),base={...job,slug:'engineer',url:'https://www.arbeitnow.co.uk/jobs/engineer',company_name:'Example',remote:true,created_at:published};
 const result=await fetchJobPage(source('arbeitnow','uk'),null,async url=>{
  assert.equal(url.hostname,'www.arbeitnow.co.uk');return{data:[base,{...base,remote:false},{...base,location:'Remote'},{...base,location:'Germany'},{...base,url:'https://untrusted.example/jobs/engineer'}],meta:{current_page:1},links:{next:null}};
 });
 assert.equal(result.jobs.length,1);assert.equal(result.jobs[0].publishedAt.getTime(),published*1000);assert.deepEqual(result.jobs[0].eligibleCountries,['US']);
 assert.equal(result.jobs[0].sourceName,'Arbeitnow');
});

test('public pagination rejects unsafe URLs, malformed rows, ignored pages and invalid edition before fetching',async()=>{
 let calls=0;await assert.rejects(fetchJobPage(source('arbeitnow','invalid'),null,async()=>{calls++;}),/edition/);assert.equal(calls,0);
 for(const payload of [{data:[null],meta:{current_page:1},links:{}},{data:[],meta:{current_page:2},links:{}},{data:[],meta:{current_page:1},links:{next:'https://evil.example/api/job-board-api?page=2'}}])await assert.rejects(fetchJobPage(source('arbeitnow','uk'),null,async()=>payload));
 await assert.rejects(fetchJobPage(source('onjob'),'https://evil.example',async()=>{}),/cursor/);
});

test('OnJob validates complete pagination and uses source publication and canonical attribution links',async()=>{
 const published=now(),row={...job,id:'one',remote:true,countryCode:'US',url:'https://onjob.io/job/one',datePosted:published,descriptionHtml:job.description,jsonLd:{jobLocationType:'TELECOMMUTE'}};
 const payload={page:1,totalPages:2,totalCount:2,count:1,next:'https://onjob.io/feeds/jobs/2.json',jobs:[row]};
 const page=await fetchJobPage(source('onjob'),null,async()=>payload);
 assert.equal(page.jobs.length,1);assert.equal(page.next,'2');assert.equal(page.complete,false);assert.equal(page.jobs[0].publishedAt.toISOString(),published);assert.equal(page.jobs[0].jobUrl,row.url);
 await assert.rejects(fetchJobPage(source('onjob'),null,async()=>({...payload,next:'https://evil.example/2.json'})),/unsafe/);
 const foreign=await fetchJobPage(source('onjob'),null,async()=>({...payload,jobs:[{...row,countryCode:'DE'}]}));assert.equal(foreign.jobs.length,0);
});

test('Nomado24 accepts only employer publication provenance, preserves dates, and rejects indirect board timestamps',async()=>{
 const published=now(),base={...job,id:'one',canonicalUrl:'https://www.nomado24.com/en/remote-jobs/job/engineer',company:{name:'Example'},description:{html:job.description},workArrangement:'remote',status:'active',publishedAt:published,firstSeenAt:now(),source:{id:'greenhouse',kind:'ats'},dataOrigin:{fields:{'/publishedAt':{type:'source_fact',sourceId:'greenhouse'}}},applicantLocations:{countries:['US'],worldwide:false,rawText:'United States'}};
 const payload={resultStatus:'ok',pagination:{cursor:null,nextCursor:null,hasNext:false,limit:100},data:[base,{...base,source:{id:'himalayas',kind:'job_board'}},{...base,dataOrigin:{fields:{'/publishedAt':{type:'nomado24_classification'}}}},{...base,applicantLocations:{countries:['DE'],worldwide:true}},{...base,workArrangement:'hybrid'}]};
 const page=await fetchJobPage(source('nomado'),null,async url=>{assert.equal(url.searchParams.get('applicant_region'),'US,GB,IE');return payload;});
 assert.equal(page.jobs.length,1);assert.equal(page.jobs[0].publishedAt.toISOString(),published);assert.deepEqual(page.jobs[0].eligibleCountries,['US']);
 const unknown=await fetchJobPage(source('nomado'),null,async()=>({...payload,data:[{...base,publishedAt:null}]}));assert.equal(unknown.jobs[0].publishedAt,null,'Never replace missing original publication with firstSeenAt');
});

test('Nomado cursors remain bound to the fixed host and malformed pagination does not complete',async()=>{
 const payload={resultStatus:'ok',pagination:{cursor:null,nextCursor:'eyTestCursor',hasNext:true,limit:100},data:[]};
 // Empty pages may carry a next cursor; the client must still traverse them.
 const page=await fetchJobPage(source('nomado'),null,async()=>payload);assert.equal(page.complete,false);assert.equal(page.next,'eyTestCursor');
 for(const cursor of ['https://evil.example','../etc','a=b'])await assert.rejects(fetchJobPage(source('nomado'),cursor,async()=>{}));
 await assert.rejects(fetchJobPage(source('nomado'),null,async()=>({...payload,pagination:{...payload.pagination,nextCursor:'https://evil.example'}})),/pagination/);
});

test('Remote Jobs network fetches full descriptions, source ISO publication and keeps attributed links',async()=>{
 const id='cmvtest123456789',published=now(),base={id,title:job.title,isoDate:published};let calls=0;
 const page=await fetchJobPage(source('remote-network','backend'),null,async url=>{
  calls++;if(url.pathname==='/api/jobs'){assert.equal(url.searchParams.get('board'),'backend');return[base,{...base,id:'old1234567890',isoDate:'2020-01-01T00:00:00Z'}];}
  return{...base,author:'Example',location:'United States',content:job.description,workModel:'fully_remote',createdAt:'2020-01-01T00:00:00Z',link:'https://jobs.lever.co/example/id'};
 });
 assert.equal(calls,2);assert.equal(page.jobs.length,1);assert.equal(page.jobs[0].publishedAt.toISOString(),published);assert.equal(page.jobs[0].description,job.description);assert.equal(page.jobs[0].jobUrl,'https://www.remotefrontendjobs.com/'+id);
});

test('Remote Jobs network caps cannot close existing jobs and ambiguous regional eligibility is skipped',async()=>{
 const rows=Array.from({length:50},(_,i)=>({id:'oldtest123456789'+i,isoDate:'2020-01-01T00:00:00Z'}));
 const page=await fetchJobPage(source('remote-network','java'),'200',async()=>rows);assert.equal(page.complete,false);assert.equal(page.incomplete,true);
 const id='cmvtest123456789';let calls=0;
 const result=await fetchJobPage(source('remote-network','frontend'),null,async()=>++calls===1?[{id,title:job.title,isoDate:now()}]:{id,title:job.title,author:'Example',isoDate:now(),content:job.description,location:'Europe',geoRegions:['europe'],workModel:'fully_remote'});assert.equal(result.jobs.length,0);
});

test('AI Dev Jobs uses its source publication field and never update, import or generated timestamps',async()=>{
 const published=now(),base={...job,id:'one',company_name:'Example',description:job.description,url:'https://aidevboard.com/job/one',status:'active',workplace:'remote',remote_scope:'restricted',published_at:published,created_at:'2020-01-01T00:00:00Z'};
 const payload={jobs:[base,{...base,workplace:'hybrid'},{...base,location:'Remote'},{...base,location:'Germany'}],page:1,per_page:50,total:4,total_is_exact:true,total_pages:1,has_next:false,degraded:false,estimated:false};
 const page=await fetchJobPage(source('aidev'),null,async url=>{assert.equal(url.searchParams.get('posted_within_days'),'2');return payload;});
 assert.equal(page.jobs.length,1);assert.equal(page.jobs[0].publishedAt.toISOString(),published);
 const unknown=await fetchJobPage(source('aidev'),null,async()=>({...payload,jobs:[{...base,published_at:null}],total:1}));assert.equal(unknown.jobs[0].publishedAt,null);
 const empty=await fetchJobPage(source('aidev'),null,async()=>({...payload,jobs:null,total:0}));assert.equal(empty.jobs.length,0);assert.equal(empty.complete,true);
 await assert.rejects(fetchJobPage(source('aidev'),null,async()=>({...payload,jobs:null,total:4})),/jobs page/);
 for(const change of [{degraded:true},{estimated:true},{total_is_exact:false},{jobs:[],has_next:true}])await assert.rejects(fetchJobPage(source('aidev'),null,async()=>({...payload,...change})),/pagination/);
});
