import {useEffect,useRef,useState} from 'react';
import {Check,Download,Eye,LoaderCircle,Pencil,Save,X} from 'lucide-react';
import {api,type DocumentEdits,type GenerationDocumentPreview} from '../../web/src/lib/api';
import {DocumentContentEditor,editableDocument} from '../../web/src/components/document-content-editor';
import {TemplatePreviewFrame} from '../../web/src/components/template-preview-frame';
import {GetAnswersPanel} from '../../web/src/components/get-answers';
import {useAuth} from './auth-context';
import {useExtension,type QueueTask} from './state';
import {rpc} from './platform';

type DownloadRecord={kind:string;state:string;folder?:string;error?:string};
const cleanBullets=(lines:string[])=>lines.map(line=>line.replace(/^\s*[•*-]\s+/,'').trim()).filter(Boolean);
function cleanEdits(draft:DocumentEdits):DocumentEdits{
  return {...draft,experiences:draft.experiences.map(row=>({...row,bullets:cleanBullets(row.bullets)})),
    projects:draft.projects?.map(row=>({...row,bullets:cleanBullets(row.bullets)})),
    coreExpertise:draft.coreExpertise?.map(value=>value.trim()).filter(Boolean),
    ...(draft.coverLetter?{coverLetter:{...draft.coverLetter,paragraphs:draft.coverLetter.paragraphs.map(value=>value.trim()).filter(Boolean)}}:{})};
}

export function FocusedResult({task}:{task:QueueTask}){
  const {user}=useAuth(),{refresh}=useExtension();
  const [tab,setTab]=useState('Resume'),[answers,setAnswers]=useState(false);
  const [preview,setPreview]=useState<GenerationDocumentPreview|null>(null),[error,setError]=useState(''),[status,setStatus]=useState('');
  const [revision,setRevision]=useState(0),[downloads,setDownloads]=useState<DownloadRecord[]>([]);
  const [draft,setDraft]=useState<DocumentEdits|null>(null),[draftPreview,setDraftPreview]=useState(false),[busy,setBusy]=useState('');
  const busyRef=useRef(false),savedPreview=useRef<GenerationDocumentPreview|null>(null),editSource=useRef(''),saveKey=useRef('');
  const generationId=task.generationId!;
  useEffect(()=>{
    let live=true;setError('');setPreview(null);setDraft(null);setDraftPreview(false);savedPreview.current=null;
    void api.getGenerationPreview(generationId).then(value=>{if(live)setPreview(value);}).catch(reason=>live&&setError(reason.message));
    return()=>{live=false;};
  },[generationId,revision]);
  useEffect(()=>{
    let live=true,inFlight=false;setDownloads([]);
    const load=()=>{if(inFlight)return;inFlight=true;void rpc<DownloadRecord[]>('document-downloads',{generationId}).then(value=>{if(live)setDownloads(value);}).catch(()=>{}).finally(()=>{inFlight=false;});};
    load();const changed=(message:any)=>{if(message.event==='changed')load();};chrome.runtime.onMessage.addListener(changed);const timer=setInterval(load,3000);
    return()=>{live=false;clearInterval(timer);chrome.runtime.onMessage.removeListener(changed);};
  },[generationId]);
  async function action(name:string,work:()=>Promise<void>){
    if(busyRef.current)return;busyRef.current=true;setBusy(name);setError('');
    try{await work();}catch(reason){setError((reason as Error).message);}finally{busyRef.current=false;setBusy('');}
  }
  function edit(){
    if(!preview?.canEdit||!preview.content||busyRef.current)return;
    savedPreview.current=preview;editSource.current=generationId;saveKey.current=crypto.randomUUID();
    setDraft(editableDocument(preview.content));setDraftPreview(false);setError('');setStatus('');
  }
  function discard(){
    if(busyRef.current)return;setPreview(savedPreview.current);setDraft(null);setDraftPreview(false);setError('');setStatus('Changes discarded.');
  }
  const updateDraft=(value:DocumentEdits)=>{saveKey.current=crypto.randomUUID();setDraft(value);setDraftPreview(false);setStatus('');};
  const previewChanges=()=>action('preview',async()=>{
    if(!draft)return;const result=await api.previewDocumentEdits(editSource.current,cleanEdits(draft));
    setPreview(result);setDraftPreview(true);setStatus('Preview of unsaved changes. Save edits to update your documents.');
  });
  const saveEdits=()=>action('save',async()=>{
    if(!draft)return;
    const result=await rpc<{generation:{id:string;version:number};preview:GenerationDocumentPreview}>('save-document-edits',{
      accountId:user?.id,taskId:task.id,generationId:editSource.current,edits:{...cleanEdits(draft),idempotencyKey:saveKey.current}
    });
    setPreview(result.preview);savedPreview.current=result.preview;setDraft(null);setDraftPreview(false);setAnswers(false);
    setStatus(`Edits saved as version ${result.generation.version}.${task.autoDownload?' Updated documents will download to the same job folder.':''}`);
    await refresh();
  });
  const download=(type:'PDF'|'DOCX')=>action('download',async()=>{
    if(draft||tab==='Get answers')return;setStatus('Preparing download…');
    const file=await api.exportGenerationFile(generationId,{kind:tab==='Cover letter'?'COVER_LETTER':'RESUME',type});
    await rpc('download',{id:file.id,filename:file.filename});setStatus('Download started.');
  });
  const retry=()=>action('retry',async()=>{setDownloads(await rpc<DownloadRecord[]>('retry-document-downloads',{generationId}));});
  const missingDocument=!preview||(tab==='Cover letter'&&!preview.coverLetterHtml);
  return <section className="focus-result" aria-label="Generated documents and answers">
    <div className="focus-result-tabs" role="tablist" aria-label="Documents and answers">
      {['Resume','Cover letter','Get answers'].map(name=><button key={name} role="tab" aria-selected={tab===name} disabled={!!busy||(!!draft&&name==='Get answers')} onClick={()=>{setTab(name);if(name==='Get answers')setAnswers(true);}}>{name}</button>)}
    </div>
    {task.autoDownload&&<div className="focus-downloads" aria-live="polite">
      {downloads.find(record=>record.folder)?.folder&&<p className="focus-download-folder">Downloads / {downloads.find(record=>record.folder)!.folder}</p>}
      {!downloads.length?'Preparing automatic downloads…':downloads.map(record=><span key={record.kind}><span>{record.kind==='RESUME'?'Resume':'Cover letter'}:</span> {record.state==='complete'?<><Check size={12}/>Downloaded</>:record.state==='preparing'?'Preparing export…':record.state==='downloading'?'Downloading…':record.state==='starting'?'Starting download…':record.state==='unavailable'?'Not included':record.error||'Download failed'}</span>)}
      {downloads.some(record=>['failed','uncertain'].includes(record.state))&&<button disabled={!!busy||!!draft} onClick={()=>void retry()}>Retry unfinished downloads</button>}
    </div>}
    {tab!=='Get answers'&&(draft?<div className="focus-edit-toolbar">
      <p>Editing documents · save to update previews and downloads.</p>
      <div className="focus-document-actions">
        <button className="ext-secondary" disabled={!!busy} onClick={discard}><X size={14}/>Discard</button>
        {draftPreview?<button className="ext-secondary" disabled={!!busy} onClick={()=>setDraftPreview(false)}><Pencil size={14}/>Continue editing</button>:<button className="ext-secondary" disabled={!!busy} onClick={()=>void previewChanges()}><Eye size={14}/>{busy==='preview'?'Preparing…':'Preview changes'}</button>}
        <button className="ext-primary" disabled={!!busy} onClick={()=>void saveEdits()}>{busy==='save'?<LoaderCircle size={14} className="animate-spin"/>:<Save size={14}/>}Save edits</button>
      </div>
    </div>:<div className="focus-document-actions">
      <button className="ext-primary" disabled={user?.canDownloadDocuments===false||!!busy||!!missingDocument} onClick={()=>void download('PDF')}><Download size={14}/>{busy==='download'?'Preparing…':'Download PDF'}</button>
      <button className="ext-secondary" disabled={user?.canDownloadDocuments===false||!!busy||!!missingDocument} onClick={()=>void download('DOCX')}>Word</button>
      {preview?.canEdit&&preview.content&&<button className="ext-secondary" disabled={!!busy} onClick={edit}><Pencil size={14}/>Edit</button>}
    </div>)}
    {status&&<p className="ext-footnote" role="status">{status}</p>}
    {error&&<div className="ext-error" role="alert">{error}{!draft&&!preview&&<button disabled={!!busy} onClick={()=>setRevision(value=>value+1)}>Retry preview</button>}</div>}
    {draft&&!draftPreview&&savedPreview.current?.content?<div className="focus-document-editor"><DocumentContentEditor value={draft} original={savedPreview.current.content} disabled={!!busy} onChange={updateDraft} section={tab==='Cover letter'?'cover-letter':'resume'}/></div>:<>
      <div hidden={tab!=='Resume'} role="tabpanel">{preview?<TemplatePreviewFrame html={preview.html} pageSize={preview.pageSize}/>:!error&&<p className="ext-loading">Loading resume preview…</p>}</div>
      <div hidden={tab!=='Cover letter'} role="tabpanel">{preview?.coverLetterHtml?<TemplatePreviewFrame html={preview.coverLetterHtml} pageSize={preview.pageSize}/>:<p className="ext-footnote">{preview?'No cover letter was included in this generation.':'Loading cover letter…'}</p>}</div>
    </>}
    <div hidden={tab!=='Get answers'} role="tabpanel">{answers&&<GetAnswersPanel key={generationId} generationId={generationId} jobTitle={task.title} className="focus-answers"/>}</div>
  </section>;
}
