import * as WebBrowser from 'expo-web-browser';
import { useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { ApiError } from '@/api/client';
import { useSourceActions, useSources } from '@/api/queries';
import type { SourceKind, SourceStatus } from '@/api/types';
import { Loading } from '@/components/Loading';
import { formatShortDate } from '@/format';
import { useSession } from '@/session/SessionProvider';
import { colors, sourceNames, spacing, text } from '@/theme';

const DESCRIPTIONS: Record<SourceKind, string> = {
  usos: 'Timetable, exams, grades and tests',
  moodle: 'Assignments, quizzes, materials and announcements',
  teams: 'Assignments and channel posts',
};
const TEAMS_POLL_MS = 5000;
const TEAMS_TIMEOUT_MS = 15 * 60_000;

type TeamsLogin = { code: string; url: string };

export default function SourcesScreen() {
  const { signOut } = useSession();
  const { data, isLoading } = useSources();
  const actions = useSourceActions();
  const [busy, setBusy] = useState<SourceKind | null>(null);
  const [teams, setTeams] = useState<TeamsLogin | null>(null);
  const { pollTeams } = actions;

  useEffect(() => {
    if (!teams) {
      return;
    }
    const startedAt = Date.now();
    const timer = setInterval(async () => {
      try {
        if (await pollTeams()) {
          setTeams(null);
          WebBrowser.dismissBrowser();
        } else if (Date.now() - startedAt > TEAMS_TIMEOUT_MS) {
          setTeams(null);
        }
      } catch {
        setTeams(null);
      }
    }, TEAMS_POLL_MS);
    return () => clearInterval(timer);
  }, [teams, pollTeams]);

  const connect = async (kind: SourceKind) => {
    setBusy(kind);
    try {
      const start = await actions.start(kind);
      if (kind === 'teams' && start.user_code) {
        setTeams({ code: start.user_code, url: start.url });
        await WebBrowser.openBrowserAsync(start.url);
        return;
      }
      const result = await WebBrowser.openAuthSessionAsync(start.url, kind === 'usos' ? 'uni://sources/usos' : 'uni://');
      if (result.type !== 'success') {
        return;
      }
      if (kind === 'moodle') {
        await actions.completeMoodle(result.url);
      } else {
        await actions.refresh();
      }
    } catch (error) {
      Alert.alert(`${sourceNames[kind]} was not connected`, error instanceof ApiError ? error.message : String(error));
    } finally {
      setBusy(null);
    }
  };

  const disconnect = (kind: SourceKind) =>
    Alert.alert(`Disconnect ${sourceNames[kind]}?`, 'Its data will disappear from the app.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Disconnect', style: 'destructive', onPress: () => actions.unlink.mutate(kind) },
    ]);

  if (isLoading || !data) {
    return <Loading />;
  }

  return (
    <ScrollView contentContainerStyle={styles.container}>
      {data.map((source) => (
        <SourceCard
          key={source.kind}
          source={source}
          busy={busy === source.kind}
          onConnect={() => connect(source.kind)}
          onDisconnect={() => disconnect(source.kind)}
        />
      ))}
      {teams ? (
        <View style={styles.card}>
          <Text style={text.title}>Teams sign-in code</Text>
          <Text selectable style={styles.code}>
            {teams.code}
          </Text>
          <Text style={text.caption}>
            Enter this code on the Microsoft page and sign in with your university account. This screen updates by
            itself.
          </Text>
          <Pressable onPress={() => WebBrowser.openBrowserAsync(teams.url)}>
            <Text style={styles.action}>Open sign-in page</Text>
          </Pressable>
        </View>
      ) : null}
      <Pressable onPress={signOut} style={styles.signOut}>
        <Text style={[styles.action, { color: colors.danger }]}>Sign out</Text>
      </Pressable>
    </ScrollView>
  );
}

type CardProps = {
  source: SourceStatus;
  busy: boolean;
  onConnect: () => void;
  onDisconnect: () => void;
};

function SourceCard({ source, busy, onConnect, onDisconnect }: CardProps) {
  const status = !source.linked
    ? 'Not connected'
    : source.expired
      ? 'Sign-in expired'
      : `Connected${source.linked_at ? ` on ${formatShortDate(source.linked_at)}` : ''}`;
  return (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <Text style={text.title}>{sourceNames[source.kind]}</Text>
        <Text style={[text.caption, source.expired && { color: colors.danger }]}>{status}</Text>
      </View>
      <Text style={text.caption}>{DESCRIPTIONS[source.kind]}</Text>
      <View style={styles.actions}>
        {!source.linked || source.expired ? (
          <Pressable disabled={busy} onPress={onConnect}>
            <Text style={[styles.action, busy && { opacity: 0.4 }]}>{source.expired ? 'Reconnect' : 'Connect'}</Text>
          </Pressable>
        ) : null}
        {source.linked ? (
          <Pressable onPress={onDisconnect}>
            <Text style={[styles.action, { color: colors.muted }]}>Disconnect</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { padding: spacing.md, gap: spacing.md },
  card: { padding: spacing.md, borderRadius: 12, backgroundColor: colors.surface, gap: spacing.xs },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  actions: { flexDirection: 'row', gap: spacing.lg, marginTop: spacing.sm },
  action: { ...text.body, fontWeight: '600' },
  code: { fontSize: 28, fontWeight: '700', letterSpacing: 4, color: colors.text, marginVertical: spacing.sm },
  signOut: { alignItems: 'center', padding: spacing.md },
});
