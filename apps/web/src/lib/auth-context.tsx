'use client';

import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { api, User } from '@/lib/api';
import { usePathname } from 'next/navigation';
import { ApiRequestError } from '@anchorproposal/shared';

interface AuthContextType {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  isMaster: boolean;
  /** Staff UI (Users/Settings): MASTER or ADMIN */
  isAdmin: boolean;
  /** Can create applications / generate: ADMIN or BIDDER */
  canBid: boolean;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const isPublicResume = usePathname()?.startsWith('/resume/') ?? false;
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [connectionError, setConnectionError] = useState('');
  const [reconnect, setReconnect] = useState(0);

  useEffect(() => {
    // Viewing a shared resume must not refresh a stale login or redirect to sign-in.
    if (isPublicResume) return;
    setConnectionError(''); setLoading(true);
    let cancelled = false;
    const finish = () => {
      if (!cancelled) setLoading(false);
    };

    const boot = async () => {
      if (!api.getAccessToken()) {
        finish();
        return;
      }
      try {
        const me = await api.getMe();
        if (!cancelled) {
          setUser(me);
          setConnectionError('');
        }
      } catch (error) {
        const expired = error instanceof ApiRequestError && [401, 403].includes(error.status) || error instanceof Error && error.message === 'Session expired';
        if (expired) api.clearTokens();
        if (!cancelled) {
          if (expired) setUser(null);
          else setConnectionError(error instanceof Error ? error.message : 'The server is temporarily unavailable.');
        }
      } finally {
        finish();
      }
    };

    // Never stay on the splash longer than 12s (ngrok/network hangs).
    // Do not clear tokens here — a slow /auth/me over ngrok must not wipe a fresh login.
    const timeout = window.setTimeout(() => {
      if (!cancelled) setConnectionError('Connecting is taking longer than usual. Your login is kept.');
      finish();
    }, 12_000);

    void boot().finally(() => window.clearTimeout(timeout));

    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
    };
  }, [isPublicResume, reconnect]);

  const login = async (email: string, password: string) => {
    const res = await api.login(email, password);
    api.setTokens(res.accessToken, res.refreshToken);
    setUser(res.user);
    setConnectionError('');
  };

  const logout = async () => {
    try { await api.logout(); } catch { /* ignore */ }
    api.clearTokens();
    setUser(null);
  };

  const isMaster = user?.role === 'MASTER';
  const isAdmin = user?.role === 'MASTER' || user?.role === 'ADMIN';
  const canBid = user?.role === 'ADMIN' || user?.role === 'BIDDER';

  return (
    <AuthContext.Provider
      value={{ user, loading, login, logout, isMaster, isAdmin, canBid }}
    >
      {connectionError && !isPublicResume ? <div role="alert" className="flex min-h-screen flex-col items-center justify-center gap-4 bg-slate-50 p-6 text-center text-slate-700"><h1 className="text-xl font-semibold">Reconnect to AnchorProposal</h1><p className="max-w-lg text-sm">{connectionError}</p><button className="rounded-lg bg-primary px-4 py-2 text-white" onClick={() => setReconnect(value => value + 1)}>Retry connection</button></div> : children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
