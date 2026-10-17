const {test}=require('node:test');const assert=require('node:assert/strict');
const {fetchJobPage}=require('../dist/job-pool/job-providers');
const {remotejobsEligibility,remotejobsUrl,postingShingles,samePostingGroup,samePostingContent}=require('../dist/job-pool/remotejobs-feed');
const source={provider:'remotejobs',name:'RemoteJobs.org',boardToken:'programming'};
const geo={status:'known',scope:'restricted',work_arrangement:'remote',allowed_countries:['US'],excluded_countries:[],unresolved:[]};
const row=change=>({id:'one',title:'Software Engineer',company:{name:'Example'},location:'United States',description:'Build scalable software and APIs',apply_url:'https://remotejobs.org/remote-jobs/engineer-example',applicant_location_requirements:geo,...change});
test('RemoteJobs keeps the documented application URL, full description, attribution and software filter',async()=>{
 const result=await fetchJobPage(source,null,async url=>{assert.equal(url.href,'https://remotejobs.org/api/v1/jobs?category=programming&limit=50&offset=0');return {data:[row(),row({title:'Recruiter'})],pagination:{total:2,limit:50,offset:0,has_more:false}};});
 assert.equal(result.jobs.length,1);assert.equal(result.jobs[0].jobUrl,row().apply_url);assert.equal(result.jobs[0].sourceName,'RemoteJobs.org');assert.equal(result.jobs[0].description,row().description);assert.equal(result.complete,true);
});
test('RemoteJobs requires confirmed US eligibility or verified worldwide permission and rejects unknown or conflicting geography',()=>{
 assert.equal(remotejobsEligibility(row()),'us');
 assert.equal(remotejobsEligibility(row({applicant_location_requirements:{...geo,scope:'worldwide',allowed_countries:[],worldwide_permission_verified:true}})),'worldwide');
 for(const change of [{status:'partial'},{status:'unknown'},{status:'conflicting'},{work_arrangement:'hybrid'},{allowed_countries:['GB']},{excluded_countries:['US']},{unresolved:['unclear']},{scope:'worldwide',allowed_countries:[],worldwide_permission_verified:false}])assert.equal(remotejobsEligibility(row({applicant_location_requirements:{...geo,...change}})),null,JSON.stringify(change));
 assert.equal(remotejobsEligibility(row({location_normalization:{excluded_countries:['US']}})),null);
});
test('RemoteJobs validates raw pagination and category names',async()=>{
 const result=await fetchJobPage(source,'50',async()=>({data:Array.from({length:50},()=>row({title:'Recruiter'})),pagination:{total:101,limit:50,offset:50,has_more:true}}));assert.equal(result.next,'100');assert.equal(result.jobs.length,0);
 for(const change of [{data:[]},{pagination:{total:10,limit:50,offset:1,has_more:false}},{pagination:{total:10,limit:50,offset:0,has_more:true}}])await assert.rejects(fetchJobPage(source,null,async()=>({data:[row()],pagination:{total:1,limit:50,offset:0,has_more:false},...change})),/incomplete|invalid/);
 for(const cursor of ['1','-50','10000','http://bad.example'])assert.throws(()=>remotejobsUrl('programming',cursor),/cursor/);
 assert.throws(()=>remotejobsUrl('healthcare',null),/category/);
});
test('Cross-source duplicates require matching company/title and substantial shared posting text',()=>{
 const text=Array.from({length:100},(_,i)=>`word${i}`).join(' ');
 assert.equal(samePostingGroup('Example, Inc.','Software Engineer'),samePostingGroup('Example','Software Engineer'));
 assert.notEqual(samePostingGroup('Example','Software Engineer'),samePostingGroup('Another','Software Engineer'));
 assert.equal(samePostingContent(postingShingles(text),postingShingles('A new introduction '+text+' Apply at source')),true);
 assert.equal(samePostingContent(postingShingles(text),postingShingles('Build software and APIs')),false);
 assert.equal(samePostingContent(postingShingles(text),postingShingles(text.replaceAll('word','other'))),false);
});
