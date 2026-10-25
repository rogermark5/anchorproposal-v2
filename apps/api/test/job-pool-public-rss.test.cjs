require('reflect-metadata');
const {test}=require('node:test'),assert=require('node:assert/strict');
const {fetchJobPage,jobDate,FeedError}=require('../dist/job-pool/job-providers');
const {publicRssUrl,parsePublicRssResponse,USEFUL_FREE_FEEDS,REMOTE_FIRST_CATEGORIES}=require('../dist/job-pool/public-rss-feeds');
const {JobPoolService}=require('../dist/job-pool/job-pool.service');
const {freehireUrl,FREEHIRE_SOURCES}=require('../dist/job-pool/freehire-feed');
const now=()=>new Date().toISOString();
const link='https://remotefirstjobs.com/companies/example/jobs/software-engineer-123';
const row=(extra={})=>({title:'Software Engineer at Example',link,pubDate:now(),description:'<p>Build production software and APIs.</p>',...extra});
const posting=(extra={})=>({'@type':'JobPosting',identifier:{value:'software-engineer-123'},title:'Software Engineer',hiringOrganization:{name:'Example'},jobLocationType:'TELECOMMUTE',applicantLocationRequirements:[{'@type':'Country',name:'US'},{'@type':'Country',name:'United Kingdom'},{'@type':'Country',name:'Ireland'}],...extra});

test('public RSS parsing is bounded, entity-safe, and never executes job-page scripts',()=>{
 const url=publicRssUrl('wwr','',null);
 const xml='<rss><channel><title>Jobs</title><item><title>Example: Software Engineer</title><description>&lt;p&gt;Build software&lt;/p&gt;</description></item></channel></rss>';
 assert.equal(parsePublicRssResponse(url,xml).jobs.length,1);
 assert.equal(parsePublicRssResponse(publicRssUrl('remotefirst','web3',null),xml).jobs.length,1);
 assert.deepEqual(parsePublicRssResponse(url,'<rss><channel><title>Jobs</title></channel></rss>').jobs,[]);
 for(const bad of ['<html>blocked</html>','<!DOCTYPE x [<!ENTITY ex SYSTEM "file:///private">]><rss/>','<rss>'])assert.throws(()=>parsePublicRssResponse(url,bad));
 const html='<script>throw Error("must not execute")</script><script type="application/ld+json">'+JSON.stringify({'@graph':[posting({description:'not needed in metadata cache'})]})+'</script>';
 const detail=parsePublicRssResponse(new URL(link),html);assert.equal(detail.posting.title,'Software Engineer');assert.equal(detail.posting.description,undefined);
 assert.equal(parsePublicRssResponse(new URL('https://untrusted.example/'),html),undefined);
});

test('RSS feeds accept only supported categories and fixed public endpoints',async()=>{
 for(const [provider,category,cursor] of [['remotefirst','../../outside',null],['remotefirst','unknown',null],['wwr','', '1'],['wwr','other',null]]){
  let called=false;await assert.rejects(fetchJobPage({provider,name:'Feed',boardToken:category},cursor,async()=>{called=true;}));assert.equal(called,false);
 }
 assert.ok(REMOTE_FIRST_CATEGORIES.length>=6);assert.ok(USEFUL_FREE_FEEDS.length>=393);
 assert.equal(new Set(USEFUL_FREE_FEEDS.map(feed=>feed.provider+':'+feed.boardToken)).size,USEFUL_FREE_FEEDS.length);
});

test('Remote First Jobs uses source timestamps and structured applicant countries, never headquarters',async()=>{
 const published=now();let calls=0;
 const result=await fetchJobPage({provider:'remotefirst',name:'Remote First Jobs',boardToken:'software-development'},null,async url=>{
  calls++;if(calls===1){assert.equal(url.pathname,'/rss/jobs/software-development.rss');return{jobs:[row({pubDate:published})]};}
  assert.equal(url.href,link);return{posting:posting({jobLocation:{address:{addressCountry:'Germany'}}})};
 });
 assert.equal(calls,2);assert.equal(result.jobs.length,1);assert.equal(result.jobs[0].jobUrl,link);
 assert.equal(result.jobs[0].publishedAt.toISOString(),published);assert.equal(result.jobs[0].description,'Build production software and APIs.');
 assert.deepEqual(result.jobs[0].eligibleCountries,['US','GB','IE']);assert.equal(result.jobs[0].sourceName,'Remote First Jobs');assert.equal(result.complete,true);
});

test('Remote First Jobs skips old postings before details and rejects foreign, hybrid and ambiguous eligibility',async()=>{
 let calls=0;
 const source={provider:'remotefirst',name:'Remote First Jobs',boardToken:'qa'};
 const old=await fetchJobPage(source,null,async()=>{calls++;return{jobs:[row({pubDate:new Date(Date.now()-3*86400000).toISOString()}),row({pubDate:null}),row({title:'Account Executive'})]};});
 assert.equal(calls,1);assert.equal(old.jobs.length,0);
 for(const change of [{jobLocationType:'HYBRID'},{title:'Software Engineer - Onsite'},{applicantLocationRequirements:[{name:'Germany','@type':'Country'}]},{applicantLocationRequirements:[],jobLocation:[]}]){
  let count=0;const page=await fetchJobPage(source,null,async()=>++count===1?{jobs:[row()]}:{posting:posting(change)});assert.equal(page.jobs.length,0);
 }
});

test('unsafe posting URLs and mismatched metadata cannot escape the approved host',async()=>{
 const source={provider:'remotefirst',name:'Remote First Jobs',boardToken:'data'};
 for(const value of ['https://evil.example/job','https://remotefirstjobs.com.evil.example/companies/example/jobs/engineer-123','https://remotefirstjobs.com/companies/example/jobs/engineer-123?redirect=http://localhost']){
  let calls=0;await assert.rejects(fetchJobPage(source,null,async()=>{calls++;return{jobs:[row({link:value})]};}),/posting link/);assert.equal(calls,1);
 }
 let count=0;await assert.rejects(fetchJobPage(source,null,async()=>++count===1?{jobs:[row()]}:{posting:posting({identifier:{value:'other-role-456'}})}),/different posting/);
 count=0;const missing=await fetchJobPage(source,null,async()=>{if(++count===1)return{jobs:[row()]};throw new FeedError('Closed',3600000,404);});assert.equal(missing.jobs.length,0);
});

test('We Work Remotely preserves publication and source links while respecting country restrictions',async()=>{
 const source={provider:'wwr',name:'We Work Remotely',boardToken:''};
 const base={title:'Example: Software Engineer',region:'Anywhere in the World',description:'Build production software and APIs.',pubDate:now(),link:'https://weworkremotely.com/remote-jobs/example-software-engineer'};
 const page=await fetchJobPage(source,null,async()=>({jobs:[base,{...base,country:'🇺🇸 United States of America'},{...base,country:'Germany'},{...base,region:'Europe'},{...base,title:'Example: Account Executive'},{...base,link:'https://evil.example/jobs/1'}]}));
 assert.equal(page.jobs.length,2);assert.deepEqual(page.jobs[0].eligibleCountries,['US','GB','IE']);assert.deepEqual(page.jobs[1].eligibleCountries,['US']);
 assert.equal(page.jobs[0].company,'Example');assert.equal(page.jobs[0].title,'Software Engineer');assert.equal(page.jobs[0].sourceName,'We Work Remotely');assert.equal(page.jobs[0].jobUrl,base.link);
});

test('new employer systems query recent source posting dates and retain existing source settings',async()=>{
 for(const name of ['trinethire','taleobe','factorial','neogov']){
  assert.ok(FREEHIRE_SOURCES.includes(name));const url=freehireUrl(null,name);
  assert.equal(url.searchParams.get('source'),name);assert.equal(url.searchParams.get('posted_within_days'),'2');assert.equal(url.searchParams.get('sort'),'posted_at');
 }
 const writes=[];const service=new JobPoolService({jobPoolSource:{upsert:async args=>{writes.push(args);return args.create;}}},{});
 await service.ensureUsefulFreeFeeds();assert.equal(writes.length,USEFUL_FREE_FEEDS.length);
 assert.ok(writes.every(args=>Object.keys(args.update).length===0&&args.create.enabled&&args.create.queued));
 const date=new Date();assert.equal(jobDate(date).getTime(),date.getTime());assert.equal(jobDate(new Date('invalid')),null);
});
