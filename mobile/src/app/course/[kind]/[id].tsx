import Ionicons from '@expo/vector-icons/Ionicons';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useMemo, useState } from 'react';
import { FlatList, Pressable, RefreshControl, ScrollView, SectionList, StyleSheet, Text, View } from 'react-native';

import { usePosts, useSections } from '@/api/queries';
import type { CourseItem, CourseRef, Post, SourceKind } from '@/api/types';
import { Attachments } from '@/components/Attachments';
import { EmptyState } from '@/components/EmptyState';
import { Loading } from '@/components/Loading';
import { Row, SectionHeader } from '@/components/Row';
import { Segmented } from '@/components/Segmented';
import { courseTitle, formatDateTime, plainText } from '@/format';
import { editSubject, refKey, useCourseIndex, useSubjectResolver } from '@/subjects';
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
  const resolve = useSubjectResolver();
  const index = useCourseIndex();
  const look = resolve(kind, id, name);
  const moodle = look.courses.filter((course) => course.source === 'moodle');
  const [tab, setTab] = useState<Tab>(moodle.length ? 'materials' : 'posts');
  const [picked, setPicked] = useState<string | null>(null);
  const shown = moodle.find((course) => course.course_id === picked) ?? moodle[0];

  return (
    <View style={styles.screen}>
      <Stack.Screen
        options={{
          title: look.name,
          headerRight: () => (
            <Pressable accessibilityLabel="Edit subject" hitSlop={12} onPress={() => editSubject(kind, id, name)}>
              <Ionicons name="color-palette-outline" size={22} color={colors.text} />
            </Pressable>
          ),
        }}
      />
      {moodle.length ? <Segmented options={TABS} value={tab} onChange={setTab} /> : null}
      {tab === 'materials' && moodle.length > 1 ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chips} contentContainerStyle={styles.chipRow}>
          {moodle.map((course) => {
            const selected = course === shown;
            return (
              <Pressable
                key={course.course_id}
                onPress={() => setPicked(course.course_id)}
                style={[styles.chip, selected && { backgroundColor: look.color ?? colors.text }]}
              >
                <Text style={[styles.chipLabel, selected && styles.chipSelected]} numberOfLines={1}>
                  {chipLabel(index.get(refKey('moodle', course.course_id))?.name ?? course.course_id)}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
      ) : null}
      {tab === 'materials' && shown ? (
        <Materials key={shown.course_id} kind="moodle" courseId={shown.course_id} />
      ) : (
        <Posts members={look.courses} />
      )}
    </View>
  );
}

function chipLabel(name: string) {
  const details = [...name.matchAll(/\(([^)]*)\)/g)].map((match) => match[1]).filter((part) => !/\d{4}/.test(part));
  return details[0] ?? courseTitle(name);
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
          courseId={courseId}
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
  courseId: string;
  expanded: boolean;
  onToggle: () => void;
};

function MaterialRow({ item, kind, courseId, expanded, onToggle }: MaterialProps) {
  const body = plainText(item.html);
  if (item.kind === 'label') {
    return <Text style={styles.label}>{body}</Text>;
  }
  const inline = item.kind === 'file' || item.kind === 'folder';
  const openPage = () =>
    router.push({ pathname: '/page/[kind]/[course]/[item]', params: { kind, course: courseId, item: item.id } });
  const openUrl = item.url ? () => WebBrowser.openBrowserAsync(item.url!) : undefined;
  const onPress = item.kind === 'page' ? openPage : inline ? onToggle : openUrl;
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
          {!body && item.attachments.length === 0 ? <Text style={text.caption}>Empty</Text> : null}
        </View>
      ) : null}
    </Row>
  );
}

function Posts({ members }: { members: CourseRef[] }) {
  const posts = usePosts();
  const items = useMemo(() => {
    const keys = new Set(members.map((member) => refKey(member.source, member.course_id)));
    return (posts.data?.items ?? [])
      .filter((post) => keys.has(refKey(post.source, post.course_id)))
      .sort((a, b) => b.posted_at.localeCompare(a.posted_at));
  }, [posts.data, members]);

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
  chips: { flexGrow: 0 },
  chipRow: { paddingHorizontal: spacing.md, paddingBottom: spacing.sm, gap: spacing.sm },
  chip: {
    maxWidth: 220,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs + 2,
    borderRadius: 16,
    backgroundColor: colors.surface,
  },
  chipLabel: { fontSize: 14, color: colors.text },
  chipSelected: { color: '#FFFFFF', fontWeight: '600' },
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
