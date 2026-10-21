import {createContext,useContext,useEffect,useState} from 'react';
import {api} from '../../web/src/lib/api';
export type Preferences={profileId:string;templateId:string;location:string;source:string;country:string;days:string;applied:string;parallel:number;notifications:boolean;startPage:string;queuePaused:boolean;autoDownload?:boolean;downloadFormat?:'PDF'|'DOCX';workflowVersion?:number};
export type QueueTask={id:string;applicationId:string;generationId?:string;title:string;company:string;profileName:string;stage:string;createdAt:number;error?:string;finishedAt?:number;contextId?:string;autoDownload?:boolean;downloadFormat?:'PDF'|'DOCX';downloadFolder?:string;documentVersion?:number};
export type CatalogProfile={id:string;firstName:string;lastName:string;profileTitle?:string;isDefault?:boolean};
export type CatalogTemplate={id:string;name:string;isDefault?:boolean};
export type ExtensionState={prefs:Preferences;tasks:QueueTask[];savePreferences:(value:Preferences)=>Promise<void>;enqueue:(items:Record<string,unknown>[])=>Promise<void>;refresh:()=>Promise<void>};
export const State=createContext<ExtensionState|null>(null);
export function useExtension(){const value=useContext(State);if(!value)throw Error('Open the workspace to continue.');return value;}
export function useCatalog(){const[profiles,setProfiles]=useState<CatalogProfile[]>([]),[templates,setTemplates]=useState<CatalogTemplate[]>([]),[error,setError]=useState(''),[loading,setLoading]=useState(true);useEffect(()=>{let alive=true;void Promise.all([api.getProfiles(),api.getTemplates()]).then(([p,t])=>{if(alive){setProfiles(p as CatalogProfile[]);setTemplates(t as CatalogTemplate[]);}}).catch(e=>alive&&setError(e.message)).finally(()=>alive&&setLoading(false));return()=>{alive=false;};},[]);return{profiles,templates,error,loading};}
export const profileName=(profile:{firstName?:string;lastName?:string})=>[profile.firstName,profile.lastName].filter(Boolean).join(' ');
