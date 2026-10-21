import {useEffect,useRef,useState} from 'react';
import {captureWithAccess} from './capture-access.mjs';
import {rpc} from './platform';

type CaptureTarget={tabId:number;url:string;origin:string;pattern:string;hasPermission:boolean;loading:boolean;error?:string};
type CapturedJob={jobTitle:string;company:string;location:string;jobUrl:string;jobDescription:string;workArrangement:string};
export function useJobCapture(focused=true){
  const [target,setTarget]=useState<CaptureTarget|null>(null);
  const refresh=useRef<()=>void>(()=>{});
  useEffect(()=>{
    let live=true,revision=0,current:CaptureTarget|null=null;
    const load=()=>{const version=++revision;void rpc<CaptureTarget>('capture-target',{focused}).then(value=>{if(live&&revision===version){current=value;setTarget(value);}}).catch(reason=>{if(live&&revision===version)setTarget({tabId:current?.tabId??-1,url:'',origin:'',pattern:'',hasPermission:false,loading:false,error:reason.message});});};
    const updated=(tabId:number,change:any)=>{if(!current||tabId===current.tabId){if(change.status==='loading'||change.url)setTarget(null);load();}};
    const activated=()=>{if(!focused)load();};
    const visible=()=>{if(document.visibilityState==='visible')load();};
    refresh.current=load;load();chrome.tabs.onUpdated.addListener(updated);chrome.tabs.onActivated.addListener(activated);
    chrome.permissions.onAdded.addListener(load);chrome.permissions.onRemoved.addListener(load);document.addEventListener('visibilitychange',visible);window.addEventListener('focus',load);
    return()=>{live=false;revision++;chrome.tabs.onUpdated.removeListener(updated);chrome.tabs.onActivated.removeListener(activated);chrome.permissions.onAdded.removeListener(load);chrome.permissions.onRemoved.removeListener(load);document.removeEventListener('visibilitychange',visible);window.removeEventListener('focus',load);};
  },[focused]);
  const capture=():Promise<CapturedJob>=>captureWithAccess(target,chrome.permissions,(expected:Record<string,unknown>)=>rpc<CapturedJob>('capture',{focused,...expected})).finally(()=>refresh.current());
  return {capture,preparing:!target||target.loading,needsAccess:target&&!target.error&&!target.hasPermission};
}
