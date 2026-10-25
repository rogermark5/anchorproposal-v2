const fs=require('node:fs'),path=require('node:path');
const dir=path.resolve('../../tmp/job-pool-qa/free-source-audit');fs.mkdirSync(dir,{recursive:true});
// The previous release had 72 entries. Source indexes are append-only because
// persisted cursors refer to them; the remaining entries are this expansion.
const sources=require('../dist/job-pool/freehire-feed').FREEHIRE_SOURCES.slice(72);
(async()=>{
 const results=[];
 for(const source of sources){
  await new Promise(resolve=>setTimeout(resolve,1200));
  const url=new URL('https://freehire.me/api/v1/agent/jobs/search');url.search=new URLSearchParams({source,countries:'US,GB,IE',work_mode:'remote',posted_within_days:'2',category:'software_engineering,backend,frontend,fullstack,mobile,devops,sre,network_engineering,data_engineering,data_science,data_analytics,ml_ai,ai_engineering,qa,security,architecture,embedded,blockchain,management,solutions_engineering',description_format:'text',limit:'1',offset:'0',sort:'posted_at',order:'desc'}).toString();
  try{
   const res=await fetch(url,{signal:AbortSignal.timeout(60000),headers:{'User-Agent':'AnchorProposal/1.0 (free public feed verifier)'}});
   if(!res.ok){results.push({source,status:res.status});if(res.status===429)break;continue;}
   const data=await res.json();if(!Array.isArray(data.data)||!Number.isSafeInteger(data.meta?.total)||data.meta?.ignored_params?.length)throw Error('Invalid source filters');
   fs.writeFileSync(path.join(dir,'employer-'+source+'.json'),JSON.stringify(data));
   results.push({source,status:res.status,total:data.meta.total,sampleSource:data.data[0]?.source,samplePublishedAt:data.data[0]?.posted_at,hasDescription:!!data.data[0]?.description});
  }catch(error){results.push({source,error:error.message});}
  if(results.length%10===0)console.log('Verified '+results.length+'/'+sources.length+' employer feeds');
  fs.writeFileSync(path.resolve('../../research/free-employer-feed-audit-2026-10-24.json'),JSON.stringify({checkedAt:new Date().toISOString(),scope:'US/GB/IE remote software sources, last two source-posting days; not all are today or unique employers',planned:sources.length,results},null,2));
 }
 console.log(JSON.stringify({planned:sources.length,checked:results.length,successful:results.filter(row=>row.status===200).length,nonempty:results.filter(row=>row.total>0).length,errors:results.filter(row=>row.status!==200)}));
})().catch(error=>{console.error(error);process.exitCode=1;});
