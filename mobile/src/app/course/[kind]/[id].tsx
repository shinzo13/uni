import { Stack, useLocalSearchParams } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useMemo, useState } from 'react';
import { FlatList, RefreshControl, SectionList, StyleSheet, Text, View } from 'react-native';

import { usePosts, useSections } from '@/api/queries';
import type { CourseItem, Post, SourceKind } from '@/api/types';
import { Attachments } from '@/components/Attachments';
import { EmptyState } from '@/components/EmptyState';
import { Loading } from '@/components/Loading';
import { Row, SectionHeader } from '@/components/Row';
import { Segmented } from '@/components/Segmented';
import { formatDateTime, plainText } from '@/format';
import { colors, spacing, text } from '@/theme';

type Tab = 'materials' | 'posts';

const TABS = [
  { value: 'materials', label: 'Materials' },
  { value: 'posts', label: 'Posts' },
] as const;
const ITEM_LABELS: Record<CourseItem['kind'], string> = {
  page: 'Page',
  file: 'File',
  folder: 'Folder',
  link: 'Link',
  label: '',
  assignment: 'Assignment',
  quiz: 'Quiz',
  forum: 'Forum',
  other: '',
};

export default function CourseScreen() {
  const { kind, id, name } = useLocalSearchParams<{ kind: SourceKind; id: string; name?: string }>();
  const hasMaterials = kind === 'moodle';
  const [tab, setTab] = useState<Tab>(hasMaterials ? 'materials' : 'posts');

  return (
    <View style={styles.screen}>
      <Stack.Screen options={{ title: name ?? '' }} />
      {hasMaterials ? <Segmented options={TABS} value={tab} onChange={setTab} /> : null}
      {tab === 'materials' ? <Materials kind={kind} courseId={id} /> : <Posts courseId={id} />}
    </View>
  );
}

function Materials({ kind, courseId }: { kind: SourceKind; courseId: string }) {
  const sections = useSections(kind, courseId);
  const [expanded, setExpanded] = useState<string | null>(null);
  const data = useMemo(
    () =>
      (sections.data?.items ?? [])
        .map((section) => ({ title: section.title, data: section.items.filter((item) => item.kind !== 'label' || item.html) }))
        .filter((section) => section.data.length > 0),
    [sections.data],
  );

  if (sections.isLoading) {
    return <Loading />;
  }

  return (
    <SectionList
      sections={data}
      keyExtractor={(item) => item.id}
      stickySectionHeadersEnabled={false}
      refreshControl={
        <RefreshControl refreshing={sections.refreshing} onRefresh={() => sections.refresh().catch(() => undefined)} />
      }
      renderSectionHeader={({ section }) => <SectionHeader title={section.title} />}
      renderItem={({ item }) => (
        <MaterialRow
          item={item}
          kind={kind}
          expanded={expanded === item.id}
          onToggle={() => setExpanded(expanded === item.id ? null : item.id)}
        />
      )}
      ListEmptyComponent={<EmptyState title="No materials" />}
    />
  );
}

type MaterialProps = {
  item: CourseItem;
  kind: SourceKind;
  expanded: boolean;
  onToggle: () => void;
};

function MaterialRow({ item, kind, expanded, onToggle }: MaterialProps) {
  const body = plainText(item.html);
  if (item.kind === 'label') {
    return <Text style={styles.label}>{body}</Text>;
  }
  const inline = item.kind === 'page' || item.kind === 'file' || item.kind === 'folder';
  const onPress = inline ? onToggle : item.url ? () => WebBrowser.openBrowserAsync(item.url!) : undefined;
  return (
    <Row title={item.title} subtitle={ITEM_LABELS[item.kind]} onPress={onPress}>
      {expanded ? (
        <View style={styles.expanded}>
          {body ? (
            <Text selectable style={text.body}>
              {body}
            </Text>
          ) : null}
          <Attachments source={kind} attachments={item.attachments} />
        </View>
      ) : null}
    </Row>
  );
}

function Posts({ courseId }: { courseId: string }) {
  const posts = usePosts();
  const items = useMemo(() => (posts.data?.items ?? []).filter((post) => post.course_id === courseId), [posts.data, courseId]);

  if (posts.isLoading) {
    return <Loading />;
  }

  return (
    <FlatList
      data={items}
      keyExtractor={(post) => `${post.source}-${post.id}`}
      refreshControl={
        <RefreshControl refreshing={posts.refreshing} onRefresh={() => posts.refresh().catch(() => undefined)} />
      }
      renderItem={({ item }) => <PostCard post={item} />}
      ListEmptyComponent={<EmptyState title="No posts" />}
    />
  );
}

function PostCard({ post }: { post: Post }) {
  return (
    <View style={styles.post}>
      <Text style={text.caption}>
        {[post.author, formatDateTime(post.posted_at)].filter(Boolean).join(' · ')}
      </Text>
      {post.title ? <Text style={text.title}>{post.title}</Text> : null}
      <Text selectable style={text.body}>
        {plainText(post.body_html)}
      </Text>
      <Attachments source={post.source} attachments={post.attachments} />
      {post.replies.map((reply) => (
        <View key={reply.id} style={styles.reply}>
          <Text style={text.caption}>{[reply.author, formatDateTime(reply.posted_at)].filter(Boolean).join(' · ')}</Text>
          <Text selectable style={text.body}>
            {plainText(reply.body_html)}
          </Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  expanded: { marginTop: spacing.sm, gap: spacing.sm },
  label: { ...text.body, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, color: colors.muted },
  post: {
    padding: spacing.md,
    gap: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  reply: { marginLeft: spacing.md, paddingLeft: spacing.md, borderLeftWidth: 2, borderLeftColor: colors.border, gap: 2 },
});
