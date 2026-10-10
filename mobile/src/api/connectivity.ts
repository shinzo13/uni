import NetInfo from '@react-native-community/netinfo';
import { focusManager, onlineManager, type QueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { AppState } from 'react-native';

import { ApiError } from '@/api/client';

export type Connectivity = 'online' | 'offline' | 'unreachable';

export function wireConnectivity() {
  onlineManager.setEventListener((setOnline) =>
    NetInfo.addEventListener((state) => setOnline(state.isConnected !== false)),
  );
  const subscription = AppState.addEventListener('change', (status) => focusManager.setFocused(status === 'active'));
  return () => subscription.remove();
}

export function isUnreachable(error: unknown) {
  return error instanceof ApiError && error.status === 0;
}

export function useConnectivity(queryClient: QueryClient): Connectivity {
  const [online, setOnline] = useState(onlineManager.isOnline());
  const [unreachable, setUnreachable] = useState(false);

  useEffect(() => onlineManager.subscribe(setOnline), []);

  useEffect(
    () =>
      queryClient.getQueryCache().subscribe((event) => {
        if (event.type !== 'updated' || event.action.type === 'fetch') {
          return;
        }
        if (event.action.type === 'error') {
          setUnreachable(isUnreachable(event.action.error));
        } else if (event.action.type === 'success') {
          setUnreachable(false);
        }
      }),
    [queryClient],
  );

  if (!online) {
    return 'offline';
  }
  return unreachable ? 'unreachable' : 'online';
}
