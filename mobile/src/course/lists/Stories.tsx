import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { router } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Animated,
  Easing,
  type GestureResponderEvent,
  Modal,
  PanResponder,
  Pressable,
  RefreshControl,
  ScrollView,
  SectionList,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { Assignment, Post } from '@/api/types';
import { EmptyState } from '@/components/EmptyState';
import { SectionHeader } from '@/components/Row';
import { SubjectIcon } from '@/components/SubjectIcon';
import {
  type CourseEntry,
  type CourseListProps,
  editEntry,
  entryCaption,
  entryKey,
  openEntry,
  type Update,
} from '@/course/list';
import { formatDateTime, formatTime, plainText, relativeDue } from '@/format';
import { colors, radii, spacing, tinted, type } from '@/theme';
import { useNow } from '@/useNow';

const STORY_MS = 6000;
const CIRCLE = 64;
const STAGE = '#0E0E12';
const WEEKDAY = new Intl.DateTimeFormat('en-GB', { weekday: 'short' });

const STATUS_LABELS: Record<Assignment['status'], string> = {
  new: 'Not submitted',
  draft: 'Draft',
  submitted: 'Submitted',
  graded: 'Graded',
  unknown: 'Status unknown',
};

type Cursor = { key: string; index: number };

export function StoriesLayout({ sections, refreshing, onRefresh }: CourseListProps) {
  const now = useNow();
  const [seen, setSeen] = useState<ReadonlySet<string>>(() => new Set());
  const [cursor, setCursor] = useState<Cursor | null>(null);

  const stories = useMemo(() => {
    const unique = new Map<string, CourseEntry>();
    for (const section of sections) {
      for (const entry of section.data) {
        if (entry.updates.length && !unique.has(entryKey(entry))) {
          unique.set(entryKey(entry), entry);
        }
      }
    }
    return [...unique.values()].sort((a, b) => b.updates[0].at.localeCompare(a.updates[0].at));
  }, [sections]);

  const show = useCallback((next: Cursor | null) => {
    setCursor(next);
    if (next) {
      setSeen((current) => (current.has(next.key) ? current : new Set(current).add(next.key)));
    }
  }, []);

  const header = (
    <View style={styles.storiesBlock}>
      <Text style={styles.blockLabel}>UPDATES</Text>
      {stories.length ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.storyRow}>
          {stories.map((entry) => (
            <StoryCircle
              key={entryKey(entry)}
              entry={entry}
              seen={seen.has(entryKey(entry))}
              onPress={() => show({ key: entryKey(entry), index: 0 })}
              onLongPress={() => editEntry(entry)}
            />
          ))}
        </ScrollView>
      ) : (
        <View style={styles.noUpdates}>
          <MaterialCommunityIcons name="check-circle-outline" size={16} color={colors.muted} />
          <Text style={styles.noUpdatesText}>No new updates</Text>
        </View>
      )}
    </View>
  );

  return (
    <>
      <SectionList
        sections={sections}
        keyExtractor={entryKey}
        stickySectionHeadersEnabled={false}
        style={styles.list}
        contentContainerStyle={styles.listContent}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        ListHeaderComponent={header}
        renderSectionHeader={({ section }) => <SectionHeader title={section.title} />}
        renderItem={({ item }) => <CourseRow entry={item} now={now} />}
        ListEmptyComponent={
          <EmptyState title="No courses yet" hint="Connect Moodle or Teams in sources and your courses appear here." />
        }
      />
      <StoryViewer stories={stories} cursor={cursor} now={now} onShow={show} />
    </>
  );
}

function StoryCircle({
  entry,
  seen,
  onPress,
  onLongPress,
}: {
  entry: CourseEntry;
  seen: boolean;
  onPress: () => void;
  onLongPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      style={({ pressed }) => [styles.story, pressed && styles.storyPressed]}
      accessibilityRole="button"
      accessibilityLabel={`${entry.look.name}, ${entry.updates.length} updates`}
    >
      <View style={[styles.ring, { borderColor: seen ? colors.border : entry.look.tint }]}>
        <View style={styles.ringInner}>
          <SubjectIcon icon={entry.look.glyph} color={entry.look.tint} size={CIRCLE - 12} />
        </View>
      </View>
      <Text style={[styles.storyName, seen && styles.storyNameSeen]} numberOfLines={1}>
        {entry.look.name}
      </Text>
    </Pressable>
  );
}

function CourseRow({ entry, now }: { entry: CourseEntry; now: number }) {
  const count = entry.updates.length;
  return (
    <Pressable
      onPress={() => openEntry(entry)}
      onLongPress={() => editEntry(entry)}
      style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
    >
      <SubjectIcon icon={entry.look.glyph} color={entry.look.tint} size={40} />
      <View style={styles.rowMain}>
        <Text style={styles.rowTitle} numberOfLines={2}>
          {entry.look.name}
        </Text>
        <Text style={type.caption} numberOfLines={1}>
          {entryCaption(entry)}
        </Text>
      </View>
      {count ? (
        <View style={[styles.badge, { backgroundColor: tinted(entry.look.tint, 0.14) }]}>
          <Text style={[styles.badgeText, { color: entry.look.tint }]}>{count > 99 ? '99+' : count}</Text>
        </View>
      ) : entry.nextClass ? (
        <Text style={styles.nextClass}>{classTime(entry.nextClass.starts_at, now)}</Text>
      ) : null}
    </Pressable>
  );
}

function StoryViewer({
  stories,
  cursor,
  now,
  onShow,
}: {
  stories: CourseEntry[];
  cursor: Cursor | null;
  now: number;
  onShow: (cursor: Cursor | null) => void;
}) {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const [progress] = useState(() => new Animated.Value(0));
  const [drag] = useState(() => new Animated.Value(0));

  const position = cursor ? stories.findIndex((entry) => entryKey(entry) === cursor.key) : -1;
  const entry = position >= 0 ? stories[position] : null;
  const index = entry && cursor ? Math.min(cursor.index, entry.updates.length - 1) : 0;
  const update = entry ? entry.updates[index] : null;

  const close = useCallback(() => onShow(null), [onShow]);

  const next = useCallback(() => {
    if (!entry) {
      return;
    }
    if (index + 1 < entry.updates.length) {
      onShow({ key: entryKey(entry), index: index + 1 });
      return;
    }
    const following = stories[position + 1];
    onShow(following ? { key: entryKey(following), index: 0 } : null);
  }, [entry, index, onShow, position, stories]);

  const run = useCallback(
    (from: number) => {
      progress.setValue(from);
      Animated.timing(progress, {
        toValue: 1,
        duration: STORY_MS * (1 - from),
        easing: Easing.linear,
        useNativeDriver: false,
      }).start(({ finished }) => {
        if (finished) {
          next();
        }
      });
    },
    [next, progress],
  );

  const previous = useCallback(() => {
    if (!entry) {
      return;
    }
    if (index > 0) {
      onShow({ key: entryKey(entry), index: index - 1 });
      return;
    }
    const preceding = stories[position - 1];
    if (preceding) {
      onShow({ key: entryKey(preceding), index: preceding.updates.length - 1 });
      return;
    }
    progress.stopAnimation();
    run(0);
  }, [entry, index, onShow, position, progress, run, stories]);

  const pause = useCallback(() => progress.stopAnimation(), [progress]);
  const resume = useCallback(() => progress.stopAnimation((value) => run(value)), [progress, run]);

  const updateId = update ? updateKey(update) : null;

  useEffect(() => {
    progress.setValue(0);
  }, [updateId, progress]);

  useEffect(() => {
    if (!updateId) {
      return;
    }
    resume();
    return () => progress.stopAnimation();
  }, [updateId, resume, progress]);

  const responder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponderCapture: (_, gesture) => gesture.dy > 12 && gesture.dy > Math.abs(gesture.dx) * 1.5,
        onPanResponderGrant: pause,
        onPanResponderMove: (_, gesture) => drag.setValue(Math.max(0, gesture.dy)),
        onPanResponderRelease: (_, gesture) => {
          if (gesture.dy > 120 || gesture.vy > 1) {
            drag.setValue(0);
            close();
            return;
          }
          Animated.timing(drag, {
            toValue: 0,
            duration: 180,
            useNativeDriver: true,
          }).start();
          resume();
        },
        onPanResponderTerminate: () => {
          Animated.timing(drag, {
            toValue: 0,
            duration: 180,
            useNativeDriver: true,
          }).start();
          resume();
        },
      }),
    [close, drag, pause, resume],
  );

  const onTap = (event: GestureResponderEvent) => {
    if (event.nativeEvent.pageX > width / 2) {
      next();
    } else {
      previous();
    }
  };

  const openUpdate = () => {
    if (!entry || !update) {
      return;
    }
    close();
    if (update.kind === 'assignment') {
      router.push({
        pathname: '/assignment/[id]',
        params: { id: update.assignment.id, source: update.assignment.source },
      });
    } else {
      openEntry(entry);
    }
  };

  const tint = entry?.look.tint ?? colors.muted;

  return (
    <Modal visible={!!update} animationType="fade" onRequestClose={close} statusBarTranslucent transparent>
      {entry && update ? (
        <Animated.View style={[styles.stage, { transform: [{ translateY: drag }] }]} {...responder.panHandlers}>
          <View style={[styles.stageTint, { backgroundColor: tinted(tint, 0.22), paddingTop: insets.top }]}>
            <View style={styles.segments}>
              {entry.updates.map((item, position) => (
                <View key={updateKey(item)} style={styles.segment}>
                  <Animated.View
                    style={[
                      styles.segmentFill,
                      position < index && styles.segmentFull,
                      position === index && {
                        width: progress.interpolate({
                          inputRange: [0, 1],
                          outputRange: ['0%', '100%'],
                        }),
                      },
                      position > index && styles.segmentEmpty,
                    ]}
                  />
                </View>
              ))}
            </View>
            <View style={styles.viewerHeader}>
              <SubjectIcon icon={entry.look.glyph} color={tint} size={40} />
              <View style={styles.viewerHeading}>
                <Text style={styles.viewerTitle} numberOfLines={1}>
                  {entry.look.name}
                </Text>
                <Text style={styles.viewerMeta} numberOfLines={1}>
                  {`${index + 1} of ${entry.updates.length} · ${ago(update.at, now)}`}
                </Text>
              </View>
              <Pressable
                onPress={close}
                hitSlop={8}
                style={({ pressed }) => [styles.closeButton, pressed && styles.closePressed]}
                accessibilityRole="button"
                accessibilityLabel="Close"
              >
                <MaterialCommunityIcons name="close" size={24} color="#FFFFFF" />
              </Pressable>
            </View>
          </View>
          <Pressable
            style={[styles.tapArea, { paddingBottom: insets.bottom + spacing.lg }]}
            onPress={onTap}
            onPressIn={pause}
            onPressOut={resume}
            onLongPress={() => undefined}
            delayLongPress={300}
          >
            {update.kind === 'post' ? (
              <PostStory post={update.post} tint={tint} onOpen={openUpdate} />
            ) : (
              <AssignmentStory assignment={update.assignment} tint={tint} now={now} onOpen={openUpdate} />
            )}
          </Pressable>
        </Animated.View>
      ) : null}
    </Modal>
  );
}

function PostStory({ post, tint, onOpen }: { post: Post; tint: string; onOpen: () => void }) {
  const body = plainText(post.body_html);
  const files = post.attachments.length;
  return (
    <View style={styles.card}>
      <View style={[styles.cardAccent, { backgroundColor: tint }]} />
      <View style={styles.cardBody}>
        <View style={styles.kindRow}>
          <MaterialCommunityIcons name="bullhorn-outline" size={16} color={tint} />
          <Text style={[styles.kindLabel, { color: tint }]}>POST</Text>
        </View>
        <Text style={styles.author} numberOfLines={1}>
          {[post.author, formatDateTime(post.posted_at)].filter(Boolean).join(' · ')}
        </Text>
        {post.title ? (
          <Text style={styles.cardTitle} numberOfLines={3}>
            {post.title}
          </Text>
        ) : null}
        {body ? (
          <Text style={styles.cardText} numberOfLines={14}>
            {body}
          </Text>
        ) : (
          <Text style={[styles.cardText, styles.cardTextMuted]}>No text in this post.</Text>
        )}
        <View style={styles.cardFooter}>
          {files ? (
            <View style={styles.meta}>
              <MaterialCommunityIcons name="paperclip" size={16} color={colors.muted} />
              <Text style={type.caption}>{files === 1 ? '1 attachment' : `${files} attachments`}</Text>
            </View>
          ) : (
            <View />
          )}
          <OpenButton tint={tint} onPress={onOpen} label="Open course" />
        </View>
      </View>
    </View>
  );
}

function AssignmentStory({
  assignment,
  tint,
  now,
  onOpen,
}: {
  assignment: Assignment;
  tint: string;
  now: number;
  onOpen: () => void;
}) {
  const due = assignment.due_at;
  const overdue = !!due && new Date(due).getTime() < now;
  const description = plainText(assignment.description_html);
  return (
    <View style={styles.card}>
      <View style={[styles.cardAccent, { backgroundColor: tint }]} />
      <View style={styles.cardBody}>
        <View style={styles.kindRow}>
          <MaterialCommunityIcons
            name={assignment.kind === 'quiz' ? 'help-circle-outline' : 'clipboard-text-outline'}
            size={16}
            color={tint}
          />
          <Text style={[styles.kindLabel, { color: tint }]}>
            {assignment.kind === 'quiz' ? 'NEW QUIZ' : 'NEW ASSIGNMENT'}
          </Text>
        </View>
        <Text style={styles.cardTitle} numberOfLines={4}>
          {assignment.title}
        </Text>
        <View style={styles.facts}>
          <View style={styles.fact}>
            <Text style={type.label}>DUE</Text>
            <Text style={[styles.factValue, overdue && styles.danger]}>
              {due ? formatDateTime(due) : 'No deadline'}
            </Text>
            {due ? (
              <Text style={[type.caption, overdue && styles.danger]}>{relativeDue(due, new Date(now))}</Text>
            ) : null}
          </View>
          <View style={styles.fact}>
            <Text style={type.label}>STATUS</Text>
            <Text style={styles.factValue}>{STATUS_LABELS[assignment.status]}</Text>
            {assignment.grade ? <Text style={type.caption}>{assignment.grade}</Text> : null}
          </View>
        </View>
        {description ? (
          <Text style={styles.cardText} numberOfLines={8}>
            {description}
          </Text>
        ) : null}
        <View style={styles.cardFooter}>
          <View />
          <OpenButton tint={tint} onPress={onOpen} label="Open assignment" />
        </View>
      </View>
    </View>
  );
}

function OpenButton({ tint, label, onPress }: { tint: string; label: string; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.openButton, { backgroundColor: tint }, pressed && styles.openPressed]}
      accessibilityRole="button"
    >
      <Text style={styles.openText}>{label}</Text>
      <MaterialCommunityIcons name="arrow-right" size={18} color="#FFFFFF" />
    </Pressable>
  );
}

function updateKey(update: Update) {
  return update.kind === 'post'
    ? `post:${update.post.source}:${update.post.id}`
    : `assignment:${update.assignment.source}:${update.assignment.id}`;
}

function classTime(iso: string, now: number) {
  const date = new Date(iso);
  const today = new Date(now);
  const sameDay = date.toDateString() === today.toDateString();
  return `${sameDay ? 'Today' : WEEKDAY.format(date)} ${formatTime(iso)}`;
}

function ago(iso: string, now: number) {
  const minutes = Math.max(0, Math.round((now - new Date(iso).getTime()) / 60_000));
  if (minutes < 60) {
    return minutes < 1 ? 'just now' : `${minutes} min ago`;
  }
  const hours = Math.round(minutes / 60);
  if (hours < 24) {
    return `${hours} h ago`;
  }
  return `${Math.round(hours / 24)} d ago`;
}

const styles = StyleSheet.create({
  list: { flex: 1, backgroundColor: colors.background },
  listContent: { flexGrow: 1, paddingBottom: spacing.xl },
  storiesBlock: {
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  blockLabel: {
    ...type.label,
    paddingHorizontal: spacing.md,
    marginBottom: spacing.sm,
  },
  storyRow: { paddingHorizontal: spacing.sm, gap: spacing.xs },
  story: {
    width: CIRCLE + 16,
    alignItems: 'center',
    paddingVertical: spacing.xs,
    borderRadius: radii.md,
  },
  storyPressed: { opacity: 0.6 },
  ring: {
    width: CIRCLE,
    height: CIRCLE,
    borderRadius: CIRCLE / 2,
    borderWidth: 2.5,
    padding: 3,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ringInner: {
    width: CIRCLE - 11,
    height: CIRCLE - 11,
    borderRadius: (CIRCLE - 11) / 2,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  storyName: {
    ...type.caption,
    fontSize: 12,
    color: colors.text,
    marginTop: spacing.xs,
    maxWidth: CIRCLE + 12,
  },
  storyNameSeen: { color: colors.muted },
  noUpdates: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: spacing.xs,
    marginHorizontal: spacing.md,
    marginVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radii.pill,
    backgroundColor: colors.surface,
  },
  noUpdatesText: { ...type.caption },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: 64,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
  },
  rowPressed: { backgroundColor: colors.surface },
  rowMain: { flex: 1, gap: 2 },
  rowTitle: { ...type.body, fontWeight: '500' },
  badge: {
    minWidth: 28,
    height: 24,
    paddingHorizontal: spacing.sm,
    borderRadius: radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: { fontSize: 13, fontWeight: '700', fontVariant: ['tabular-nums'] },
  nextClass: {
    ...type.caption,
    color: colors.text,
    fontVariant: ['tabular-nums'],
  },
  stage: { flex: 1, backgroundColor: STAGE },
  stageTint: { paddingBottom: spacing.sm },
  segments: {
    flexDirection: 'row',
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
  },
  segment: {
    flex: 1,
    height: 3,
    borderRadius: 2,
    overflow: 'hidden',
    backgroundColor: 'rgba(255,255,255,0.28)',
  },
  segmentFill: { height: 3, backgroundColor: '#FFFFFF' },
  segmentFull: { width: '100%' },
  segmentEmpty: { width: 0 },
  viewerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingLeft: spacing.md,
    paddingRight: spacing.xs,
    paddingTop: spacing.sm,
  },
  viewerHeading: { flex: 1 },
  viewerTitle: { ...type.title, color: '#FFFFFF' },
  viewerMeta: { ...type.caption, color: 'rgba(255,255,255,0.7)' },
  closeButton: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  closePressed: { backgroundColor: 'rgba(255,255,255,0.14)' },
  tapArea: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
  },
  card: {
    maxHeight: '100%',
    borderRadius: radii.lg,
    overflow: 'hidden',
    backgroundColor: colors.background,
  },
  cardAccent: { height: 4 },
  cardBody: { flexShrink: 1, padding: spacing.lg, gap: spacing.sm },
  kindRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  kindLabel: { ...type.label },
  author: { ...type.caption },
  cardTitle: { ...type.headline },
  cardText: { ...type.body, fontSize: 16, lineHeight: 24, flexShrink: 1 },
  cardTextMuted: { color: colors.muted },
  cardFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    marginTop: spacing.sm,
  },
  meta: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  facts: { flexDirection: 'row', gap: spacing.md, marginVertical: spacing.xs },
  fact: {
    flex: 1,
    padding: spacing.md,
    borderRadius: radii.md,
    backgroundColor: colors.surface,
    gap: 2,
  },
  factValue: { ...type.title },
  danger: { color: colors.danger },
  openButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: 48,
    paddingHorizontal: spacing.md + 4,
    borderRadius: radii.pill,
  },
  openPressed: { opacity: 0.8 },
  openText: { ...type.title, color: '#FFFFFF' },
});
