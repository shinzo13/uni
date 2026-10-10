import { router } from 'expo-router';
import { useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { ApiError } from '@/api/client';
import { useSourceActions, useSources } from '@/api/queries';
import type { SourceKind, SourceStatus } from '@/api/types';
import { Loading } from '@/components/Loading';
import { CourseLayoutOptions, CourseListLayoutOptions } from '@/design/LayoutPicker';
import { formatShortDate } from '@/format';
import { useSession } from '@/session/SessionProvider';
import { colors, sourceNames, spacing, text } from '@/theme';

const DESCRIPTIONS: Record<SourceKind, string> = {
  usos: 'Timetable, exams, grades and tests',
  moodle: 'Assignments, quizzes, materials and announcements',
  teams: 'Assignments and channel posts',
};
export default function SourcesScreen() {
  const { signOut } = useSession();
  const { data, isLoading } = useSources();
  const actions = useSourceActions();
  const [busy, setBusy] = useState<SourceKind | null>(null);
  const connect = async (kind: SourceKind) => {
    setBusy(kind);
    try {
      const start = await actions.start(kind);
      router.push({
        pathname: '/connect/[kind]',
        params: { kind, url: start.url, ...(start.user_code ? { code: start.user_code } : {}) },
      });
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
      <Text style={[text.title, styles.heading]}>Appearance</Text>
      <CourseListLayoutOptions />
      <CourseLayoutOptions />
      <Pressable
        onPress={() =>
          Alert.alert('Sign out?', 'Your sources stay connected to your account.', [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Sign out', style: 'destructive', onPress: signOut },
          ])
        }
        style={styles.signOut}
      >
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
  heading: { marginTop: spacing.md },
  signOut: { alignItems: 'center', padding: spacing.md },
});
