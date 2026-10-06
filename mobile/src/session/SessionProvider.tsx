import { useQueryClient } from '@tanstack/react-query';
import { createContext, type PropsWithChildren, use, useCallback, useEffect, useMemo, useState } from 'react';

import { request } from '@/api/client';
import { readItem, writeItem } from '@/session/storage';

const TOKEN_KEY = 'session-token';

type Session = {
  token: string | null;
  isLoading: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
};

const SessionContext = createContext<Session | null>(null);

export function useSession() {
  const session = use(SessionContext);
  if (!session) {
    throw new Error('useSession must be used inside SessionProvider');
  }
  return session;
}

export function SessionProvider({ children }: PropsWithChildren) {
  const queryClient = useQueryClient();
  const [token, setToken] = useState<string | null>(null);
  const [isLoading, setLoading] = useState(true);

  useEffect(() => {
    readItem(TOKEN_KEY)
      .then(setToken)
      .finally(() => setLoading(false));
  }, []);

  const store = useCallback(async (value: string | null) => {
    await writeItem(TOKEN_KEY, value);
    setToken(value);
  }, []);

  const authenticate = useCallback(
    async (path: string, email: string, password: string) => {
      const { token: issued } = await request<{ token: string }>(path, {
        method: 'POST',
        body: { email, password },
      });
      await store(issued);
    },
    [store],
  );

  const signOut = useCallback(async () => {
    await request('/auth/logout', { method: 'POST', token }).catch(() => undefined);
    queryClient.clear();
    await store(null);
  }, [queryClient, store, token]);

  const value = useMemo<Session>(
    () => ({
      token,
      isLoading,
      signIn: (email, password) => authenticate('/auth/login', email, password),
      signUp: (email, password) => authenticate('/auth/register', email, password),
      signOut,
    }),
    [authenticate, isLoading, signOut, token],
  );

  return <SessionContext value={value}>{children}</SessionContext>;
}
