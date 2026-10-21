declare global { interface Window { anchor: any } const chrome: any; }
export async function rpc<T=any>(action:string,values:Record<string,unknown>={}):Promise<T>{
  const result=await chrome.runtime.sendMessage({action,...values});
  if(!result?.ok)throw Object.assign(new Error(result?.error||'Reload the extension to reconnect.'),{status:result?.status});
  return result.value as T;
}
window.anchor={
  request:(route:string,method='GET',body?:unknown)=>rpc('request',{route,method,body}),
  bootstrap:async()=>({settings:{server:(await rpc('bootstrap')).server}}),
  poolDefaults:()=>rpc('preferences'),
  download:(id:string,filename?:string)=>rpc('download',{id,filename}),
  external:(url:string)=>rpc('external',{url}),
  upload:()=>Promise.reject(new Error('Open the website to upload files.')),
  publicRequest:()=>Promise.reject(new Error('Open public links on the website.')),
};
