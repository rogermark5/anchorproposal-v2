import {createContext,useContext} from 'react';
import type {User} from '../../web/src/lib/api';
export type AuthState={user:User|null;loading:boolean;login:(email:string,password:string)=>Promise<void>;logout:()=>Promise<void>;isMaster:boolean;isAdmin:boolean;canBid:boolean};
export const ExtensionAuthContext=createContext<AuthState|null>(null);
export function useAuth(){const value=useContext(ExtensionAuthContext);if(!value)throw Error('Sign in to continue.');return value;}
