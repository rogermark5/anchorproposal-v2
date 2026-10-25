// Compare public-feed samples to a local read-only database audit.
// Optional --verify-ocean checks one description per company not in local history.
const fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto');
const {plainText,publicJobUrl,jobDate,arrangement}=require('../dist/job-pool/job-providers');
const {eligibleCountries,excludedCountries}=require('../dist/job-pool/job-geography');
const {isSoftwareJob}=require('../dist/job-pool/software-jobs');
const output=path.resolve(__dirname,'../../../tmp/job-pool-qa/company-diversity-2026-10-23');
const normalize=value=>String(value||'').toLowerCase().replace(/\s/g,'');
const hash=value=>crypto.createHash('sha256').update(normalize(value)).digest('hex');
(async()=>{
 const known=JSON.parse(await fs.readFile(path.join(output,'company-hashes.json'),'utf8'));
 const active=new Set(known.available),history=new Set(known.historical),report={comparedAt:new Date().toISOString(),databaseCheckedAt:known.checkedAt,normalization:known.normalization,providers:[],limitations:['Name matches can miss spelling aliases; new means absent from this local pool snapshot, not never encountered by this user.','Provider samples have different sizes and completeness. Himalayas dates mean last update. Ocean listing-only candidates need description checks.']};
 let ocean=[],himalayas=[];
 for(const provider of ['ocean','himalayas','jobicy','remotejobs','freehire','remoteok','arbeitnow']){
  const data=JSON.parse(await fs.readFile(path.join(output,provider+'-benchmark.json'),'utf8'));
  const companies=[...new Set(data.eligibleJobs.map(job=>hash(job.company)))];
  report.providers.push({...data.result,companiesAbsentAvailable:companies.filter(value=>!active.has(value)).length,companiesAbsentHistory:companies.filter(value=>!history.has(value)).length});
  if(provider==='ocean')ocean=data.eligibleJobs;
  if(provider==='himalayas')himalayas=data.eligibleJobs.filter(job=>!history.has(hash(job.company)));
 }
 if(process.argv.includes('--verify-ocean')){
  const representatives=new Map();
  for(const job of ocean)if(!history.has(hash(job.company))&&!representatives.has(hash(job.company)))representatives.set(hash(job.company),job);
  const verified=[],failures=[];let checked=0;
  for(const job of [...representatives.values()].slice(0,100)){
   const cache=path.join(output,'ocean-detail-'+job.id+'.json');let row;
   try{row=JSON.parse(await fs.readFile(cache,'utf8'));}catch{
    await new Promise(resolve=>setTimeout(resolve,300));
    const response=await fetch('https://oceanofjobs.com/api/jobs/'+encodeURIComponent(job.id),{headers:{Accept:'application/json','User-Agent':'AnchorProposal/1.0 (small employer diversity evaluation)'},signal:AbortSignal.timeout(35000)});
    if(response.status===429){await response.body?.cancel();failures.push({id:job.id,status:429});break;}
    if(!response.ok){await response.body?.cancel();failures.push({id:job.id,status:response.status});continue;}
    row=await response.json();await fs.writeFile(cache,JSON.stringify(row));
   }
   checked++;
   const description=plainText(row.description),countries=eligibleCountries(row.location).filter(code=>!excludedCountries(description).includes(code)),seen=jobDate(row.last_seen);
   if(row.id===job.id&&row.confidence==='verified'&&row.workplace_type==='remote'&&!row.closed_at&&countries.length&&!['HYBRID','ONSITE'].includes(arrangement(row.location))&&seen&&seen.getTime()>Date.now()-7*86400000&&publicJobUrl(row.url)&&description&&isSoftwareJob(row.title,description))verified.push({id:row.id,company:row.company_name||row.company_domain,countries,publishedAt:row.posted_at});
  }
  report.oceanDescriptionCheck={candidateCompaniesAbsentHistory:representatives.size,checked,qualifyingCompanies:new Set(verified.map(job=>hash(job.company))).size,qualifyingCompaniesByCountry:Object.fromEntries(['US','GB','IE'].map(code=>[code,new Set(verified.filter(job=>job.countries.includes(code)).map(job=>hash(job.company))).size])),failures,note:'One candidate job per company, at most 100 companies; this is not a complete Ocean body audit.'};
  const combined=himalayas.concat(verified),companies=rows=>new Set(rows.map(job=>hash(job.company))).size;
  report.combinedDescriptionCheckedNovelCompanies={himalayas:companies(himalayas),ocean:companies(verified),overlap:companies(himalayas)+companies(verified)-companies(combined),total:companies(combined),byCountry:Object.fromEntries(['US','GB','IE'].map(code=>[code,companies(combined.filter(job=>job.countries.includes(code)))])),note:'Novel to local job history under name normalization; snapshot, not a measured daily arrival rate. A company can qualify in several countries.'};
  await fs.writeFile(path.join(output,'ocean-verified-novel-company-sample.json'),JSON.stringify(verified,null,2));
 }
 await fs.writeFile(path.join(output,'comparison.json'),JSON.stringify(report,null,2));
 console.log(JSON.stringify(report,null,2));
})().catch(error=>{console.error(error.message);process.exitCode=1;});
