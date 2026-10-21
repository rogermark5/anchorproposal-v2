import { preferences } from './security.mjs';
export const terminal = task => ['completed','failed','cancelled'].includes(task.stage);
const active = task => ['submitting','queued','running'].includes(task.stage);
export class GenerationQueue {
  constructor(store, session, changed=()=>{}, completed=()=>{}) { this.store=store;this.session=session;this.changed=changed;this.completed=completed;this.tail=Promise.resolve();this.submitting=new Set();this.documentSaves=new Map(); }
  exclusive(work) {const result=this.tail.then(work,work);this.tail=result.catch(()=>{});return result;}
  async load(userId) { return (await this.store.get('queue:'+userId))['queue:'+userId] || []; }
  async prefs(userId) {return preferences((await this.store.get('prefs:'+userId))['prefs:'+userId]);}
  async save(userId,tasks) {const finished=tasks.filter(terminal).sort((a,b)=>b.createdAt-a.createdAt);if(finished.length>200){const keep=new Set(finished.slice(0,200).map(t=>t.id));const retained=tasks.filter(t=>!terminal(t)||keep.has(t.id));tasks.splice(0,tasks.length,...retained);}await this.store.set({['queue:'+userId]:tasks});await this.changed(userId,tasks);}
  async enqueue(items) {
    return this.exclusive(async()=>{
      const {user}=await this.session.ensure();
      if (!['ADMIN','BIDDER'].includes(user.role)||user.canGenerateResumes===false)throw Error('You do not have generation permission.');
      if(!Array.isArray(items)||!items.length||items.length>100)throw Error('Select between 1 and 100 applications.');
      const tasks=await this.load(user.id);
      for(const input of items) {
        if(!input||!/^[\w-]{1,100}$/.test(input.applicationId)|| (input.templateId&&!/^[\w-]{1,100}$/.test(input.templateId)))throw Error('Choose a valid application and template.');
        if(tasks.some(t=>!terminal(t)&&t.applicationId===input.applicationId))continue;
        tasks.push({id:crypto.randomUUID(),applicationId:input.applicationId,templateId:input.templateId||undefined,title:String(input.title||'Application').slice(0,200),company:String(input.company||'').slice(0,200),profileName:String(input.profileName||'').slice(0,200),contextId:typeof input.contextId==='string'?input.contextId.slice(0,100):undefined,autoDownload:input.autoDownload===true,downloadFormat:input.downloadFormat==='DOCX'?'DOCX':'PDF',stage:'waiting',createdAt:Date.now(),attempts:0});
      }
      if(tasks.filter(t=>!terminal(t)).length>500)throw Error('Finish or remove waiting jobs before adding more than 500.');
      await this.save(user.id,tasks);return tasks;
    });
  }
  async observe(applicationId,generation) {
    return this.exclusive(async()=>{const {user}=await this.session.ensure();const tasks=await this.load(user.id);if(tasks.some(t=>t.generationId===generation.id))return;
      tasks.push({id:crypto.randomUUID(),applicationId,generationId:generation.id,title:'Application '+applicationId.slice(0,8),company:'',profileName:'',stage:generation.status==='COMPLETED'?'completed':'queued',createdAt:Date.now(),attempts:1});await this.save(user.id,tasks);
    });
  }
  async saveDocumentEdits(userId,taskId,sourceId,edits,downloadFolder) {
    const {user}=await this.session.ensure();
    if(user.id!==userId)throw Error('The account changed. Open the panel again.');
    if(!['ADMIN','BIDDER'].includes(user.role)||user.canGenerateResumes===false)throw Error('You do not have editing permission.');
    if(typeof sourceId!=='string'||!/^[\w-]{1,100}$/.test(sourceId)||!edits||typeof edits.idempotencyKey!=='string'||!/^[\w-]{1,100}$/.test(edits.idempotencyKey))throw Error('Choose a saved document and a valid edit request.');
    const key=userId+':'+taskId,requestKey=sourceId+':'+edits.idempotencyKey;
    const flight=this.documentSaves.get(key);
    if(flight){if(flight.key!==requestKey)throw Error('Another edit is being saved. Please wait.');return flight.promise;}
    const promise=(async()=>{
      const task=(await this.load(userId)).find(item=>item.id===taskId);
      if(!task||task.stage!=='completed')throw Error('Choose a completed application in your queue.');
      // A lost renderer response can be retried after the saved version was
      // adopted. Reuse it rather than creating another document version.
      if(task.generationId!==sourceId){
        if(task.lastDocumentEdit!==requestKey)throw Error('This document has changed. Reopen it before editing.');
        const preview=await this.session.request('/generations/'+task.generationId+'/preview','GET',undefined,userId);
        return {generation:{id:task.generationId,version:task.documentVersion,status:'COMPLETED'},preview};
      }
      const result=await this.session.request('/generations/'+sourceId+'/edits','POST',edits,userId);
      if(typeof result?.generation?.id!=='string'||!(/^[\w-]{1,100}$/.test(result.generation.id))||result.generation.status!=='COMPLETED')throw Error('The server did not return a saved document. Retry this save.');
      await this.exclusive(async()=>{
        if((await this.session.ensure()).user.id!==userId)throw Error('The account changed.');
        const tasks=await this.load(userId),current=tasks.find(item=>item.id===taskId);
        if(!current||current.stage!=='completed'||![sourceId,result.generation.id].includes(current.generationId))throw Error('This document has changed. Reopen it before editing.');
        Object.assign(current,{generationId:result.generation.id,documentVersion:result.generation.version,lastDocumentEdit:requestKey});
        if(downloadFolder)current.downloadFolder=downloadFolder;
        await this.save(userId,tasks);
      });
      return result;
    })();
    this.documentSaves.set(key,{key:requestKey,promise});
    try{return await promise;}finally{this.documentSaves.delete(key);}
  }
  async submitNow(applicationId,templateId) {
    return this.exclusive(async()=>{
      const {user}=await this.session.ensure();
      if(!['ADMIN','BIDDER'].includes(user.role)||user.canGenerateResumes===false)throw Error('You do not have generation permission.');
      if(!/^[\w-]{1,100}$/.test(applicationId)||(templateId&&!/^[\w-]{1,100}$/.test(templateId)))throw Error('Choose an application and template.');
      const tasks=await this.load(user.id);let task=tasks.find(t=>!terminal(t)&&t.applicationId===applicationId);
      if(task?.generationId)return this.session.request('/generations/'+task.generationId,'GET',undefined,user.id);
      if(!task){
        if(tasks.filter(t=>!terminal(t)).length>=500)throw Error('Finish or remove waiting jobs before adding more than 500.');
        const app=await this.session.request('/applications/'+applicationId,'GET',undefined,user.id);
        task={id:crypto.randomUUID(),applicationId,templateId:templateId||undefined,title:String(app.jobTitle||'Application').slice(0,200),company:String(app.company||'').slice(0,200),profileName:[app.profile?.firstName,app.profile?.lastName].filter(Boolean).join(' '),stage:'submitting',createdAt:Date.now(),attempts:0};tasks.push(task);
      }
      task.stage='submitting';await this.save(user.id,tasks);
      try{
        const generation=await this.session.request('/applications/'+applicationId+'/generations','POST',{templateId:task.templateId,idempotencyKey:task.id},user.id);
        task.generationId=generation.id;task.stage=generation.status==='COMPLETED'?'completed':generation.status==='FAILED'?'failed':'queued';await this.save(user.id,tasks);return generation;
      }catch(error){task.error=error.message;task.stage=[400,403,404,409].includes(error.status)?'failed':'waiting';task.nextAttemptAt=Date.now()+30000;await this.save(user.id,tasks);throw error;}
    });
  }
  async edit(id,operation) {return this.exclusive(async()=>{const {user}=await this.session.ensure();let tasks=await this.load(user.id);if(operation==='clear-completed')tasks=tasks.filter(t=>!terminal(t));else{const task=tasks.find(t=>t.id===id);if(!task)throw Error('Queue job not found.');if(operation==='remove'&&task.stage==='waiting')task.stage='cancelled';else if(operation==='retry'&&['failed','cancelled'].includes(task.stage)){task.id=crypto.randomUUID();task.stage='waiting';delete task.generationId;delete task.error;delete task.nextAttemptAt;task.attempts=0;}else throw Error('Only waiting jobs can be removed. Submitted generations continue on the server.');}await this.save(user.id,tasks);return tasks;});}
  async dispatch() {
    const {user}=await this.session.ensure();
    const pending=await this.exclusive(async()=>{
      const tasks=await this.load(user.id),prefs=await this.prefs(user.id);
      if(prefs.queuePaused||!['ADMIN','BIDDER'].includes(user.role)||user.canGenerateResumes===false)return [];
      for(const task of tasks)if(task.stage==='submitting'&&!task.generationId&&!this.submitting.has(task.id))task.stage='waiting';
      const running=tasks.filter(active).length;
      const claimed=tasks.filter(task=>task.stage==='waiting'&&(!task.nextAttemptAt||task.nextAttemptAt<=Date.now())).slice(0,Math.max(0,prefs.parallel-running));
      for(const task of claimed){task.stage='submitting';this.submitting.add(task.id);}
      if(claimed.length)await this.save(user.id,tasks);
      return claimed;
    });
    // Network calls run outside the storage lock. Another browser tab can add
    // and dispatch its job while an earlier submit request is still pending.
    await Promise.all(pending.map(async task=>{
      let values;
      try{const generation=await this.session.request('/applications/'+task.applicationId+'/generations','POST',{templateId:task.templateId,idempotencyKey:task.id},user.id);values={generationId:generation.id,stage:generation.status==='COMPLETED'?'completed':generation.status==='FAILED'?'failed':'queued',error:undefined,nextAttemptAt:undefined};}
      catch(error){const attempts=(task.attempts||0)+1;values={attempts,error:error.message,stage:[400,403,404,409].includes(error.status)?'failed':'waiting',nextAttemptAt:Date.now()+Math.max(error.retryAfter*1000||0,Math.min(600000,30000*2**Math.min(attempts,4)))};}
      try{await this.exclusive(async()=>{const tasks=await this.load(user.id),current=tasks.find(item=>item.id===task.id);if(current){Object.assign(current,values);await this.save(user.id,tasks);}});}finally{this.submitting.delete(task.id);}
    }));
    return this.load(user.id);
  }
  async tick() {
    const {user}=await this.session.ensure(),prefs=await this.prefs(user.id);
    const polled=(await this.load(user.id)).filter(task=>active(task)&&task.generationId).sort((a,b)=>(a.lastCheckedAt||0)-(b.lastCheckedAt||0)).slice(0,12);
    await Promise.all(polled.map(async task=>{
      let values;
      try{const generation=await this.session.request('/generations/'+task.generationId,'GET',undefined,user.id);const stage=generation.status==='COMPLETED'?'completed':generation.status==='FAILED'?'failed':generation.status==='QUEUED'?'queued':'running';values={stage,lastCheckedAt:Date.now(),...(stage==='failed'?{error:String(generation.errorMessage||'Generation failed.').slice(0,1000)}:{}),...(stage==='completed'?{finishedAt:Date.now()}:{})};}
      catch(error){values=[400,403,404].includes(error.status)?{stage:'failed',error:error.message,lastCheckedAt:Date.now()}:{lastCheckedAt:Date.now()};}
      let completed;
      await this.exclusive(async()=>{const tasks=await this.load(user.id),current=tasks.find(item=>item.id===task.id);if(!current)return;const changed=values.stage&&current.stage!==values.stage;Object.assign(current,values);if(changed){await this.save(user.id,tasks);if(current.stage==='completed')completed={...current};}else await this.store.set({['queue:'+user.id]:tasks});});
      if(completed)await this.completed(user,completed,prefs);
    }));
    await this.dispatch();return this.load(user.id);
  }
}
