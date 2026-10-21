// Draft JDs live only in trusted session storage, scoped by account and tab.
export const blankForm=()=>({profileId:'',templateId:'',jobTitle:'',company:'',location:'',workArrangement:'REMOTE',source:'',jobUrl:'',noJobLink:false,jobDescription:''});
const limits={profileId:100,templateId:100,jobTitle:250,company:250,location:1000,source:250,jobUrl:5000,jobDescription:100000};
export function cleanDraft(value={}) {
  const form=blankForm();for(const [key,limit] of Object.entries(limits))if(typeof value.form?.[key]==='string')form[key]=value.form[key].slice(0,limit);
  form.noJobLink=value.form?.noJobLink===true;
  if(['REMOTE','HYBRID','ONSITE','UNKNOWN'].includes(value.form?.workArrangement))form.workArrangement=value.form.workArrangement;
  return {form,applicationId:typeof value.applicationId==='string'?value.applicationId.slice(0,100):null,activeTaskId:typeof value.activeTaskId==='string'?value.activeTaskId.slice(0,100):null,initialized:value.initialized===true,defaultsVersion:value.defaultsVersion===1?1:0,autoDownload:value.autoDownload!==false};
}
export class TabDrafts {
  constructor(store){this.store=store;}
  key(userId,contextId){if(!/^tab:\d+$/.test(contextId))throw Error('Open the extension from a browser tab.');return 'draft:'+userId+':'+contextId;}
  async get(userId,contextId){const key=this.key(userId,contextId);return cleanDraft((await this.store.get(key))[key]);}
  async set(userId,contextId,value){const clean=cleanDraft(value);await this.store.set({[this.key(userId,contextId)]:clean});return clean;}
  async removeTab(tabId){const all=await this.store.get(null);const keys=Object.keys(all).filter(key=>key.startsWith('draft:')&&key.endsWith(':tab:'+tabId));if(keys.length)await this.store.remove(keys);}
  async removeUser(userId){const all=await this.store.get(null);const keys=Object.keys(all).filter(key=>key.startsWith('draft:'+userId+':tab:'));if(keys.length)await this.store.remove(keys);}
}
export function tabFromSender(sender){const value=new URL(sender.url).searchParams.get('tabId');if(value!==null){if(!/^\d+$/.test(value)||!Number.isSafeInteger(Number(value)))throw Error('Invalid browser tab.');return Number(value);}return sender.tab?.id;}
