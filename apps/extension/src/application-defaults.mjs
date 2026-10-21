import {blankForm,cleanDraft} from './tab-drafts.mjs';

export function applicationDefaults(prefs={},profiles=[],templates=[],options={}){
  const profile=profiles.find(item=>item.id===prefs.profileId)||profiles.find(item=>item.isDefault)||profiles[0];
  const usable=templates.filter(item=>item.isPublished!==false&&!item.archivedAt);
  const template=usable.find(item=>item.id===prefs.templateId)||usable.find(item=>item.isDefault)||usable[0];
  const option=(values=[])=>values.find(item=>item.isDefault)?.value||values[0]?.value||'';
  return {...blankForm(),profileId:profile?.id||'',templateId:template?.id||'',
    location:prefs.location||option(options.locations),source:prefs.source||option(options.sources)};
}

export function newApplicationDraft(prefs,form){
  return {form:{...form},applicationId:null,activeTaskId:null,initialized:true,defaultsVersion:1,autoDownload:prefs.autoDownload!==false};
}

export function restoreApplicationDraft(value,prefs,defaults){
  const saved=cleanDraft(value);
  const untouched=!saved.applicationId&&!saved.activeTaskId&&!['jobTitle','company','jobUrl','jobDescription'].some(key=>saved.form[key].trim());
  // Upgrade empty drafts from versions that never loaded account defaults.
  // Once initialized, even intentionally empty fields remain the user's choice.
  if(saved.initialized&&(saved.defaultsVersion===1||!untouched))return {...saved,defaultsVersion:1};
  const form={...saved.form};
  for(const key of ['profileId','templateId','location','source'])if(!form[key])form[key]=defaults[key];
  return {...saved,form,initialized:true,defaultsVersion:1,autoDownload:saved.initialized?saved.autoDownload:prefs.autoDownload!==false};
}
