import { API_SERVER, apiRoute } from './security.mjs';
import { fetchWithRecovery, responseJson } from '../../../packages/shared/dist/http.js';
export class ApiError extends Error {
  constructor(message,status=0,retryAfter=0) { super(message); this.status=status; this.retryAfter=retryAfter; }
}
export class Session {
  constructor(local, session, request=(...args)=>globalThis.fetch(...args)) { this.local=local; this.session=session; this.fetch=request; this.epoch=0; this.refreshing=null; this.commits=Promise.resolve(); }
  commit(epoch,work) {const result=this.commits.then(()=>{if(epoch!==this.epoch)throw new ApiError('The account changed.',401);return work();});this.commits=result.catch(()=>{});return result;}
  async current() { return (await this.session.get('auth')).auth || null; }
  async parse(response) {
    return responseJson(response);
  }
  async raw(route, options={}) {
    let body; try { body=JSON.parse(options.body); } catch {}
    return fetchWithRecovery(API_SERVER+route,{...options,credentials:'omit',redirect:'error',headers:{'Content-Type':'application/json',...options.headers}}, { fetcher:this.fetch, timeoutMs:/\/export$|\/edits$|\/draft-preview$|\/answers(?:\/prompt)?$/.test(route)?240000:30000, idempotent:options.method==='POST'&&(!!body?.idempotencyKey||/\/cancel$/.test(route)) });
  }
  async login(email,password) {
    if (typeof email!=='string'||typeof password!=='string'||email.length>320||password.length>1000) throw Error('Enter your email and password.');
    const epoch=++this.epoch;
    const data=await this.parse(await this.raw('/auth/login',{method:'POST',body:JSON.stringify({email,password})}));
    if (epoch!==this.epoch) throw Error('Sign-in was superseded.');
    if (!data.user?.id || typeof data.accessToken!=='string'||typeof data.refreshToken!=='string') throw Error('Invalid sign-in response.');
    await this.commit(epoch,async()=>{await this.local.set({refreshToken:data.refreshToken,accountId:data.user.id});await this.session.set({auth:{user:data.user,accessToken:data.accessToken}});});
    return data.user;
  }
  async refresh() {
    if (this.refreshing) return this.refreshing;
    const epoch=this.epoch;
    this.refreshing=(async()=>{
      const {refreshToken,accountId}=await this.local.get(['refreshToken','accountId']);
      if (!refreshToken) throw new ApiError('Sign in to AnchorProposal.',401);
      let data;
      try { data=await this.parse(await this.raw('/auth/refresh',{method:'POST',body:JSON.stringify({refreshToken})})); }
      catch(error) { if ([400,401,403].includes(error.status) && epoch===this.epoch) { await this.local.remove(['refreshToken','accountId']);await this.session.remove('auth'); } throw error; }
      if (epoch!==this.epoch) throw new ApiError('The account changed. Sign in again.',401);
      if (!data.accessToken||!data.refreshToken) throw Error('Invalid session response.');
      await this.commit(epoch,()=>this.local.set({refreshToken:data.refreshToken}));
      // The account is verified before any queued job can be submitted.
      const me=await this.parse(await this.raw('/auth/me',{headers:{Authorization:'Bearer '+data.accessToken}}));
      if (epoch!==this.epoch || (accountId && me.id!==accountId)) throw new ApiError('The account changed. Sign in again.',401);
      const auth={user:me,accessToken:data.accessToken};
      await this.commit(epoch,async()=>{await this.local.set({accountId:me.id});await this.session.set({auth});});return auth;
    })().finally(()=>{this.refreshing=null;});
    return this.refreshing;
  }
  async ensure() { return await this.current() || await this.refresh(); }
  async request(route, method='GET', body, expectedUserId) {
    apiRoute(route,method);
    if (body!==undefined && JSON.stringify(body).length>400000) throw Error('This request is too large.');
    const epoch=this.epoch; let auth=await this.ensure();
    const check=()=>{if(epoch!==this.epoch || (expectedUserId && auth.user.id!==expectedUserId))throw new ApiError('The account changed.',401);};
    check();
    const send=()=>this.raw(route,{method,headers:{Authorization:'Bearer '+auth.accessToken},...(body===undefined?{}:{body:JSON.stringify(body)})});
    let response=await send();
    if(response.status===401) { const latest=await this.current(); auth=latest&&latest.accessToken!==auth.accessToken?latest:await this.refresh();check();response=await send(); }
    const result=await this.parse(response);check();return result;
  }
  async logout() {
    const auth=await this.current(),epoch=++this.epoch;
    await this.commit(epoch,async()=>{await this.local.remove(['refreshToken','accountId']);await this.session.remove('auth');});
    if(auth) await this.raw('/auth/logout',{method:'POST',headers:{Authorization:'Bearer '+auth.accessToken}}).catch(()=>{});
  }
}
