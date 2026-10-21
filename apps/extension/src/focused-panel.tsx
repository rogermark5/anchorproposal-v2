import React,{useEffect,useRef,useState} from 'react';
import {Anchor,FileText,LoaderCircle,LogOut,MonitorUp,Plus,RefreshCw,Settings2,X} from 'lucide-react';
import {api} from '../../web/src/lib/api';
import {ApplicationFormFields} from '../../web/src/components/application-form-fields';
import {useApplicationValidation} from '../../web/src/lib/use-application-validation';
import {FocusedResult} from './document-result';

import {useAuth} from './auth-context';
import {useCatalog,useExtension,profileName,type Preferences,type QueueTask} from './state';
import {blankForm} from './tab-drafts.mjs';
import {rpc} from './platform';
import {useJobCapture} from './use-job-capture';
import {applicationDefaults,newApplicationDraft,restoreApplicationDraft} from './application-defaults.mjs';

type Draft={form:ReturnType<typeof blankForm>;applicationId:string|null;activeTaskId:string|null;initialized:boolean;autoDownload:boolean;defaultsVersion?:number};

const active=(task:QueueTask)=>['waiting','submitting','queued','running'].includes(task.stage);
const emptyDraft=():Draft=>({form:blankForm(),applicationId:null,activeTaskId:null,initialized:false,autoDownload:true});

export function FocusedPanel({initialSettings=false}:{initialSettings?:boolean}){
  const jobCapture=useJobCapture();
  const {user,canBid,logout}=useAuth();const {prefs,tasks,refresh,savePreferences}=useExtension();
  const {profiles,templates,error:catalogError,loading:catalogLoading}=useCatalog();
  const [draft,setDraft]=useState<Draft>(emptyDraft),[contextId,setContextId]=useState(''),[ready,setReady]=useState(false);
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[settings,setSettings]=useState(initialSettings);
  const [options,setOptions]=useState<any>({locations:[],sources:[]});
  const [optionsReady,setOptionsReady]=useState(false);
  const defaults=applicationDefaults(prefs,profiles,templates,options),defaultsRef=useRef(defaults),prefsRef=useRef(prefs);defaultsRef.current=defaults;prefsRef.current=prefs;
  const draftRef=useRef(draft),busyRef=useRef(false),initialized=useRef(false),alive=useRef(true),timer=useRef<ReturnType<typeof setTimeout>|undefined>(undefined);
  const validation=useApplicationValidation(draft.form,ready&&!draft.activeTaskId);
  const task=tasks.find(item=>item.id===draft.activeTaskId),tabTasks=tasks.filter(item=>item.contextId===contextId),running=tasks.filter(active).length;
  const update=(value:Draft)=>{draftRef.current=value;setDraft(value);};
  const flush=()=>rpc<Draft>('draft',{accountId:user!.id,value:draftRef.current});
  useEffect(()=>{alive.current=true;return()=>{alive.current=false;clearTimeout(timer.current);};},[]);
  useEffect(()=>{
    if(!profiles.length||!optionsReady||catalogLoading||initialized.current)return;initialized.current=true;
    void Promise.all([rpc<{contextId:string}>('panel-context'),rpc<Draft>('draft',{accountId:user!.id})]).then(([context,saved])=>{
      if(!alive.current)return;setContextId(context.contextId);
      const next=restoreApplicationDraft(saved,prefsRef.current,defaultsRef.current);
      update(next);setReady(true);
    }).catch(reason=>{if(alive.current){setError(reason.message);initialized.current=false;}});
  },[profiles,templates,user?.id,prefs,optionsReady,catalogLoading]);
  useEffect(()=>{let live=true;void api.getApplicationOptions().then(value=>{if(live)setOptions(value);}).catch(reason=>{if(live)setError(reason.message);}).finally(()=>{if(live)setOptionsReady(true);});return()=>{live=false;};},[]);
  useEffect(()=>{if(!ready||busyRef.current)return;clearTimeout(timer.current);timer.current=setTimeout(()=>{void flush().catch(reason=>alive.current&&setError(reason.message));},180);return()=>clearTimeout(timer.current);},[draft,ready]);
  useEffect(()=>{const hide=()=>{if(ready&&!busyRef.current){clearTimeout(timer.current);void flush().catch(()=>{});}};const visibility=()=>{if(document.visibilityState==='hidden')hide();};window.addEventListener('pagehide',hide);document.addEventListener('visibilitychange',visibility);return()=>{window.removeEventListener('pagehide',hide);document.removeEventListener('visibilitychange',visibility);};},[ready]);
  const reset=()=>{update(newApplicationDraft(prefs,defaults));setError('');};
  const capture=async()=>{if(busyRef.current)return;busyRef.current=true;setBusy(true);setError('');try{const value=await jobCapture.capture();if(alive.current)update({...draftRef.current,form:{...draftRef.current.form,jobTitle:value.jobTitle,company:value.company,location:value.location||draftRef.current.form.location,jobUrl:value.jobUrl,jobDescription:value.jobDescription,workArrangement:value.workArrangement==='UNKNOWN'?draftRef.current.form.workArrangement:value.workArrangement,noJobLink:false}});}catch(reason){if(alive.current)setError((reason as Error).message);}finally{busyRef.current=false;if(alive.current)setBusy(false);}};
  const generate=async()=>{if(busyRef.current||!validation.canSave)return;busyRef.current=true;setBusy(true);setError('');clearTimeout(timer.current);
    try{await flush();const result=await rpc<{draft:Draft}>('focused-submit',{accountId:user!.id,reviewed:validation.reviewed});if(alive.current){update(result.draft);await refresh();}}
    catch(reason){if(alive.current){setError((reason as Error).message);const saved=await rpc<Draft>('draft',{accountId:user!.id}).catch(()=>null);if(saved)update(saved);}}
    finally{busyRef.current=false;if(alive.current)setBusy(false);}
  };
  const retry=async()=>{if(!task)return;setBusy(true);try{const result=await rpc<QueueTask[]>('queue-edit',{id:task.id,operation:'retry'});const next=result.find(item=>item.applicationId===task.applicationId);if(next)update({...draftRef.current,activeTaskId:next.id});await refresh();}catch(reason){setError((reason as Error).message);}finally{setBusy(false);}};
  return <div className="focus-shell">
    <header className="focus-header"><div><Anchor size={21}/><strong>AnchorProposal</strong><span>{running?`${running} in progress`:'New application'}</span></div><button title="Default settings" aria-label="Default settings" onClick={()=>setSettings(true)}><Settings2 size={18}/></button><button title="Sign out" aria-label="Sign out of extension" onClick={()=>void logout()}><LogOut size={17}/></button></header>
    <main className="focus-content">
      {!canBid||user?.canCreateApplications===false?<section className="ext-card"><h1>Application access required</h1><p>Use an Admin or Bidder account with application and generation permissions.</p><button className="ext-secondary" onClick={()=>void rpc('external',{url:'https://anchorproposal.giize.com/dashboard'})}>Open website</button></section>:<>
        <div className="focus-heading"><div><span className="ext-eyebrow">THIS BROWSER TAB</span><h1>{task?'Your application':'New application'}</h1><p>Each tab keeps its own application. Up to {prefs.parallel} can generate together.</p></div>{(task||draft.applicationId)&&<button className="ext-secondary" disabled={busy} onClick={reset}><Plus size={15}/>New</button>}</div>
        {(tabTasks.length>1||(tabTasks.length>0&&!task))&&<label className="focus-history">Applications in this tab<select aria-label="Applications in this tab" value={task?.id||''} onChange={event=>update({...draftRef.current,activeTaskId:event.target.value||null})}><option value="">New application draft</option>{tabTasks.map(item=><option key={item.id} value={item.id}>{item.company} · {item.title} · {item.stage}</option>)}</select></label>}
        {(error||catalogError)&&<div className="ext-error" role="alert">{error||catalogError}</div>}
        {prefs.queuePaused&&<div className="focus-notice">New submissions are paused.<button className="ext-secondary" onClick={()=>void savePreferences({...prefs,queuePaused:false})}>Resume generation</button></div>}
        {task?<section className="focus-job" aria-label="This tab's generation"><div className="focus-job-title"><FileText size={18}/><div><h2>{task.title}</h2><p>{task.company}{task.profileName?' · '+task.profileName:''}</p></div><span className={'ext-chip '+(task.stage==='completed'?'success':task.stage==='failed'?'danger':'')}>{task.stage==='completed'?'Ready':task.stage}</span></div>
          {task.stage==='completed'&&task.generationId?<FocusedResult key={task.id} task={task}/>:task.stage==='failed'||task.stage==='cancelled'?<div className="ext-error"><p>{task.error||'This generation could not be completed.'}</p><button disabled={busy} onClick={()=>void retry()}>Retry generation</button></div>:<div className="focus-generating"><LoaderCircle className="animate-spin" size={31}/><h3>{task.stage==='running'?'Generating your documents':task.stage==='queued'?'Submitted to the server':task.stage==='submitting'?'Starting generation':'Waiting for a generation slot'}</h3><p>You can switch tabs and start another application. This job keeps running.</p><span>Resume preview and answers will appear here when ready.</span></div>}
        </section>:<section className="ext-card focus-form">
          {!ready?catalogLoading||profiles.length?<p className="ext-loading"><LoaderCircle className="animate-spin" size={18}/>{profiles.length?'Restoring this tab…':'Loading your profiles…'}</p>:<div className="focus-notice">{catalogError?'Your profiles could not be loaded. Reopen the panel to try again.':'No profiles are assigned to your account. Ask your administrator to assign a profile before generating.'}</div>:<form onSubmit={event=>{event.preventDefault();void generate();}}>
            <div className="focus-form-top"><span>Application details</span><button type="button" className="ext-secondary" disabled={busy||jobCapture.preparing||!!draft.applicationId} onClick={()=>void capture()}><MonitorUp size={15}/>Capture this tab</button></div>
            {jobCapture.needsAccess&&<p className="ext-footnote">Capture will ask Chrome to allow access to this job site.</p>}
            {draft.applicationId&&<p className="focus-notice">Your application is saved. Generate for this application or choose New to start another.</p>}
            <fieldset disabled={busy||!!draft.applicationId}><div className="ext-form-grid"><label>Profile<select aria-label="Application profile" value={draft.form.profileId} onChange={event=>update({...draftRef.current,form:{...draftRef.current.form,profileId:event.target.value}})} required><option value="">Choose profile</option>{profiles.map(profile=><option key={profile.id} value={profile.id}>{profileName(profile)}</option>)}</select></label><label>Template<select aria-label="Application template" value={draft.form.templateId} onChange={event=>update({...draftRef.current,form:{...draftRef.current.form,templateId:event.target.value}})}><option value="">Profile default</option>{templates.map(template=><option key={template.id} value={template.id}>{template.name}</option>)}</select></label></div>
              <div className="ext-fields"><ApplicationFormFields form={draft.form} setForm={form=>update({...draftRef.current,form})} profiles={profiles.map(profile=>({...profile,profileTitle:profile.profileTitle||''}))} templates={templates} showProfileSelect={false} showTemplateSelect={false} locations={options.locations} sources={options.sources} onOptionsChange={async()=>{const value=await api.getApplicationOptions();setOptions(value);return value;}} validation={validation}/></div>
            </fieldset>
            <div className="focus-submit"><label><input type="checkbox" checked={draft.autoDownload&&user?.canDownloadDocuments!==false} onChange={event=>update({...draftRef.current,autoDownload:event.target.checked})} disabled={busy||user?.canDownloadDocuments===false}/>Save resume &amp; cover letter in a job folder ({prefs.downloadFormat||'PDF'})</label><div><button className="ext-secondary" type="button" disabled={busy} onClick={reset}>Clear</button><button className="ext-primary" type="submit" disabled={busy||!validation.canSave||user?.canGenerateResumes===false}>{busy?<LoaderCircle className="animate-spin" size={17}/>:<FileText size={17}/>}Generate resume</button></div></div>
          </form>}
        </section>}
      </>}
    </main>
    {settings&&<FocusedDefaults profiles={profiles} templates={templates} onClose={()=>setSettings(false)}/>}
  </div>;
}

function FocusedDefaults({profiles,templates,onClose}:{profiles:ReturnType<typeof useCatalog>['profiles'];templates:ReturnType<typeof useCatalog>['templates'];onClose:()=>void}){
  const {prefs,savePreferences}=useExtension();const [value,setValue]=useState<Preferences>(prefs),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const dialog=useRef<HTMLElement>(null),closeRef=useRef(onClose),busyRef=useRef(busy);closeRef.current=onClose;busyRef.current=busy;
  useEffect(()=>{const previous=document.activeElement as HTMLElement|null;const element=dialog.current;if(!element)return;const focusable=()=>Array.from(element.querySelectorAll<HTMLElement>('button:not([disabled]),input:not([disabled]),select:not([disabled])'));focusable()[0]?.focus();const keys=(event:KeyboardEvent)=>{if(event.key==='Escape'&&!busyRef.current){event.preventDefault();event.stopPropagation();closeRef.current();}if(event.key==='Tab'){const controls=focusable(),first=controls[0],last=controls[controls.length-1];if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}}};element.addEventListener('keydown',keys);return()=>{element.removeEventListener('keydown',keys);previous?.focus();};},[]);
  const change=(key:keyof Preferences,next:unknown)=>setValue(previous=>({...previous,[key]:next}));
  return <div className="focus-settings-backdrop" role="presentation"><section ref={dialog} className="focus-settings" role="dialog" aria-modal="true" aria-labelledby="focus-settings-title"><header><h2 id="focus-settings-title">Default settings</h2><button aria-label="Close default settings" disabled={busy} onClick={onClose}><X size={19}/></button></header><form onSubmit={event=>{event.preventDefault();setBusy(true);void savePreferences(value).then(onClose).catch(reason=>setError(reason.message)).finally(()=>setBusy(false));}}><div className="ext-form-grid"><label>Default profile<select value={value.profileId} onChange={event=>change('profileId',event.target.value)}><option value="">Account default</option>{profiles.map(profile=><option key={profile.id} value={profile.id}>{profileName(profile)}</option>)}</select></label><label>Default template<select value={value.templateId} onChange={event=>change('templateId',event.target.value)}><option value="">Profile default</option>{templates.map(template=><option key={template.id} value={template.id}>{template.name}</option>)}</select></label><label>Concurrent generations<select aria-label="Concurrent generations" value={value.parallel} onChange={event=>change('parallel',Number(event.target.value))}>{[2,3].map(number=><option key={number} value={number}>{number} at the same time</option>)}</select></label><label>Automatic download format<select value={value.downloadFormat||'PDF'} onChange={event=>change('downloadFormat',event.target.value)}><option value="PDF">PDF</option><option value="DOCX">Word (DOCX)</option></select></label><label>Default location<input value={value.location} onChange={event=>change('location',event.target.value)}/></label><label>Default source<input value={value.source} onChange={event=>change('source',event.target.value)}/></label></div><label className="ext-toggle"><input type="checkbox" checked={value.autoDownload!==false} onChange={event=>change('autoDownload',event.target.checked)}/>Automatically download both documents for new applications</label><p className="ext-footnote">Submitted generations continue when you change tabs or close this panel. Both documents are saved in Downloads / Company - Role - MM.DD, using your local date.</p>{error&&<p className="ext-error" role="alert">{error}</p>}<button className="ext-primary" type="submit" disabled={busy}>{busy?'Saving…':'Save defaults'}</button></form></section></div>;
}
