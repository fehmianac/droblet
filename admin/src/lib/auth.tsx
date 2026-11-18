'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { api, currentRefreshToken, hasStoredSession, onSessionChange, refreshSession, storeSession } from './api';
import type { AdminMe, AdminSession, LoginChallenge, Permission } from './types';

export const IDLE_LIMIT_MS = 30 * 60 * 1000;
const ACTIVITY_KEY = 'droblet-admin.activity';
const REASON_KEY = 'droblet-admin.reason';

export type LogoutReason = 'idle' | 'expired' | 'manual' | 'passwordChanged';
type Status = 'loading' | 'anonymous' | 'authenticated';

interface Auth {
  status: Status;
  me: AdminMe | null;
  login: (email: string, password: string) => Promise<LoginChallenge>;
  verify: (challengeId: string, code: string) => Promise<AdminMe>;
  logout: (reason?: LogoutReason) => Promise<void>;
  logoutAll: () => Promise<void>;
  /** Drops the local session without a server call (the server already ended it). */
  endLocal: (reason: LogoutReason) => void;
  can: (permission: Permission) => boolean;
  takeReason: () => LogoutReason | null;
}

const Ctx = createContext<Auth | null>(null);

// Survives client-side navigation between language trees (module state, never storage).
let cachedMe: AdminMe | null = null;

function storage(): Storage | null {
  try {
    return sessionStorage;
  } catch {
    return null;
  }
}

function touch() {
  storage()?.setItem(ACTIVITY_KEY, String(Date.now()));
}

function lastActivity(): number {
  const v = Number(storage()?.getItem(ACTIVITY_KEY) ?? 0);
  return Number.isFinite(v) ? v : 0;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<AdminMe | null>(cachedMe);
  const [status, setStatus] = useState<Status>(cachedMe ? 'authenticated' : 'loading');
  const explicit = useRef(false);

  const apply = useCallback((session: AdminSession | null) => {
    cachedMe = session?.admin ?? null;
    setMe(cachedMe);
    setStatus(cachedMe ? 'authenticated' : 'anonymous');
  }, []);

  useEffect(() => {
    const off = onSessionChange((session) => {
      if (!session && !explicit.current && cachedMe) storage()?.setItem(REASON_KEY, 'expired');
      apply(session);
    });
    if (!cachedMe) {
      if (hasStoredSession() && Date.now() - lastActivity() < IDLE_LIMIT_MS) {
        void refreshSession().then((s) => {
          if (!s) apply(null);
        });
      } else {
        if (hasStoredSession()) {
          storeSession(null);
          storage()?.setItem(REASON_KEY, 'idle');
        }
        apply(null);
      }
    }
    return () => {
      off();
    };
  }, [apply]);

  const logout = useCallback(async (reason: LogoutReason = 'manual') => {
    explicit.current = true;
    const refreshToken = currentRefreshToken();
    try {
      if (reason !== 'idle') await api.post('v1/admin/auth/logout', { refreshToken });
      else if (refreshToken) void api.post('v1/admin/auth/logout', { refreshToken }).catch(() => undefined);
    } catch {
      // the server session expires on its own
    }
    storage()?.setItem(REASON_KEY, reason);
    storeSession(null);
    explicit.current = false;
  }, []);

  // Idle logout after 30 minutes without input (also across a reload, via the stored activity time).
  useEffect(() => {
    if (status !== 'authenticated') return;
    touch();
    let last = Date.now();
    const onActivity = () => {
      const now = Date.now();
      if (now - last > 5000) {
        last = now;
        touch();
      }
    };
    const events = ['mousemove', 'mousedown', 'keydown', 'scroll', 'touchstart', 'wheel'] as const;
    events.forEach((e) => window.addEventListener(e, onActivity, { passive: true }));
    const timer = window.setInterval(() => {
      if (Date.now() - lastActivity() >= IDLE_LIMIT_MS) void logout('idle');
    }, 15_000);
    return () => {
      events.forEach((e) => window.removeEventListener(e, onActivity));
      window.clearInterval(timer);
    };
  }, [status, logout]);

  const value = useMemo<Auth>(
    () => ({
      status,
      me,
      login: (email, password) => api.post<LoginChallenge>('v1/admin/auth/login', { email, password }, { auth: false }),
      verify: async (challengeId, code) => {
        const session = await api.post<AdminSession>('v1/admin/auth/verify', { challengeId, code }, { auth: false });
        touch();
        storeSession(session);
        return session.admin;
      },
      logout,
      logoutAll: async () => {
        explicit.current = true;
        try {
          await api.post('v1/admin/auth/logout-all');
        } finally {
          storage()?.setItem(REASON_KEY, 'manual');
          storeSession(null);
          explicit.current = false;
        }
      },
      endLocal: (reason) => {
        explicit.current = true;
        storage()?.setItem(REASON_KEY, reason);
        storeSession(null);
        explicit.current = false;
      },
      can: (permission) => !!me?.permissions.includes(permission),
      takeReason: () => {
        const s = storage();
        const reason = s?.getItem(REASON_KEY) as LogoutReason | null;
        s?.removeItem(REASON_KEY);
        return reason;
      },
    }),
    [status, me, logout],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): Auth {
  const value = useContext(Ctx);
  if (!value) throw new Error('useAuth outside AuthProvider');
  return value;
}
