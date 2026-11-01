require('reflect-metadata');
const {test}=require('node:test');const assert=require('node:assert/strict');const {createRequire}=require('node:module');
const {editedDocument}=require('../dist/generations/document-edits');
const {GenerationsService}=require('../dist/generations/generations.service');
const {SettingsService}=require('../dist/settings/settings.service');
const {RulesService}=require('../dist/rules/rules.service');
const {TemplatesService}=require('../dist/templates/templates.service');
const {DocumentRendererService}=require('../dist/documents/document-renderer.service');
const {DeepseekService}=require('../dist/deepseek/deepseek.service');
const {bindProfileOutput}=require('../dist/generations/profile-output');
const {jsonOutputRules}=require('../dist/deepseek/json-rules');
const {encryptResumeLink}=require('../dist/generations/public-resume');
const JSZip=createRequire(require.resolve('docx'))('jszip');
const profile={firstName:'Jason',lastName:'Glenn',email:'saved@example.com',skills:[{category:'Database skills',name:'Old skill'}],experiences:[{title:'Backend Engineer',company:'Saved Employer',startDate:'2021',endDate:'2025',responsibilities:'Built APIs.'}],education:[],certifications:[]};
const source=()=>bindProfileOutput({contact:{name:'Wrong person'},summary:'Original summary.',skills:[{Backend:'TypeScript, PostgreSQL'}],experiences:[{title:'Backend Engineer',company:'Saved Employer',dates:'2021 – 2025',bullets:['Built APIs.']}],educations:[],certificates:[],coverLetter:{greeting:'Dear Hiring Manager,',paragraphs:['Original relevant opening.','Evidence about API development.','I welcome a discussion.'],closing:'Sincerely,'}},profile);
const edits=()=>({summary:'Edited summary for reliable API development.',skills:[{Backend:'TypeScript, PostgreSQL, Fastify'}],experiences:[{title:'Senior Backend Engineer',bullets:['Edited supported API achievement.']}],educations:[{degree:'BSc',institution:'Saved user correction',dates:'2017 – 2021'}],certificates:[{name:'User-entered certificate',issuer:'Issuer',date:'2025'}],projects:[{name:'QA Customer Portal',description:'A supported project.',technologies:'React',url:'https://example.com/portal',dates:'2025',bullets:['Built account workflows.']}],headline:'Engineer building dependable services.',coreExpertise:['API development'],coverLetter:{greeting:'Dear Engineering Team,',paragraphs:['Edited opening for your services.','My API development supports this role.','I welcome a discussion.\nSincerely,\nWrong person'],closing:'Sincerely,\nSincerely,'}});
function fixture(){
 const original={id:'source',applicationId:'app',creatorId:'owner',status:'COMPLETED',version:1,profileSnapshotJson:profile,structuredOutputJson:source(),templateConfigSnapshotJson:{},templateVersionId:'template',promptVersionId:'private-prompt',promptSnapshot:'Private instructions',coverLetterPromptSnapshot:'Private letter instructions',createdAt:new Date('2026-10-15T12:00:00Z'),application:{id:'app',profileId:'profile',bidderId:'owner',company:'Hiring Co',jobTitle:'Target Engineer',jobDescription:'Develop reliable APIs.'},files:[]};
 const records=[original];const savedFiles=[];const rendered=[];const audits=[];let allowed=true;let showJobTitle=true;
 const prisma={user:{findUnique:async()=>({canGenerateResumes:allowed,canDownloadDocuments:true})},resumeGeneration:{
  findUnique:async({where})=>records.find(row=>where.id?row.id===where.id:row.idempotencyKey===where.idempotencyKey)||null,
  findFirst:async()=>records.at(-1),create:async({data})=>{const row={id:'saved-'+records.length,createdAt:new Date(),files:[],application:original.application,...data};records.push(row);return row;},
 },auditEvent:{create:async({data})=>audits.push(data)},$queryRaw:async()=>[],generationFile:{create:async({data})=>{const file={id:'file-'+savedFiles.length,...data};savedFiles.push(file);return file;}}};
 prisma.$transaction=fn=>fn(prisma);
 const capture=kind=>async(_a,_g,data,fourth,fifth,[type])=>{const config=kind==='RESUME'?fourth:fifth;rendered.push({kind,data,config,type});return[{kind,type,filename:'fixture.'+type.toLowerCase(),storagePath:'qa-only'}];};
 const renderer={renderAll:capture('RESUME'),renderCoverLetter:capture('COVER_LETTER')};
 const service=new GenerationsService(prisma,{checkAccess:async()=>{}},{},{getTimeZone:async()=>({timeZone:'UTC'}),getDocumentDisplay:async id=>{assert.equal(id,'owner');return{showJobTitle};}},new TemplatesService({}),renderer,{add(){throw Error('Must not queue AI');}},{generate(){throw Error('Must not call AI');}});
 return{service,original,records,rendered,audits,deny(){allowed=false;},hide(){showJobTitle=false;}};
}
test('response JSON skills survive profile binding, manual import and rendering',()=>{
 const output=source();assert.deepEqual(output.skills,[{Backend:'TypeScript, PostgreSQL'}]);assert.equal(output.contact.name,'Jason Glenn');assert.equal(output.contact.email,'saved@example.com');
 const imported=new DeepseekService({}).parseManualResponse(JSON.stringify({...output,skills:[{Tools:'Docker, Git'}]}),{profileSnapshot:profile,profileExperiences:profile.experiences,experienceTitleMode:'saved'});
 assert.deepEqual(imported.skills,[{Tools:'Docker, Git'}]);const html=new TemplatesService({}).renderPreviewHtml(imported,{});assert.match(html,/Docker, Git/);assert.ok(!html.includes('Old skill'));assert.match(jsonOutputRules(),/"skills"/);assert.ok(!jsonOutputRules().includes('Do not return contact or skills'));
});
test('header visibility affects HTML and Word while employment titles remain visible',async()=>{
 const templates=new TemplatesService({});const renderer=new DocumentRendererService(templates,{});const output=source();
 for(const visible of [true,false]){
  const config={contact:{showJobTitle:visible}};const html=templates.renderPreviewHtml(output,config);
  assert.equal(html.includes('<div class="headline">'),visible);assert.match(html,/<span class="exp-title">Backend Engineer/);
  const zip=await JSZip.loadAsync(await renderer.renderDocx(output,config));const xml=await zip.file('word/document.xml').async('string');assert.equal(xml.split('Backend Engineer').length-1,visible?2:1);
 }
});
test('display settings are scoped per account and reject non-boolean values',async()=>{
 const values=new Map();const settings=new SettingsService({systemSetting:{findUnique:async({where})=>values.get(where.key),upsert:async({where,create})=>values.set(where.key,create)}});
 await settings.updateDocumentDisplay({id:'a'},{showJobTitle:false});assert.deepEqual(await settings.getDocumentDisplay('a'),{showJobTitle:false});assert.deepEqual(await settings.getDocumentDisplay('b'),{showJobTitle:true});
 await assert.rejects(settings.updateDocumentDisplay({id:'a'},{showJobTitle:'false'}));
});
test('duplicates always request confirmation and never override unrelated blocking warnings',()=>{
 const rules=new RulesService({});for(const behavior of ['BLOCK','ADMIN_REVIEW','CONFIRM']){const result=rules.canGenerate([{category:'DUPLICATE',behavior}]);assert.equal(result.allowed,true);assert.equal(result.requiresConfirmation,true);}
 assert.equal(rules.canGenerate([{category:'DUPLICATE',behavior:'BLOCK'},{category:'CLEARANCE',behavior:'BLOCK'}]).allowed,false);
 const [legacy]=rules.contextualizeWarnings([{category:'DUPLICATE',matchedText:'Duplicate application',behavior:'BLOCK',severity:'BLOCK'}],{company:'Hiring Co'});assert.equal(legacy.behavior,'CONFIRM');
});
test('URL duplicates are detected despite attribution and changed company labels',async()=>{
 const rules=new RulesService({warningRule:{findMany:async()=>[]},application:{findMany:async()=>[{id:'existing',company:'Different label',jobTitle:'Previous position',status:'CLOSED',jobUrl:'https://www.example.com/jobs/123/?utm_source=test'}]}});
 const result=await rules.validateApplication({profileId:'p',company:'Hiring Co',jobTitle:'Engineer',jobDescription:'Build APIs',jobUrl:'http://example.com/jobs/123#apply'});
 assert.equal(result.duplicates.length,1);assert.equal(result.warnings[0].behavior,'CONFIRM');assert.match(result.warnings[0].matchedText,/for this job link/);
});
test('document edits preserve identity, employers and dates and normalize duplicate closings',()=>{
 const changed=editedDocument(source(),profile,edits());assert.equal(changed.summary,edits().summary);assert.deepEqual(changed.skills,edits().skills);assert.equal(changed.contact.name,'Jason Glenn');assert.equal(changed.contact.email,'saved@example.com');
 assert.equal(changed.experiences[0].company,'Saved Employer');assert.equal(changed.experiences[0].dates,'2021 – 2025');assert.equal(changed.educations[0].institution,'Saved user correction');assert.equal(changed.coverLetter.signatureName,'Jason Glenn');assert.equal(changed.coverLetter.closing,'Sincerely,');assert.ok(!changed.coverLetter.paragraphs.join(' ').includes('Sincerely'));
 assert.throws(()=>editedDocument(source(),profile,{...edits(),contact:{name:'Other person'}}));
 assert.throws(()=>editedDocument(source(),profile,{...edits(),experiences:[]}));
 assert.throws(()=>editedDocument(source(),profile,{...edits(),experiences:[{...edits().experiences[0],company:'Other employer'}]}));
});
test('draft preview does not save, and saving creates an idempotent new version without AI calls',async()=>{
 const f=fixture();const user={id:'owner',role:'ADMIN'};const draft=await f.service.previewEdits('source',user,edits());assert.match(draft.html,/Edited summary/);assert.match(draft.coverLetterHtml,/Edited opening/);assert.equal(f.records.length,1);
 const input={...edits(),idempotencyKey:'fixture-edit-request-1'};const saved=await f.service.saveEdits('source',user,input);assert.equal(saved.generation.version,2);assert.equal(saved.generation.isUserEdited,true);assert.equal(saved.generation.tokenUsage,0);assert.equal(saved.generation.promptSnapshot,undefined);assert.equal(saved.preview.canEdit,true);assert.match(saved.preview.html,/Saved user correction/);
 assert.equal((await f.service.saveEdits('source',user,input)).generation.id,saved.generation.id);assert.equal(f.records.length,2);assert.equal(f.audits.length,1);assert.equal(f.original.structuredOutputJson.summary,'Original summary.');
});
test('only a permitted creator can edit a completed and safe resume',async()=>{
 const f=fixture();await assert.rejects(f.service.previewEdits('source',{id:'other',role:'MASTER'},edits()),/Only the creator/);
 f.deny();await assert.rejects(f.service.saveEdits('source',{id:'owner',role:'ADMIN'},{...edits(),idempotencyKey:'fixture-edit-request-2'}),/permission/);assert.equal(f.records.length,1);
});
test('saved edits drive both exports and public HTML, and the author controls header visibility',async()=>{
 const f=fixture();const user={id:'owner',role:'ADMIN'};f.hide();const saved=await f.service.saveEdits('source',user,{...edits(),idempotencyKey:'fixture-edit-request-3'});
 assert.ok(!saved.preview.html.includes('<div class="headline">'));assert.match(saved.preview.html,/<span class="exp-title">Senior Backend Engineer/);
 for(const kind of ['RESUME','COVER_LETTER'])for(const type of ['PDF','DOCX'])await f.service.exportFile(saved.generation.id,user,kind,type);
 assert.equal(f.rendered.length,4);for(const row of f.rendered){assert.equal(row.config.contact.showJobTitle,false);assert.equal(row.data.contact.name,'Jason Glenn');if(row.kind==='RESUME'){assert.equal(row.data.summary,edits().summary);assert.deepEqual(row.data.skills,edits().skills);assert.equal(row.data.certificates[0].name,'User-entered certificate');assert.equal(row.data.projects[0].name,'QA Customer Portal');assert.equal(row.data.headline,edits().headline);assert.deepEqual(row.data.coreExpertise,edits().coreExpertise);}else assert.match(row.data.paragraphs[0],/Edited opening/);}
 const previous=process.env.RESUME_SHARE_SECRET;process.env.RESUME_SHARE_SECRET='test-document-edit-secret-with-enough-length';
 try{const record=f.records.at(-1);record.publicShareNonce='new-version-nonce';const token=encryptResumeLink({id:record.id,nonce:record.publicShareNonce,expires:Date.now()+60000},process.env.RESUME_SHARE_SECRET);const view=await f.service.publicResume(token);assert.match(view.html,/Saved user correction/);assert.match(view.html,/QA Customer Portal/);assert.ok(!view.html.includes('<div class="headline">'));}finally{if(previous===undefined)delete process.env.RESUME_SHARE_SECRET;else process.env.RESUME_SHARE_SECRET=previous;}
});
