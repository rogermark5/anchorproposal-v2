require('reflect-metadata');
const assert=require('node:assert/strict');const {randomUUID}=require('node:crypto');const fs=require('node:fs');
const {ConfigModule}=require('@nestjs/config');const {PrismaClient}=require('@prisma/client');
const {SettingsService}=require('../dist/settings/settings.service');const {ProfilesService}=require('../dist/profiles/profiles.service');
const {TemplatesService}=require('../dist/templates/templates.service');const {RulesService}=require('../dist/rules/rules.service');
const {ApplicationsService}=require('../dist/applications/applications.service');const {GenerationsService}=require('../dist/generations/generations.service');
const {bindProfileOutput}=require('../dist/generations/profile-output');
(async()=>{await ConfigModule.forRoot();const prisma=new PrismaClient();const rollback=new Error('Rollback document editing fixtures');
try{try{await prisma.$transaction(async tx=>{
 if(process.argv.includes('--dry-migration')){
  const sql=fs.readFileSync('prisma/migrations/20261015120000_document_edits_and_duplicate_confirmation/migration.sql','utf8').replace(/--[^\n]*/g,'');
  for(const statement of sql.split(';').map(part=>part.trim()).filter(Boolean))await tx.$executeRawUnsafe(statement);
 }
 const db=new Proxy(tx,{get:(target,key)=>key==='$transaction'?(fn)=>typeof fn==='function'?fn(db):Promise.all(fn):target[key]});
 const marker=randomUUID();const actor=await tx.user.create({data:{firstName:'QA',lastName:'Editor',email:marker+'@qa.invalid',passwordHash:'not-login-capable',role:'ADMIN',generationPromptMode:'user'}});
 const other=await tx.user.create({data:{firstName:'QA',lastName:'Viewer',email:marker+'-other@qa.invalid',passwordHash:'not-login-capable',role:'ADMIN'}});
 const profile=await tx.profile.create({data:{firstName:'Jason',lastName:'Glenn',email:'saved@qa.invalid',skills:{create:[{category:'Profile only',name:'Original database skill'}]},experiences:{create:[{title:'Engineer',company:'Saved Employer',startDate:'2020',responsibilities:'Built supported APIs.'}]}},include:{experiences:true,education:true,certifications:true,skills:true,links:true}});
 const settings=new SettingsService(db);const profiles=new ProfilesService(db,settings);const templates=new TemplatesService(db);const rules=new RulesService(db);const apps=new ApplicationsService(db,profiles,rules,{});
 const base=await tx.templateVersion.create({data:{name:'QA edit template',isPublished:true,configJson:{}}});
 const first=await apps.create({profileId:profile.id,company:'Hiring Co',jobTitle:'Engineer',jobDescription:'Build APIs',jobUrl:'https://example.com/jobs/123?utm_source=first'},actor);
 const duplicate=await apps.create({profileId:profile.id,company:'Different company label',jobTitle:'Engineer',jobDescription:'Build APIs',jobUrl:'https://www.example.com/jobs/123/#apply'},actor);
 assert.ok(duplicate.warnings.some(w=>w.category==='DUPLICATE'&&w.behavior==='CONFIRM'));assert.equal(rules.canGenerate(duplicate.warnings).allowed,true);
 await tx.applicationWarning.updateMany({where:{applicationId:duplicate.id,category:'DUPLICATE'},data:{behavior:'BLOCK'}});
 settings.requireApiKey=async()=> 'fixture-only-key';let queued=0;
 const renderer={renderAll:async(_a,_g,output,config,_name,[type])=>{assert.match(output.summary,/Edited/);assert.deepEqual(output.skills,[{Backend:'Fastify, PostgreSQL'}]);assert.equal(config.contact.showJobTitle,false);assert.equal(output.educations[0].institution,'User correction');return[{kind:'RESUME',type,filename:'fixture.'+type.toLowerCase(),storagePath:'qa-fixture-only'}];}};
 const generations=new GenerationsService(db,profiles,rules,settings,templates,renderer,{add:async()=>{queued++;}},{generate(){throw Error('No live provider calls allowed');}});
 assert.equal((await generations.startGeneration(duplicate.id,actor,base.id)).status,'QUEUED');assert.equal(queued,1);
 console.log('PASS same-link applications save with confirmation and legacy duplicate BLOCK does not block generation');
 await settings.updateDocumentDisplay(actor,{showJobTitle:false});assert.equal((await settings.getDocumentDisplay(other.id)).showJobTitle,true);
 const snapshot=profiles.buildProfileSnapshot(profile);const output=bindProfileOutput({contact:{name:'Wrong person'},summary:'Original summary.',skills:[{Backend:'Response JSON skill'}],experiences:[{title:'Engineer',company:'Saved Employer',dates:'2020 – Present',bullets:['Built APIs.']}],educations:[],certificates:[],coverLetter:{greeting:'Dear Hiring Manager,',paragraphs:['Original opening.','Supported API evidence.','I welcome a discussion.'],closing:'Sincerely,'}},snapshot);
 const source=await tx.resumeGeneration.create({data:{applicationId:first.id,creatorId:actor.id,status:'COMPLETED',profileSnapshotJson:snapshot,structuredOutputJson:output,templateVersionId:base.id,templateConfigSnapshotJson:{},completedAt:new Date()}});
 const input={summary:'Edited summary.',skills:[{Backend:'Fastify, PostgreSQL'}],experiences:[{title:'Senior Engineer',bullets:['Edited supported API achievement.']}],educations:[{degree:'BSc',institution:'User correction',dates:'2016 – 2020'}],certificates:[{name:'User correction certificate',issuer:'Issuer',date:'2025'}],coverLetter:{greeting:'Dear Engineering Team,',paragraphs:['Edited opening.','My supported API evidence.','I welcome a discussion.\nSincerely,\nWrong person'],closing:'Sincerely,\nSincerely,'},idempotencyKey:marker};
 const preview=await generations.previewEdits(source.id,actor,input);assert.match(preview.html,/Edited summary/);assert.ok(!preview.html.includes('<div class="headline">'));assert.equal(await tx.resumeGeneration.count({where:{applicationId:first.id}}),1);
 const saved=await generations.saveEdits(source.id,actor,input);assert.equal(saved.generation.version,2);assert.equal(saved.generation.isUserEdited,true);assert.equal(saved.generation.structuredOutputJson.contact.name,'Jason Glenn');assert.match(saved.preview.coverLetterHtml,/Edited opening/);assert.equal(saved.preview.coverLetterHtml.split('Sincerely,').length,2);
 assert.equal((await generations.saveEdits(source.id,actor,input)).generation.id,saved.generation.id);assert.equal(await tx.resumeGeneration.count({where:{applicationId:first.id}}),2);
 assert.equal((await tx.resumeGeneration.findUnique({where:{id:source.id}})).structuredOutputJson.summary,'Original summary.');
 const loaded=await apps.findOne(first.id,actor);assert.equal(loaded.generations.find(g=>g.id===saved.generation.id).structuredOutputJson.educations[0].institution,'User correction');
 for(const type of ['PDF','DOCX'])await generations.exportFile(saved.generation.id,actor,'RESUME',type);
 await assert.rejects(generations.saveEdits(source.id,other,input));assert.deepEqual((await tx.templateVersion.findUnique({where:{id:base.id}})).configJson,{});
 console.log('PASS private header visibility, JSON skills, draft preview, idempotent version save, immutable original and edited exports');
 throw rollback;
},{timeout:120000});}catch(error){if(error!==rollback)throw error;}console.log('All document-editing database fixtures rolled back.');}finally{await prisma.$disconnect();}
})().catch(error=>{console.error(error.message);process.exitCode=1;});
