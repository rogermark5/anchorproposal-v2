require('reflect-metadata');
const {test}=require('node:test');const assert=require('node:assert/strict');const {fixture}=require('./private-prompt-fixture.cjs');
const {promptInstructions,JSON_RULE_END,JSON_RULE_START}=require('../dist/deepseek/json-rules');
test('flag-only edits preserve instructions and replace the automatic output rule',async()=>{
 const f=fixture();const p=await f.service.createLibraryPrompt(f.actor,{name:'Custom',content:'Keep exactly this text.'});
 assert.equal(p.experienceTitleMode,'saved');const changed=await f.service.updateLibraryPrompt(f.actor,p.id,{experienceTitleMode:'tailored'});
 assert.equal(changed.experienceTitleMode,'tailored');assert.equal(promptInstructions(changed.content),'Keep exactly this text.');
 assert.ok(changed.content.endsWith(JSON_RULE_END));assert.equal(changed.content.split(JSON_RULE_START).length,2);assert.match(changed.content,/role string/);
});
test('personal defaults retain saved positions and bad flags are rejected',async()=>{
 const f=fixture();await assert.rejects(f.service.updateLibraryPrompt(f.actor,'private',{experienceTitleMode:'tailored'}),e=>e.getStatus()===400);
 for(const value of ['invalid',null,true,{}])await assert.rejects(f.service.createLibraryPrompt(f.actor,{name:'Test',content:'Text',experienceTitleMode:value}),e=>e.getStatus()===400);
});
test('all roles can create only owned prompts and cannot read, edit, assign or publish another user prompt',async()=>{
 const f=fixture();for(const actor of [{id:'other',role:'ADMIN'},{id:'master',role:'MASTER'},{id:'b1',role:'BIDDER'}]){
  if(actor.id==='other') f.state.users.push(actor);
  await assert.rejects(f.service.updateLibraryPrompt(actor,'match',{content:'Changed'}));
  await assert.rejects(f.service.assertAssignablePrompts(actor,['match']));
  await assert.rejects(f.service.publishOwnPrompt(actor,'match'));
  const own=await f.service.createLibraryPrompt(actor,{name:'Test',content:'Text'});assert.equal(own.ownerId,actor.id);
  assert.ok((await f.service.listManagedPrompts(actor)).every(p=>p.ownerId===actor.id));
 }
 assert.equal(f.state.prompts.find(p=>p.id==='match').content,'Existing role match instructions');
});
test('each profile resolves only its user preference and never falls back to another person',async()=>{
 const f=fixture();assert.equal((await f.service.resolveGenerationPrompt(f.actor,'p1')).experienceTitleMode,'tailored');
 f.state.users[1].generationPromptMode='profile';
 await assert.rejects(f.service.resolveGenerationPrompt({id:'b1',role:'BIDDER'},'p1'),/a combined prompt/);
 f.state.preferences[0].resumePromptId=null;await assert.rejects(f.service.resolveGenerationPrompt(f.actor,'p1'),/a combined prompt/);
 f.state.users[0].generationPromptMode='user';assert.equal((await f.service.resolveGenerationPrompt(f.actor,'p1')).experienceTitleMode,'saved');
});
