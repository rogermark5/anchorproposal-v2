import React,{createContext,useContext,useMemo,useState,useEffect} from 'react';
type Navigation={path:string;push:(url:string)=>void;replace:(url:string)=>void;back:()=>void;refresh:()=>void};
const Context=createContext<Navigation|null>(null);
export function NavigationProvider({children}:{children:React.ReactNode}){
  const read=()=>location.hash.startsWith('#/')?location.hash.slice(1):'/dashboard';const[path,setPath]=useState(read);const[,revise]=useState(0);
  useEffect(()=>{const update=()=>setPath(read());window.addEventListener('hashchange',update);return()=>window.removeEventListener('hashchange',update);},[]);
  const value=useMemo(()=>({path,push:(url:string)=>{if(url.startsWith('/')&&!url.startsWith('//')){location.hash=url;setPath(url);}},replace:(url:string)=>{if(url.startsWith('/')&&!url.startsWith('//')){history.replaceState(null,'','#'+url);setPath(url);}},back:()=>history.back(),refresh:()=>revise(v=>v+1)}),[path]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
export function useRouter(){const value=useContext(Context);if(!value)throw Error('Navigation unavailable.');return value;}
export function usePathname(){return useRouter().path.split('?')[0];}
export function useSearchParams(){const path=useRouter().path;return useMemo(()=>new URLSearchParams(path.split('?')[1]||''),[path]);}
export function useParams<T extends Record<string,string>>(){return {id:usePathname().split('/')[2]} as unknown as T;}
export default function Link({href,children,onClick,prefetch,...rest}:React.AnchorHTMLAttributes<HTMLAnchorElement>&{href:string;prefetch?:boolean}){const router=useRouter();return <a {...rest} href={href.startsWith('/')?'#'+href:href} onClick={event=>{onClick?.(event);if(event.defaultPrevented)return;event.preventDefault();if(href.startsWith('/')&&!href.startsWith('//'))router.push(href);else void window.anchor.external(href);}}>{children}</a>;}
