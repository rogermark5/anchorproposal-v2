// Read-only company diversity metrics. Reports counts only, never credentials,
// application text, profile names or employer lists from private applications.
require('reflect-metadata');
const fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto');
const {ConfigModule}=require('@nestjs/config'),{PrismaClient}=require('@prisma/client');
const {JobPoolService}=require('../dist/job-pool/job-pool.service');
const normalize=value=>value.toLowerCase().replace(/\s/g,'');
function summarize(rows){
 const companies=new Set(rows.map(row=>normalize(row.company)));
 return{jobs:rows.length,companies:companies.size,additionalJobsAtSameCompanies:rows.length-companies.size};
}
(async()=>{
 await ConfigModule.forRoot({envFilePath:path.resolve(__dirname,'../.env')});
 const url=new URL(process.env.DATABASE_URL);url.searchParams.set('connect_timeout','3');
 const db=new PrismaClient({datasources:{db:{url:url.toString()}}});
 try{
  const service=new JobPoolService(db,{}),settings=await service.settings(),now=new Date();
  const [sources,rows,freshness]=await Promise.all([db.jobPoolSource.count(),db.jobPoolJob.findMany({where:service.available(now,settings.excludedTitleKeywords),select:{company:true,publishedAt:true,createdAt:true,eligibleCountries:true,source:{select:{provider:true}}}}),db.jobPoolJob.aggregate({_max:{lastSeenAt:true,createdAt:true,publishedAt:true}})]);
  const report={checkedAt:now.toISOString(),configuredSources:sources,exclusions:settings.excludedTitleKeywords,available:summarize(rows),freshness:freshness._max,byCountry:{},byProvider:{},timeWindows:{},limits:'This is the database configured on this machine, not necessarily the Ubuntu production database. Companies use lowercase names with whitespace removed. A single snapshot measures recently posted employers, not first-ever employers or a guaranteed future daily supply.'};
  for(const country of ['US','GB','IE'])report.byCountry[country]=summarize(rows.filter(row=>row.eligibleCountries.includes(country)));
  for(const provider of new Set(rows.map(row=>row.source?.provider||'manual')))report.byProvider[provider]=summarize(rows.filter(row=>(row.source?.provider||'manual')===provider));
  for(const hours of [24,72,168,720])report.timeWindows[hours+'h']=summarize(rows.filter(row=>row.publishedAt&&row.publishedAt<=now&&row.publishedAt.getTime()>=now.getTime()-hours*3600000));
  const output=process.argv.find(arg=>arg.startsWith('--output='))?.slice(9);
  if(output)await fs.writeFile(path.resolve(output),JSON.stringify(report,null,2)+'\n');
  const companiesOutput=process.argv.find(arg=>arg.startsWith('--companies-output='))?.slice(19);
  if(companiesOutput){
   const historical=await db.jobPoolJob.findMany({select:{company:true},distinct:['company']});
   const hashes=items=>[...new Set(items.map(item=>crypto.createHash('sha256').update(normalize(item.company)).digest('hex')))];
   await fs.writeFile(path.resolve(companiesOutput),JSON.stringify({checkedAt:now.toISOString(),normalization:'lowercase; remove all whitespace; SHA-256',available:hashes(rows),historical:hashes(historical)}));
  }
  console.log(JSON.stringify(report,null,2));
 }catch(error){console.error(JSON.stringify({databaseAudit:'unavailable',reason:(error.code||error.errorCode)==='P1001'?'Database is not reachable from this machine. Run this read-only script on the Ubuntu deployment.':error.constructor.name}));process.exitCode=1;}
 finally{await db.$disconnect();}
})().catch(()=>{console.error('Database audit could not start; no data was modified.');process.exitCode=1;});
