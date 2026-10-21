const{test}=require('node:test'),assert=require('node:assert/strict');
const modules=Promise.all([import('../src/application-defaults.mjs'),import('../src/tab-drafts.mjs')]);
const profiles=[{id:'first-profile'},{id:'default-profile',isDefault:true}],templates=[{id:'first-template',isPublished:true},{id:'default-template',isDefault:true,isPublished:true}];
const options={locations:[{value:'First location'},{value:'Remote',isDefault:true}],sources:[{value:'First site'},{value:'LinkedIn',isDefault:true}]};
test('a new form starts with the account defaults even when they are not the first options',async()=>{
  const[{applicationDefaults,newApplicationDraft}]=await modules,form=applicationDefaults({},profiles,templates,options),draft=newApplicationDraft({autoDownload:false},form);
  assert.equal(form.profileId,'default-profile');assert.equal(form.templateId,'default-template');assert.equal(form.location,'Remote');assert.equal(form.source,'LinkedIn');assert.equal(form.workArrangement,'REMOTE');assert.equal(draft.autoDownload,false);assert.equal(draft.defaultsVersion,1);
  for(const field of['jobTitle','company','jobUrl','jobDescription'])assert.equal(form[field],'');
});
test('explicit extension defaults take precedence over account defaults',async()=>{
  const[{applicationDefaults}]=await modules,form=applicationDefaults({profileId:'first-profile',templateId:'first-template',location:'United Kingdom',source:'Referral'},profiles,templates,options);
  assert.equal(form.profileId,'first-profile');assert.equal(form.templateId,'first-template');assert.equal(form.location,'United Kingdom');assert.equal(form.source,'Referral');
});
test('removed defaults fall back to usable assigned values and unpublished templates are skipped',async()=>{
  const[{applicationDefaults}]=await modules,form=applicationDefaults({profileId:'removed',templateId:'unpublished'},profiles,[{id:'unpublished',isDefault:true,isPublished:false},...templates],options);
  assert.equal(form.profileId,'default-profile');assert.equal(form.templateId,'default-template');assert.equal(applicationDefaults({},[],[],{}).templateId,'');
  const first=applicationDefaults({},profiles.slice(0,1),templates.slice(0,1),{locations:options.locations.slice(0,1),sources:options.sources.slice(0,1)});
  assert.equal(first.profileId,'first-profile');assert.equal(first.location,'First location');assert.equal(first.source,'First site');
});
test('fresh drafts and legacy empty drafts receive defaults on opening',async()=>{
  const[{applicationDefaults,restoreApplicationDraft}]=await modules,defaults=applicationDefaults({},profiles,templates,options);
  assert.deepEqual(restoreApplicationDraft({}, {},defaults).form,defaults);
  const legacy=restoreApplicationDraft({initialized:true,form:{profileId:'first-profile'},autoDownload:false},{autoDownload:true},defaults);
  assert.equal(legacy.form.profileId,'first-profile');assert.equal(legacy.form.templateId,'default-template');assert.equal(legacy.form.location,'Remote');assert.equal(legacy.autoDownload,false);
});
test('restoring an existing application or edited draft never replaces its choices',async()=>{
  const[{applicationDefaults,restoreApplicationDraft},{cleanDraft}]=await modules,defaults=applicationDefaults({},profiles,templates,options);
  const existing=cleanDraft({initialized:true,form:{jobTitle:'My job',profileId:'first-profile',location:'',source:''},autoDownload:false});
  const restored=restoreApplicationDraft(existing,{},defaults);assert.deepEqual(restored.form,existing.form);assert.equal(restored.autoDownload,false);
  const deliberatelyEmpty=cleanDraft({initialized:true,defaultsVersion:1,form:{profileId:'first-profile',location:'',source:''}});
  assert.deepEqual(restoreApplicationDraft(deliberatelyEmpty,{},defaults).form,deliberatelyEmpty.form);
  const saved=cleanDraft({initialized:true,applicationId:'app-a',activeTaskId:'task-a',form:{profileId:'first-profile'}});
  assert.deepEqual(restoreApplicationDraft(saved,{},defaults).form,saved.form);
});
test('default initialization survives session storage so reopening does not refill cleared fields',async()=>{
  const[{applicationDefaults,newApplicationDraft,restoreApplicationDraft},{cleanDraft}]=await modules,defaults=applicationDefaults({},profiles,templates,options),draft=newApplicationDraft({},defaults);
  draft.form.source='';const saved=cleanDraft(draft);assert.equal(saved.defaultsVersion,1);assert.equal(restoreApplicationDraft(saved,{},defaults).form.source,'');
});
