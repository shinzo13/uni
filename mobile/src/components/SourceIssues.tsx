import { Link } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';

import type { SourceState } from '@/api/types';
import { colors, sourceNames, spacing, text } from '@/theme';

type Props = {
  sources: SourceState[] | undefined;
};

export function SourceIssues({ sources }: Props) {
  if (!sources) {
    return null;
  }
  const failing = sources.filter((source) => source.error);
  if (sources.length > 0 && failing.length === 0) {
    return null;
  }
  const message =
    sources.length === 0
      ? 'No sources connected yet.'
      : failing.map((source) => `${sourceNames[source.kind]}: ${source.error}`).join(' · ');
  return (
    <View style={styles.banner}>
      <Text style={styles.message}>{message}</Text>
      <Link href="/sources" style={styles.link}>
        Manage sources
      </Link>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    margin: spacing.md,
    marginBottom: 0,
    padding: spacing.md,
    borderRadius: 12,
    backgroundColor: colors.surface,
    gap: spacing.xs,
  },
  message: text.body,
  link: { ...text.body, fontWeight: '600' },
});
