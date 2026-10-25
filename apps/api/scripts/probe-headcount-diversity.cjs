// Small, read-only public MCP evaluation. No account, paid API or bulk copying.
const fs=require('node:fs/promises'),path=require('node:path');
const output=path.resolve(__dirname,'../../../tmp/job-pool-qa/company-diversity-2026-10-23');
const endpoint='https://api.headcountlabs.com/mcp/public';
let session,id=0;
async function rpc(method,params,label){
 const response=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json',Accept:'application/json, text/event-stream',...(session?{'Mcp-Session-Id':session}:{}),'User-Agent':'AnchorProposal/1.0 (small read-only API evaluation)'},body:JSON.stringify({jsonrpc:'2.0',id:++id,method,params}),signal:AbortSignal.timeout(40000)});
 session=response.headers.get('mcp-session-id')||session;
 if(!response.ok){await response.body?.cancel();throw Error('HTTP '+response.status+'; evaluation stopped');}
 const data=await response.json();
 await fs.writeFile(path.join(output,'headcount-'+label+'.json'),JSON.stringify(data,null,2));
 if(data.error||data.result?.isError)throw Error('Provider rejected '+label+'; see saved response');
 return data.result?.structuredContent||data.result?.content?.filter(item=>item.type==='text').map(item=>{try{return JSON.parse(item.text);}catch{return item.text;}})||data.result;
}
(async()=>{
 await fs.mkdir(output,{recursive:true});
 await rpc('initialize',{protocolVersion:'2025-03-26',capabilities:{},clientInfo:{name:'AnchorProposal research',version:'1.0.0'}},'research-initialize');
 const title='(software OR developer OR devops OR SRE OR "data engineer" OR "QA engineer" OR "machine learning") AND NOT (staff OR principal OR architect OR junior OR lead OR director)';
 const filters={country:'US,GB,IE',work_arrangement:'remote',title_advanced:title};
 if(!process.argv.includes('--sample-only')){
  const counts=await rpc('tools/call',{name:'count_jobs',arguments:{filters,group_by:'country'}},'country-count');
  console.log(JSON.stringify({counts}));
  try{const fresh=await rpc('tools/call',{name:'count_jobs',arguments:{filters:{...filters,posted_since:new Date(Date.now()-86400000).toISOString()},group_by:'employer'}},'posted24h-count');console.log(JSON.stringify({recentCounts:fresh}));}catch(error){console.log(JSON.stringify({recentCountUnavailable:error.message}));}
 }
 const sample=await rpc('tools/call',{name:'search_jobs',arguments:{filters:{country:'US,GB,IE',work_arrangement:'remote',title:'software'},limit:10,view:'full',descriptions:'full',sort:'updated'}},'sample');
 console.log(JSON.stringify({sampleShape:typeof sample,sampleKeys:Object.keys(sample||{}),note:'Full sample saved locally for filtering; no imports performed.'}));
})().catch(error=>{console.error(error.message);process.exitCode=1;});
