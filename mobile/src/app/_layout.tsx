import AsyncStorage from '@react-native-async-storage/async-storage';
import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister';
import { QueryClient } from '@tanstack/react-query';
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import { SplashScreen, Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';

import { ApiError } from '@/api/client';
import { isUnreachable, wireConnectivity } from '@/api/connectivity';
import { DesignProvider } from '@/design/DesignProvider';
import { SessionProvider, useSession } from '@/session/SessionProvider';
import { colors } from '@/theme';

SplashScreen.preventAutoHideAsync();

const CACHE_DAYS = 14;
const NOT_PERSISTED = new Set(['item-html']);

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60_000,
      gcTime: CACHE_DAYS * 86_400_000,
      retry: (failures, error) =>
        (isUnreachable(error) || !(error instanceof ApiError && error.status < 500)) && failures < 2,
    },
  },
});

const persistOptions = {
  persister: createAsyncStoragePersister({ storage: AsyncStorage, key: 'uni-query-cache' }),
  maxAge: CACHE_DAYS * 86_400_000,
  dehydrateOptions: {
    shouldDehydrateQuery: (query: { queryKey: readonly unknown[]; state: { status: string } }) =>
      query.state.status === 'success' && !NOT_PERSISTED.has(String(query.queryKey[0])),
  },
};

wireConnectivity();

export default function RootLayout() {
  return (
    <PersistQueryClientProvider client={queryClient} persistOptions={persistOptions}>
      <SessionProvider>
        <DesignProvider>
          <StatusBar style="dark" />
          <RootNavigator />
        </DesignProvider>
      </SessionProvider>
    </PersistQueryClientProvider>
  );
}

function RootNavigator() {
  const { token, isLoading } = useSession();

  useEffect(() => {
    if (!isLoading) {
      SplashScreen.hide();
    }
  }, [isLoading]);

  if (isLoading) {
    return null;
  }

  return (
    <Stack
      screenOptions={{
        headerShadowVisible: false,
        headerTintColor: colors.text,
        contentStyle: { backgroundColor: colors.background },
      }}
    >
      <Stack.Protected guard={!!token}>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="sources" options={{ title: 'Sources', presentation: 'modal' }} />
        <Stack.Screen name="course/[kind]/[id]" options={{ title: '' }} />
        <Stack.Screen name="assignment/[id]" options={{ title: '' }} />
        <Stack.Screen name="page/[kind]/[course]/[item]" options={{ title: '' }} />
        <Stack.Screen name="folder/[kind]/[course]/[item]" options={{ title: '' }} />
        <Stack.Screen name="connect/[kind]" options={{ title: '', presentation: 'modal' }} />
        <Stack.Screen name="subject/edit" options={{ title: 'Subject', presentation: 'modal' }} />
      </Stack.Protected>
      <Stack.Protected guard={!token}>
        <Stack.Screen name="sign-in" options={{ headerShown: false }} />
      </Stack.Protected>
    </Stack>
  );
}
