import { API_SERVER, documentDownloadUrl } from './security.mjs';
export function safeDownloadName(value) {
  const name=String(value||'document.pdf').normalize('NFC').replace(/[<>:"/\\|?*\x00-\x1f\x7f]/g,'_').replace(/^[. ]+|[. ]+$/g,'').slice(0,180)||'document.pdf';
  return /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name)?'_'+name:name;
}
function folderPart(value,fallback,limit){
  const clean=safeDownloadName(String(value||'').replace(/\s+/g,' ').trim()||fallback);
  let result='';for(const character of clean){if(new TextEncoder().encode(result+character).length>limit)break;result+=character;}
  return safeDownloadName(result.replace(/[. ]+$/g,'')||fallback);
}
export function jobDownloadFolder(company,role,today=new Date()){
  const date=String(today.getMonth()+1).padStart(2,'0')+'.'+String(today.getDate()).padStart(2,'0');
  return folderPart(company,'Company',40)+' - '+folderPart(role,'Role',65)+' - '+date;
}
export class AutoDownloads {
  constructor(store,session,downloads,changed=()=>{},today=()=>new Date()){this.store=store;this.session=session;this.downloads=downloads;this.changed=changed;this.today=today;this.tail=Promise.resolve();}
  exclusive(work){const next=this.tail.then(work,work);this.tail=next.catch(()=>{});return next;}
  async records(userId){return (await this.store.get('document-downloads:'+userId))['document-downloads:'+userId]||{};}
  async save(userId,records){await this.store.set({['document-downloads:'+userId]:records});await this.changed();}
  async state(userId,generationId){return Object.values(await this.records(userId)).filter(item=>item.generationId===generationId);}
  async process(tasks,retryGenerationId,expectedUserId){return this.exclusive(async()=>{
    const {user}=await this.session.ensure();if(user.canDownloadDocuments===false||(expectedUserId&&user.id!==expectedUserId))return;
    const records=await this.records(user.id);
    const generations=new Set(tasks.map(task=>task.generationId).filter(Boolean));
    let pruned=false;
    for(const [key,item] of Object.entries(records))if(!generations.has(item.generationId)&&!['starting','downloading'].includes(item.state)){delete records[key];pruned=true;}
    if(pruned)await this.save(user.id,records);
    const eligible=tasks.filter(task=>task.stage==='completed'&&task.generationId&&(task.autoDownload||task.generationId===retryGenerationId));
    for(const task of eligible){
      const type=task.downloadFormat==='DOCX'?'DOCX':'PDF';
      // Keep both documents and later retries together, even across midnight.
      const folder=task.downloadFolder||Object.values(records).find(item=>item.generationId===task.generationId&&item.folder)?.folder||jobDownloadFolder(task.company,task.title,this.today());
      for(const kind of ['RESUME','COVER_LETTER']){
        const key=task.generationId+':'+kind+':'+type;
        let record=records[key];
        if(record?.state==='complete'||record?.state==='unavailable')continue;
        const retry=task.generationId===retryGenerationId||(record&&record.version!==2);
        if(record?.downloadId){
          const [item]=await this.downloads.search({id:record.downloadId});
          if(item?.state==='complete'){record.state='complete';await this.save(user.id,records);continue;}
          if(item?.state==='in_progress')continue;
          const error=item?.error||'The download was interrupted. Retry to save this document.';
          if(record.state!=='failed'||record.error!==error){record.state='failed';record.error=error;await this.save(user.id,records);}
          if(!retry)continue;
        }
        if(record?.state==='starting'){
          // Chrome may have accepted the download before the worker stopped.
          const url=record.version===2?documentDownloadUrl(record.fileId):API_SERVER+'/files/'+record.fileId+'/download';
          const items=await this.downloads.search({urlRegex:'^'+url.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'$',startedAfter:new Date(record.beganAt-1000).toISOString()});
          const found=items.find(item=>item.url===url);
          if(found){record.downloadId=found.id;record.state=found.state==='complete'?'complete':found.state==='interrupted'?'failed':'downloading';await this.save(user.id,records);continue;}
          if(!retry){record.state='uncertain';record.error='Check Chrome downloads, then retry if the file was not saved.';await this.save(user.id,records);continue;}
        }
        if(['failed','uncertain'].includes(record?.state)&&!retry)continue;
        if(record?.state==='unavailable')continue;
        try{
          record=records[key]={generationId:task.generationId,kind,type,folder,version:2,state:'preparing'};
          await this.save(user.id,records);
          // Use the same export as the preview's PDF/Word buttons. Exporting
          // renders the saved document; it does not start another AI generation.
          const file=await this.session.request('/generations/'+task.generationId+'/export','POST',{kind,type},user.id);
          if(!/^[\w-]{1,100}$/.test(file.id))throw Error('The server returned an invalid document.');
          const filename=safeDownloadName(file.filename||task.profileName+(kind==='COVER_LETTER'?'_cover letter':'')+'.'+type.toLowerCase());
          await this.session.request('/auth/me','GET',undefined,user.id);
          const auth=await this.session.ensure();if(auth.user.id!==user.id)throw Error('The account changed.');
          record=records[key]={generationId:task.generationId,kind,type,fileId:file.id,filename,folder,version:2,state:'starting',beganAt:Date.now()};
          await this.save(user.id,records);
          const id=await this.downloads.download({url:documentDownloadUrl(file.id),headers:[{name:'Authorization',value:'Bearer '+auth.accessToken}],filename:folder+'/'+filename,saveAs:false,conflictAction:'uniquify'});
          record.downloadId=id;record.state='downloading';await this.save(user.id,records);
        }catch(error){
          if((await this.session.current())?.user.id!==user.id)return;
          records[key]={...(record||{}),generationId:task.generationId,kind,type,folder,version:2,state:record?.state==='starting'?'starting':kind==='COVER_LETTER'&&error.status===400&&/cover letter/i.test(error.message)?'unavailable':'failed',error:String(error.message||'Download failed.').slice(0,1000)};
          await this.save(user.id,records);
        }
      }
    }
  });}
}
