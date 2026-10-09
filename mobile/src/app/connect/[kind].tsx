import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, StyleSheet, Text, View } from 'react-native';
import { WebView, type WebViewNavigation } from 'react-native-webview';

import { ApiError } from '@/api/client';
import { useSourceActions } from '@/api/queries';
import type { SourceKind } from '@/api/types';
import { colors, sourceNames, spacing, text } from '@/theme';

const TEAMS_POLL_MS = 4000;
const MOODLE_REDIRECT = /^[a-z][a-z0-9+.-]*:\/\/token=/i;
const USOS_REDIRECT = /^uni:\/\/sources\/usos/i;

export default function ConnectScreen() {
  const { kind, url, code } = useLocalSearchParams<{ kind: SourceKind; url: string; code?: string }>();
  const actions = useSourceActions();
  const [finishing, setFinishing] = useState(false);
  const done = useRef(false);

  const finish = async (complete: () => Promise<unknown>) => {
    if (done.current) {
      return;
    }
    done.current = true;
    setFinishing(true);
    try {
      await complete();
      router.back();
    } catch (error) {
      Alert.alert(`${sourceNames[kind]} was not connected`, error instanceof ApiError ? error.message : String(error));
      router.back();
    }
  };

  const { pollTeams } = actions;
  useEffect(() => {
    if (kind !== 'teams') {
      return;
    }
    const timer = setInterval(async () => {
      try {
        if (!done.current && (await pollTeams())) {
          done.current = true;
          router.back();
        }
      } catch {
        clearInterval(timer);
      }
    }, TEAMS_POLL_MS);
    return () => clearInterval(timer);
  }, [kind, pollTeams]);

  const intercept = (request: WebViewNavigation) => {
    if (kind === 'moodle' && MOODLE_REDIRECT.test(request.url)) {
      finish(() => actions.completeMoodle(request.url));
      return false;
    }
    if (kind === 'usos' && USOS_REDIRECT.test(request.url)) {
      finish(actions.refresh);
      return false;
    }
    return /^(https?|about|data|blob):/i.test(request.url);
  };

  return (
    <View style={styles.screen}>
      <Stack.Screen options={{ title: `Connect ${sourceNames[kind]}` }} />
      {code ? (
        <View style={styles.banner}>
          <Text style={text.caption}>Sign-in code, filled in automatically</Text>
          <Text selectable style={styles.code}>
            {code}
          </Text>
        </View>
      ) : null}
      {finishing ? (
        <View style={styles.center}>
          <ActivityIndicator />
        </View>
      ) : (
        <WebView
          source={{ uri: url }}
          style={styles.web}
          originWhitelist={['*']}
          onShouldStartLoadWithRequest={intercept}
          injectedJavaScript={code ? fillCode(code) : undefined}
          sharedCookiesEnabled
          startInLoadingState
        />
      )}
    </View>
  );
}

function fillCode(code: string) {
  return `(function () {
    var input = document.querySelector('input[name="otc"]');
    if (!input || input.value) return;
    var setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(input, ${JSON.stringify(code)});
    input.dispatchEvent(new Event('input', { bubbles: true }));
    var next = document.querySelector('input[type="submit"], button[type="submit"]');
    if (next) next.click();
  })();
  true;`;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  banner: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: colors.surface,
    alignItems: 'center',
  },
  code: { fontSize: 22, fontWeight: '700', letterSpacing: 3, color: colors.text },
  web: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});
