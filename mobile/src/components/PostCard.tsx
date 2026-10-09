import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { Post } from '@/api/types';
import { Attachments } from '@/components/Attachments';
import { LinkedText } from '@/components/LinkedText';
import { formatDateTime, plainText } from '@/format';
import { colors, radii, sourceNames, spacing, tinted, type } from '@/theme';

const COLLAPSED_LENGTH = 420;

type Props = {
  post: Post;
  tint: string;
  compact?: boolean;
};

export function PostCard({ post, tint, compact }: Props) {
  const long = plainText(post.body_html).length > COLLAPSED_LENGTH;
  const [open, setOpen] = useState(!long || !compact);
  const initials = (post.author ?? sourceNames[post.source])
    .split(/\s+/)
    .map((word) => word[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <View style={[styles.avatar, { backgroundColor: tinted(tint, 0.16) }]}>
          <Text style={[styles.initials, { color: tint }]}>{initials}</Text>
        </View>
        <View style={styles.headerText}>
          <Text style={type.title} numberOfLines={1}>
            {post.author ?? sourceNames[post.source]}
          </Text>
          <Text style={type.caption}>
            {sourceNames[post.source]} · {formatDateTime(post.posted_at)}
          </Text>
        </View>
      </View>
      {post.title ? <Text style={type.titleLarge}>{post.title}</Text> : null}
      <View style={!open && styles.clamped}>
        <LinkedText html={post.body_html} />
      </View>
      {long && compact ? (
        <Pressable onPress={() => setOpen(!open)} hitSlop={8}>
          <Text style={[styles.more, { color: tint }]}>{open ? 'Show less' : 'Show more'}</Text>
        </Pressable>
      ) : null}
      <Attachments source={post.source} attachments={post.attachments} />
      {post.replies.map((reply) => (
        <View key={reply.id} style={styles.reply}>
          <Text style={type.caption}>{[reply.author, formatDateTime(reply.posted_at)].filter(Boolean).join(' · ')}</Text>
          <LinkedText html={reply.body_html} />
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    marginHorizontal: spacing.md,
    marginBottom: spacing.md,
    padding: spacing.md,
    gap: spacing.sm,
    borderRadius: radii.lg,
    backgroundColor: colors.surface,
  },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm + 2 },
  avatar: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  initials: { fontSize: 13, fontWeight: '700' },
  headerText: { flex: 1 },
  clamped: { maxHeight: 132, overflow: 'hidden' },
  more: { ...type.label, fontSize: 13 },
  reply: {
    marginLeft: spacing.sm,
    paddingLeft: spacing.md,
    borderLeftWidth: 2,
    borderLeftColor: colors.border,
    gap: 2,
  },
});
