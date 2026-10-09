import type { PropsWithChildren, ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, spacing, text } from '@/theme';

type Props = PropsWithChildren<{
  title: string;
  subtitle?: string | null;
  detail?: ReactNode;
  leading?: ReactNode;
  onPress?: () => void;
  onLongPress?: () => void;
  muted?: boolean;
}>;

export function Row({ title, subtitle, detail, leading, onPress, onLongPress, muted, children }: Props) {
  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      disabled={!onPress && !onLongPress}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
    >
      {leading}
      <View style={styles.main}>
        <Text style={[text.body, muted && styles.mutedText]} numberOfLines={2}>
          {title}
        </Text>
        {subtitle ? (
          <Text style={text.caption} numberOfLines={2}>
            {subtitle}
          </Text>
        ) : null}
        {children}
      </View>
      {typeof detail === 'string' ? <Text style={styles.detail}>{detail}</Text> : detail}
    </Pressable>
  );
}

export function SectionHeader({ title }: { title: string }) {
  return <Text style={styles.header}>{title}</Text>;
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md - 4,
    backgroundColor: colors.background,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  pressed: { backgroundColor: colors.surface },
  main: { flex: 1, gap: 2 },
  mutedText: { color: colors.muted },
  detail: { ...text.caption, color: colors.text, fontVariant: ['tabular-nums'] },
  header: {
    ...text.section,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.lg,
    paddingBottom: spacing.sm,
    backgroundColor: colors.background,
  },
});
