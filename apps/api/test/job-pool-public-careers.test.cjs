const {test}=require('node:test'),assert=require('node:assert/strict');
const {fetchJobPage,readFeed}=require('../dist/job-pool/job-providers');
const {parseCareerResponse,validCareerBoard}=require('../dist/job-pool/public-career-feeds');
const token='00000000-0000-4000-8000-000000000001';
const source=(provider)=>({provider,boardToken:provider==='paylocity'?token:provider==='teamtailor'?'example.teamtailor.com':'example',name:'Example Employer'});
const countryJob=(country='GB')=>({'@type':'JobPosting',title:'Software Engineer',jobLocationType:'TELECOMMUTE',description:'Build software APIs',jobLocation:{address:{addressLocality:'Remote',addressCountry:country}}});
const feed=(items,extra={})=>({version:'https://jsonfeed.org/version/1.1',items,...extra});
const teamItem=(job=countryJob(),extra={})=>({id:'one',title:'Software Engineer',url:'https://example.teamtailor.com/jobs/123-engineer',content_html:'<p>Build software APIs</p>',_jobposting:job,...extra});

test('Teamtailor public JSON feed imports remote software jobs using explicit applicant countries before office locations',async()=>{
 const result=await fetchJobPage(source('teamtailor'),null,async url=>{assert.equal(url.href,'https://example.teamtailor.com/jobs.json');return feed([
  teamItem(countryJob('US')),teamItem(countryJob('GB')),teamItem(countryJob('IE')),
  teamItem({...countryJob('DE'),applicantLocationRequirements:[{'@type':'Country',name:'United Kingdom'}]}),
  teamItem({...countryJob(),jobLocationType:undefined}),teamItem(countryJob('DE')),
  teamItem(countryJob(),{title:'Recruiter'}),teamItem({...countryJob(),jobLocation:[]}),
 ]);});
 assert.deepEqual(result.jobs.map(j=>j.eligibleCountries),[['US'],['GB'],['IE'],['GB']]);assert.equal(result.complete,true);
});

test('Teamtailor pagination stays on the same public feed and incomplete descriptions preserve older jobs',async()=>{
 const page=await fetchJobPage(source('teamtailor'),null,async()=>feed([teamItem()],{next_url:'https://example.teamtailor.com/jobs.json?page=2'}));assert.equal(page.complete,false);assert.match(page.next,/page=2$/);
 for(const next_url of ['https://example.teamtailor.com/jobs.json','https://evil.test/jobs.json','http://example.teamtailor.com/jobs.json?page=2','https://example.teamtailor.com/private'])await assert.rejects(fetchJobPage(source('teamtailor'),null,async()=>feed([],{next_url})),/Invalid Teamtailor/);
 await assert.rejects(fetchJobPage(source('teamtailor'),'https://127.0.0.1/jobs.json',async()=>{throw Error('Must not fetch');}),/Invalid Teamtailor/);
 const incomplete=await fetchJobPage(source('teamtailor'),null,async()=>feed([teamItem({...countryJob(),description:''},{content_html:''})]));assert.equal(incomplete.complete,false);assert.equal(incomplete.incomplete,true);
});

test('Personio public XML is parsed as bounded data, retaining descriptions, extra offices and entity escapes',async()=>{
 const xml='<?xml version="1.0"?><workzag-jobs><position><id>123</id><subcompany>Example &amp; Co</subcompany><name>Software Engineer</name><office>Remote, United Kingdom</office><additionalOffices><office>Remote, Ireland</office></additionalOffices><jobDescriptions><jobDescription><name>About</name><value><![CDATA[<p>Build software APIs &amp; systems.</p>]]></value></jobDescription></jobDescriptions><createdAt>2026-10-01T00:00:00Z</createdAt></position></workzag-jobs>';
 const parsed=parseCareerResponse(new URL('https://example.jobs.personio.de/xml'),xml);
 const result=await fetchJobPage(source('personio'),null,async(url,headers)=>{assert.equal(url.searchParams.get('language'),'en');assert.equal(headers.Accept,'application/xml');return parsed;});
 assert.equal(result.jobs.length,1);assert.deepEqual(result.jobs[0].eligibleCountries,['GB','IE']);assert.equal(result.jobs[0].company,'Example & Co');assert.match(result.jobs[0].description,/Build software APIs & systems/);assert.equal(result.jobs[0].jobUrl,'https://example.jobs.personio.de/job/123?language=en');
 assert.deepEqual(parseCareerResponse(new URL('https://example.jobs.personio.com/xml'),'<workzag-jobs/>'),{jobs:[]});
});

test('Personio rejects malformed XML, DTD and external entities and marks missing descriptions incomplete',async()=>{
 const url=new URL('https://example.jobs.personio.de/xml');
 for(const xml of ['<workzag-jobs><position></workzag-jobs>','<!DOCTYPE x [<!ENTITY a SYSTEM "file:///etc/passwd">]><workzag-jobs>&a;</workzag-jobs>','<unrelated/>'])assert.throws(()=>parseCareerResponse(url,xml),/invalid|jobs list/);
 const result=await fetchJobPage(source('personio'),null,async()=>({jobs:[{id:'1',name:'Software Engineer',office:['Remote, United Kingdom']}]}));assert.equal(result.incomplete,true);assert.equal(result.complete,false);
});

test('BambooHR fetches full posting details and uses documented remote enum while excluding hybrid and unrelated roles',async()=>{
 const list=[{id:'1',jobOpeningName:'Software Engineer',locationType:'1'}, {id:'2',jobOpeningName:'Software Engineer',locationType:'2'}, {id:'3',jobOpeningName:'Software Engineer',locationType:'0'}, {id:'4',jobOpeningName:'Recruiter',locationType:'1'}];
 const calls=[];
 const result=await fetchJobPage(source('bamboohr'),null,async url=>{calls.push(url.pathname);return url.pathname.endsWith('/list')?{meta:{totalCount:4},result:list}:{result:{jobOpening:{jobOpeningStatus:'Open',jobOpeningName:'Software Engineer',locationType:'1',atsLocation:{country:'Ireland',city:'Dublin'},description:'Build software APIs'}}};});
 assert.deepEqual(calls,['/careers/list','/careers/1/detail']);assert.equal(result.jobs.length,1);assert.deepEqual(result.jobs[0].eligibleCountries,['IE']);assert.equal(result.jobs[0].jobUrl,'https://example.bamboohr.com/careers/1');
});

test('BambooHR sparse lists do not invent US eligibility and incomplete responses preserve imported jobs',async()=>{
 const list={meta:{totalCount:1},result:[{id:'1',jobOpeningName:'Software Engineer',locationType:'1'}]};
 const run=detail=>fetchJobPage(source('bamboohr'),null,async url=>url.pathname.endsWith('/list')?list:{result:{jobOpening:{...list.result[0],jobOpeningStatus:'Open',...detail}}});
 assert.equal((await run({description:'Build software APIs',atsLocation:{country:null}})).jobs.length,0);
 assert.deepEqual((await run({description:'Build software APIs',atsLocation:{country:null},location:{addressCountry:'US'}})).jobs[0].eligibleCountries,['US']);
 assert.equal((await run({description:''})).complete,false);
 await assert.rejects(fetchJobPage(source('bamboohr'),null,async()=>({...list,meta:{totalCount:2}})),/incomplete jobs list/);
 await assert.rejects(fetchJobPage(source('bamboohr'),null,async()=>({...list,result:[{...list.result[0],id:'../internal'}]})),/invalid posting ID/);
});

test('Paylocity careers JSON is parsed without evaluating inline JavaScript',()=>{
 const url=new URL('https://recruiting.paylocity.com/recruiting/jobs/All/'+token);
 const data={ModuleTitle:'Example',Jobs:[{JobId:1}]};
 assert.deepEqual(parseCareerResponse(url,'<script>window.pageData = '+JSON.stringify(data)+';</script>'),data);
 assert.throws(()=>parseCareerResponse(url,'<script>window.pageData = {Jobs: []}; process.exit()</script>'));
 assert.throws(()=>parseCareerResponse(url,'<script>window.pageData = JSON.parse("bad");</script>'));
});

test('Paylocity posting HTML reads only the job container and verifies the employer breadcrumb',async()=>{
 const url=new URL('https://recruiting.paylocity.com/recruiting/jobs/Details/123');
 const html=`<script>global.shouldNeverRun=true;</script><nav>Ignore navigation</nav><a class="breadcrumb-link" href="/recruiting/jobs/All/${token}/example">All Jobs</a><h2 id="LayoutLogoName">Example Employer</h2><span class="job-preview-title">Software Engineer</span><div class="preview-location">Fully Remote</div><div class="job-preview-details"><div class="mobile-apply-btn">Apply</div><div class="job-listing-header">Description</div><p>Build software APIs</p><script>bad()</script></div>`;
 const parsed=parseCareerResponse(url,html);assert.equal(parsed.title,'Software Engineer');assert.equal(parsed.boardToken,token);assert.doesNotMatch(parsed.description,/navigation|bad\(\)|Apply/);
 const result=await fetchJobPage(source('paylocity'),null,async url=>url.pathname.toLowerCase().includes('/all/')?{Jobs:[{JobId:123,JobTitle:'Software Engineer',IsRemote:true,IsInternal:false,JobLocation:{Country:'USA'}}]}:parsed);
 assert.equal(result.jobs.length,1);assert.deepEqual(result.jobs[0].eligibleCountries,['US']);
 const hybrid={...parsed,remoteLabel:'Hybrid'};
 const none=await fetchJobPage(source('paylocity'),null,async url=>url.pathname.toLowerCase().includes('/all/')?{Jobs:[{JobId:123,JobTitle:'Software Engineer',IsRemote:true,JobLocation:{Country:'USA'}}]}:hybrid);assert.equal(none.jobs.length,0);
});

test('Paylocity hides internal jobs and rejects mismatched employers before storing a posting',async()=>{
 let calls=0;
 const list={Jobs:[{JobId:123,JobTitle:'Software Engineer',IsRemote:true,IsInternal:true}]};
 const result=await fetchJobPage(source('paylocity'),null,async()=>{calls++;return list;});assert.equal(calls,1);assert.equal(result.jobs.length,0);
 list.Jobs[0].IsInternal=false;
 await assert.rejects(fetchJobPage(source('paylocity'),null,async url=>url.pathname.toLowerCase().includes('/all/')?list:{boardToken:'another',description:'Build software APIs'}),/different employer/);
});

test('Paylocity accepts an alternate public board only when its employer account matches the original listing',async()=>{
 const list={ModuleId:'456',Jobs:[{JobId:123,JobTitle:'Software Engineer',IsRemote:true,JobLocation:{Country:'US',ModuleId:456}}]};
 const detail={boardToken:'another-public-alias',moduleId:'456',title:'Software Engineer',description:'Build software APIs',remoteLabel:'Fully Remote',company:'Example'};
 const run=posting=>fetchJobPage(source('paylocity'),null,async url=>url.pathname.toLowerCase().includes('/all/')?list:posting);
 assert.equal((await run(detail)).jobs.length,1);
 await assert.rejects(run({...detail,moduleId:'789'}),/different employer/);
 await assert.rejects(run({...detail,moduleId:''}),/different employer/);
 const parsed=parseCareerResponse(new URL('https://recruiting.paylocity.com/recruiting/jobs/Details/123'),`<a class="breadcrumb-link" href="/recruiting/jobs/All/${token}">All</a><img id="LayoutLogoImage" src="/Recruiting/Jobs/GetLogoFile?moduleId=456"><span class="job-preview-title">Software Engineer</span><div class="preview-location">Fully    Remote</div><div class="job-preview-details">Build software APIs</div>`);
 assert.equal(parsed.moduleId,'456');assert.equal(parsed.remoteLabel,'Fully Remote');
});

test('Public career board validation rejects injected hosts, paths, credentials and invalid IDs',async()=>{
 for(const provider of ['personio','bamboohr','paylocity','teamtailor'])for(const boardToken of ['127.0.0.1','example.com/secret','user@localhost','example.teamtailor.com.evil.test','../internal']){
  assert.equal(validCareerBoard(provider,boardToken),false);
  await assert.rejects(fetchJobPage({...source(provider),boardToken},null,async()=>{throw Error('Must not fetch');}),/Invalid public employer/);
 }
 for(const host of ['example.teamtailor.com','example.na.teamtailor.com','example.au.teamtailor.com'])assert.equal(validCareerBoard('teamtailor',host),true);
});

test('Paylocity closed-posting redirects are treated as gone and never followed',async()=>{
 const original=global.fetch;try{
  global.fetch=async(url,options)=>{assert.equal(options.redirect,'manual');return new Response('closed',{status:302,headers:{location:'/Recruiting/Jobs/JobNotFound'}});};
  await assert.rejects(readFeed(new URL('https://recruiting.paylocity.com/recruiting/jobs/Details/123')),error=>error.status===404);
 }finally{global.fetch=original;}
});

test('Public career presentation and application aliases preserve the employer posting identity',()=>{
 const {poolJobIdentity}=require('../dist/job-pool/job-identity');
 for(const urls of [
  ['https://recruiting.paylocity.com/Recruiting/Jobs/Details/123/Employer/Engineer','https://recruiting.paylocity.com/recruiting/jobs/Details/123','https://recruiting.paylocity.com/Recruiting/jobs/Apply/123'],
  ['https://example.jobs.personio.de/job/123?language=en','https://example.jobs.personio.com/job/123?language=de'],
  ['https://example.bamboohr.com/careers/123','https://example.bamboohr.com/jobs/view.php?id=123'],
 ]){assert.equal(new Set(urls.map(poolJobIdentity)).size,1);assert.notEqual(poolJobIdentity(urls[0]),poolJobIdentity(urls[0].replace('123','124')));}
 assert.notEqual(poolJobIdentity('https://one.bamboohr.com/careers/123'),poolJobIdentity('https://two.bamboohr.com/careers/123'));
});

test('A provider-wide rate limit stops subsequent employer-board requests and keeps the retry delay',async()=>{
 const original=global.fetch;let calls=0;
 try{
  global.fetch=async()=>{calls++;return new Response('{}',{status:429,headers:{'retry-after':'7200'}});};
  await assert.rejects(readFeed(new URL('https://one.recruitee.com/api/offers')),error=>error.status===429&&error.retryAfterMs===7200000);
  await assert.rejects(readFeed(new URL('https://two.recruitee.com/api/offers')),error=>error.status===429&&error.retryAfterMs>7100000);
  assert.equal(calls,1);
 }finally{global.fetch=original;}
});
