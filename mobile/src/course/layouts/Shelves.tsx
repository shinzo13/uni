import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { FlatList, LayoutAnimation, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';

import type { Assignment, Post } from '@/api/types';
import { EmptyState } from '@/components/EmptyState';
import { PostCard } from '@/components/PostCard';
import { type CourseData, type CourseLayoutProps, type PlacedItem, useOpeners } from '@/course/data';
import { ItemRow } from '@/course/ItemRow';
import { isNewSince, itemCaption, itemColor, itemGlyph, KIND_LABELS, type Shelf, shelfOf } from '@/course/items';
import { formatDay, formatShortDate, formatTime, plainText, relativeDue } from '@/format';
import { colors, radii, spacing, tinted, type } from '@/theme';
import { useNow } from '@/useNow';

const CARD_WIDTH = 152;
const CARD_HEIGHT = 176;
const POST_WIDTH = 248;
const GAP = 12;
const SOON_MS = 3 * 24 * 3_600_000;

type ShelfKey = Exclude<Shelf, 'info'> | 'posts';

type Task = {
  key: string;
  title: string;
  kind: 'assignment' | 'quiz';
  placed: PlacedItem | null;
  assignment: Assignment | null;
};

type Forum = { placed: PlacedItem; copies: number };

type Status = { text: string; color: string; done: boolean };

const SHELF_TITLES: Record<Exclude<ShelfKey, 'tasks' | 'posts' | 'discussion'>, string> = {
  lectures: 'Lectures & slides',
  files: 'Files',
  links: 'Links',
};

function infoGlyph(title: string) {
  if (/warunki|zaliczen|regulamin|ocen|rules|grading/i.test(title)) return 'scale-balance';
  if (/dyżur|dyzur|konsultac|office/i.test(title)) return 'clock-outline';
  if (/literatur|książ|ksiaz|reading|book/i.test(title)) return 'book-open-variant';
  if (/sylabus|syllabus|harmonogram|plan|schedule/i.test(title)) return 'calendar-text-outline';
  if (/kontakt|contact/i.test(title)) return 'account-outline';
  return 'information-outline';
}

function taskStatus(assignment: Assignment | null, now: number): Status | null {
  if (!assignment) return null;
  if (assignment.status === 'graded') {
    return {
      text: assignment.grade ? `Graded ${assignment.grade}` : 'Graded',
      color: colors.success,
      done: true,
    };
  }
  if (assignment.status === 'submitted') return { text: 'Submitted', color: colors.success, done: true };
  if (!assignment.due_at) return { text: 'No deadline', color: colors.muted, done: false };
  const left = new Date(assignment.due_at).getTime() - now;
  if (left < 0)
    return {
      text: `Overdue · ${formatShortDate(assignment.due_at)}`,
      color: colors.danger,
      done: false,
    };
  const due = `Due ${relativeDue(assignment.due_at, new Date(now))}`;
  return {
    text: due,
    color: left < SOON_MS ? colors.warning : colors.text,
    done: false,
  };
}

function taskRank(task: Task, now: number) {
  const status = taskStatus(task.assignment, now);
  if (status?.done) return Number.MAX_SAFE_INTEGER;
  if (task.assignment?.due_at) return new Date(task.assignment.due_at).getTime();
  return Number.MAX_SAFE_INTEGER - 1;
}

function postKey(post: Post) {
  return `${post.source}:${post.id}`;
}

function placedKey(placed: PlacedItem) {
  return `${placed.courseId}:${placed.item.id}`;
}

function useShelves(data: CourseData, findAssignment: (placed: PlacedItem) => Assignment | null, now: number) {
  return useMemo(() => {
    const placedBy: Record<Shelf, PlacedItem[]> = {
      info: [],
      tasks: [],
      lectures: [],
      files: [],
      links: [],
      discussion: [],
    };
    for (const placed of data.items) {
      if (placed.item.kind === 'label') continue;
      placedBy[shelfOf(placed.item, placed.section.title)].push(placed);
    }
    const matched = new Set<string>();
    const fromItems: Task[] = placedBy.tasks.map((placed) => {
      const assignment = findAssignment(placed);
      if (assignment) matched.add(`${assignment.source}:${assignment.id}`);
      return {
        key: placedKey(placed),
        title: placed.item.title,
        kind: placed.item.kind === 'quiz' ? 'quiz' : 'assignment',
        placed,
        assignment,
      };
    });
    const loose: Task[] = data.assignments
      .filter((assignment) => !matched.has(`${assignment.source}:${assignment.id}`))
      .map((assignment) => ({
        key: `${assignment.source}:${assignment.id}`,
        title: assignment.title,
        kind: assignment.kind,
        placed: null,
        assignment,
      }));
    const tasks = [...fromItems, ...loose]
      .map((task, order) => ({ task, order, rank: taskRank(task, now) }))
      .sort((a, b) => a.rank - b.rank || a.order - b.order)
      .map(({ task }) => task);
    const forums = new Map<string, Forum>();
    for (const placed of placedBy.discussion) {
      const key = placed.item.title.trim().toLowerCase();
      const existing = forums.get(key);
      if (existing) existing.copies += 1;
      else forums.set(key, { placed, copies: 1 });
    }
    return {
      info: placedBy.info,
      tasks,
      lectures: placedBy.lectures,
      files: placedBy.files,
      links: placedBy.links,
      forums: [...forums.values()],
    };
  }, [data.items, data.assignments, findAssignment, now]);
}

export function ShelvesLayout({ data }: CourseLayoutProps) {
  const { look } = data;
  const tint = look.tint;
  const now = useNow();
  const { openItem, openAttachment, findAssignment } = useOpeners(data.assignments);
  const shelves = useShelves(data, findAssignment, now);
  const [expanded, setExpanded] = useState<Partial<Record<ShelfKey, boolean>>>({});

  const toggle = (key: ShelfKey, value?: boolean) => {
    LayoutAnimation.configureNext(LayoutAnimation.create(200, 'easeInEaseOut', 'opacity'));
    setExpanded((current) => ({ ...current, [key]: value ?? !current[key] }));
  };

  const detailOf = (placed: PlacedItem) =>
    data.moodle.length > 1 ? (data.moodle.find((course) => course.courseId === placed.courseId)?.detail ?? null) : null;
  const isNew = (placed: PlacedItem) => isNewSince(placed.item, data.lastSeen);
  const isNewPost = (post: Post) => !!data.lastSeen && post.posted_at > data.lastSeen;
  const openTask = (task: Task) => {
    if (task.assignment) {
      router.push({
        pathname: '/assignment/[id]',
        params: { id: task.assignment.id, source: task.assignment.source },
      });
    } else if (task.placed) {
      openItem(task.placed);
    }
  };
  const openPlaced = (placed: PlacedItem, key: ShelfKey) => {
    const { item } = placed;
    if (item.kind === 'folder' || item.attachments.length > 1) {
      toggle(key, true);
      return;
    }
    openItem(placed);
  };

  const refresh = <RefreshControl refreshing={data.refreshing} onRefresh={data.refresh} colors={[tint]} />;

  if (data.isLoading) {
    return (
      <ScrollView style={styles.screen} refreshControl={refresh}>
        <ShelvesSkeleton />
      </ScrollView>
    );
  }

  const teamsOnly = data.moodle.length === 0;
  const materials = shelves.info.length + shelves.lectures.length + shelves.files.length + shelves.links.length;
  const empty = materials + shelves.tasks.length + shelves.forums.length + data.posts.length === 0;
  const next = [...data.upcoming].sort((a, b) => a.starts_at.localeCompare(b.starts_at))[0] ?? null;

  const rowCaption = (placed: PlacedItem, base: string) => [base, detailOf(placed)].filter(Boolean).join(' · ');

  const materialShelf = (key: 'lectures' | 'files' | 'links', list: PlacedItem[]) =>
    list.length === 0 ? null : (
      <ShelfBlock
        key={key}
        title={SHELF_TITLES[key]}
        count={list.length}
        tint={tint}
        expanded={!!expanded[key]}
        onToggle={() => toggle(key)}
        data={list}
        keyOf={placedKey}
        renderCard={(placed) => (
          <MaterialCard
            placed={placed}
            tint={tint}
            detail={detailOf(placed)}
            isNew={isNew(placed)}
            onPress={() => openPlaced(placed, key)}
          />
        )}
        renderRow={(placed) => (
          <ItemRow
            placed={placed}
            tint={tint}
            isNew={isNew(placed)}
            caption={rowCaption(placed, `${itemCaption(placed.item)} · ${placed.section.title}`)}
            onOpen={openItem}
            onOpenAttachment={openAttachment}
          />
        )}
      />
    );

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content} refreshControl={refresh}>
      {next ? (
        <View style={[styles.next, { backgroundColor: tinted(tint, 0.08) }]}>
          <MaterialCommunityIcons name="calendar-clock" size={20} color={tint} />
          <View style={styles.flex}>
            <Text style={type.label}>NEXT CLASS</Text>
            <Text style={type.body} numberOfLines={1}>
              {[next.kind, `${formatDay(next.starts_at)}, ${formatTime(next.starts_at)}`, next.room]
                .filter(Boolean)
                .join(' · ')}
            </Text>
          </View>
        </View>
      ) : null}

      {shelves.info.length > 0 ? (
        <View style={styles.block}>
          <View style={styles.header}>
            <Text style={type.titleLarge}>Essentials</Text>
          </View>
          <View style={styles.grid}>
            {shelves.info.map((placed) => (
              <EssentialCard
                key={placedKey(placed)}
                placed={placed}
                tint={tint}
                detail={detailOf(placed)}
                isNew={isNew(placed)}
                onPress={() => openItem(placed)}
              />
            ))}
          </View>
        </View>
      ) : null}

      {shelves.tasks.length > 0 ? (
        <ShelfBlock
          title="Tasks"
          count={shelves.tasks.length}
          tint={tint}
          expanded={!!expanded.tasks}
          onToggle={() => toggle('tasks')}
          data={shelves.tasks}
          keyOf={(task) => task.key}
          renderCard={(task) => (
            <TaskCard
              task={task}
              tint={tint}
              status={taskStatus(task.assignment, now)}
              detail={task.placed ? detailOf(task.placed) : null}
              isNew={task.placed ? isNew(task.placed) : false}
              onPress={() => openTask(task)}
            />
          )}
          renderRow={(task) => (
            <TaskRow task={task} tint={tint} status={taskStatus(task.assignment, now)} onPress={() => openTask(task)} />
          )}
        />
      ) : null}

      {data.posts.length > 0 ? (
        <ShelfBlock
          title="Announcements"
          count={data.posts.length}
          tint={tint}
          expanded={!!expanded.posts}
          onToggle={() => toggle('posts')}
          data={data.posts}
          keyOf={postKey}
          cardWidth={POST_WIDTH}
          renderCard={(post) => (
            <PostPreview post={post} tint={tint} isNew={isNewPost(post)} onPress={() => toggle('posts', true)} />
          )}
          renderRow={(post) => (
            <View style={styles.post}>
              <PostCard post={post} tint={tint} compact />
            </View>
          )}
          alwaysShowToggle
        />
      ) : null}

      {materialShelf('lectures', shelves.lectures)}
      {materialShelf('files', shelves.files)}
      {materialShelf('links', shelves.links)}

      {shelves.forums.length > 0 ? (
        <ShelfBlock
          title="Discussion"
          count={shelves.forums.length}
          tint={tint}
          expanded={!!expanded.discussion}
          onToggle={() => toggle('discussion')}
          data={shelves.forums}
          keyOf={(forum) => placedKey(forum.placed)}
          renderCard={(forum) => (
            <MaterialCard
              placed={forum.placed}
              tint={tint}
              detail={detailOf(forum.placed)}
              isNew={isNew(forum.placed)}
              copies={forum.copies}
              onPress={() => openItem(forum.placed)}
            />
          )}
          renderRow={(forum) => (
            <ItemRow
              placed={forum.placed}
              tint={tint}
              isNew={isNew(forum.placed)}
              caption={rowCaption(forum.placed, `Forum · ${forum.placed.section.title}`)}
              trailing={forum.copies > 1 ? <Text style={styles.copies}>×{forum.copies}</Text> : undefined}
              onOpen={openItem}
              onOpenAttachment={openAttachment}
            />
          )}
        />
      ) : null}

      {teamsOnly ? (
        <View style={styles.notice}>
          <MaterialCommunityIcons name="bookshelf" size={22} color={colors.muted} />
          <Text style={[type.caption, styles.flex]}>
            Materials live in Moodle. This subject has no Moodle course linked yet — add it with Edit to shelve its
            slides, files and rules here.
          </Text>
        </View>
      ) : null}

      {empty && !teamsOnly ? (
        <EmptyState title="The shelves are empty" hint="Materials appear here when the teacher publishes them." />
      ) : null}
    </ScrollView>
  );
}

type ShelfBlockProps<T> = {
  title: string;
  count: number;
  tint: string;
  expanded: boolean;
  onToggle: () => void;
  data: T[];
  keyOf: (entry: T) => string;
  renderCard: (entry: T) => React.ReactElement;
  renderRow: (entry: T) => React.ReactElement;
  cardWidth?: number;
  alwaysShowToggle?: boolean;
};

function ShelfBlock<T>({
  title,
  count,
  tint,
  expanded,
  onToggle,
  data,
  keyOf,
  renderCard,
  renderRow,
  cardWidth = CARD_WIDTH,
  alwaysShowToggle,
}: ShelfBlockProps<T>) {
  const toggleable = alwaysShowToggle || count > 2;
  return (
    <View style={styles.block}>
      <View style={styles.header}>
        <Text style={type.titleLarge}>{title}</Text>
        <View style={[styles.count, { backgroundColor: tinted(tint, 0.12) }]}>
          <Text style={[styles.countText, { color: tint }]}>{count}</Text>
        </View>
        <View style={styles.flex} />
        {toggleable ? (
          <Pressable onPress={onToggle} style={styles.seeAll} accessibilityRole="button" hitSlop={4}>
            <Text style={[styles.seeAllText, { color: tint }]}>{expanded ? 'Show less' : 'See all'}</Text>
            <MaterialCommunityIcons name={expanded ? 'chevron-up' : 'chevron-right'} size={18} color={tint} />
          </Pressable>
        ) : null}
      </View>
      {expanded ? (
        <View style={styles.list}>
          {data.map((entry) => (
            <View key={keyOf(entry)}>{renderRow(entry)}</View>
          ))}
        </View>
      ) : (
        <FlatList
          horizontal
          data={data}
          keyExtractor={keyOf}
          renderItem={({ item }) => <View style={{ width: cardWidth }}>{renderCard(item)}</View>}
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.rail}
          ItemSeparatorComponent={RailGap}
          snapToInterval={cardWidth + GAP}
          snapToAlignment="start"
          decelerationRate="fast"
          initialNumToRender={6}
        />
      )}
    </View>
  );
}

function RailGap() {
  return <View style={styles.railGap} />;
}

function NewDot({ tint }: { tint: string }) {
  return <View style={[styles.dot, { backgroundColor: tint }]} accessibilityLabel="New" />;
}

type EssentialProps = {
  placed: PlacedItem;
  tint: string;
  detail: string | null;
  isNew: boolean;
  onPress: () => void;
};

function EssentialCard({ placed, tint, detail, isNew, onPress }: EssentialProps) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.essential, { backgroundColor: tinted(tint, pressed ? 0.14 : 0.07) }]}
      accessibilityRole="button"
      accessibilityLabel={placed.item.title}
    >
      <View style={[styles.essentialIcon, { backgroundColor: tinted(tint, 0.14) }]}>
        <MaterialCommunityIcons name={infoGlyph(placed.item.title) as never} size={20} color={tint} />
      </View>
      <View style={styles.flex}>
        <Text style={styles.essentialTitle} numberOfLines={3}>
          {placed.item.title}
        </Text>
        {detail ? (
          <Text style={type.caption} numberOfLines={1}>
            {detail}
          </Text>
        ) : null}
      </View>
      {isNew ? <NewDot tint={tint} /> : null}
    </Pressable>
  );
}

type MaterialProps = {
  placed: PlacedItem;
  tint: string;
  detail: string | null;
  isNew: boolean;
  copies?: number;
  onPress: () => void;
};

function MaterialCard({ placed, tint, detail, isNew, copies = 1, onPress }: MaterialProps) {
  const { item } = placed;
  const color = itemColor(item, tint);
  const caption = item.kind === 'forum' ? KIND_LABELS.forum : itemCaption(item);
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.card, pressed && styles.pressed]}
      accessibilityRole="button"
      accessibilityLabel={item.title}
    >
      <View style={[styles.tile, { backgroundColor: tinted(color, 0.1) }]}>
        <MaterialCommunityIcons name={itemGlyph(item) as never} size={34} color={color} />
        {copies > 1 ? (
          <View style={[styles.badge, { backgroundColor: color }]}>
            <Text style={styles.badgeText}>×{copies}</Text>
          </View>
        ) : null}
        {isNew ? (
          <View style={styles.tileDot}>
            <NewDot tint={tint} />
          </View>
        ) : null}
      </View>
      <View style={styles.cardBody}>
        <Text style={styles.cardTitle} numberOfLines={3}>
          {item.title}
        </Text>
        <View style={styles.flex} />
        <Text style={[styles.cardCaption, { color }]} numberOfLines={1}>
          {caption}
        </Text>
        <Text style={styles.cardMeta} numberOfLines={1}>
          {[placed.section.title, detail].filter(Boolean).join(' · ')}
        </Text>
      </View>
    </Pressable>
  );
}

type TaskProps = {
  task: Task;
  tint: string;
  status: Status | null;
  detail: string | null;
  isNew: boolean;
  onPress: () => void;
};

function taskGlyph(task: Task, status: Status | null) {
  if (status?.done) return 'check-circle-outline';
  return task.kind === 'quiz' ? 'help-circle-outline' : 'clipboard-text-outline';
}

function TaskCard({ task, tint, status, detail, isNew, onPress }: TaskProps) {
  const accent = status?.done ? colors.success : tint;
  const source = task.assignment && task.assignment.source !== 'moodle' ? 'Teams' : null;
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.card, styles.taskCard, pressed && styles.pressed]}
      accessibilityRole="button"
      accessibilityLabel={task.title}
    >
      <View style={styles.taskTop}>
        <View style={[styles.taskIcon, { backgroundColor: tinted(accent, 0.12) }]}>
          <MaterialCommunityIcons name={taskGlyph(task, status) as never} size={20} color={accent} />
        </View>
        <Text style={type.label}>{(task.kind === 'quiz' ? 'Quiz' : 'Assignment').toUpperCase()}</Text>
        <View style={styles.flex} />
        {isNew ? <NewDot tint={tint} /> : null}
      </View>
      <Text style={[styles.cardTitle, status?.done && styles.doneTitle]} numberOfLines={3}>
        {task.title}
      </Text>
      <View style={styles.flex} />
      {status ? (
        <View style={[styles.status, { backgroundColor: tinted(status.color, 0.1) }]}>
          <Text style={[styles.statusText, { color: status.color }]} numberOfLines={1}>
            {status.text}
          </Text>
        </View>
      ) : (
        <Text style={styles.cardMeta}>Open in Moodle</Text>
      )}
      <Text style={styles.cardMeta} numberOfLines={1}>
        {[task.placed?.section.title ?? source, detail].filter(Boolean).join(' · ')}
      </Text>
    </Pressable>
  );
}

function TaskRow({ task, tint, status, onPress }: Omit<TaskProps, 'detail' | 'isNew'>) {
  const accent = status?.done ? colors.success : tint;
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
      accessibilityRole="button"
      accessibilityLabel={task.title}
    >
      <View style={[styles.rowIcon, { backgroundColor: tinted(accent, 0.12) }]}>
        <MaterialCommunityIcons name={taskGlyph(task, status) as never} size={22} color={accent} />
      </View>
      <View style={styles.flex}>
        <Text style={[type.body, status?.done && styles.doneTitle]} numberOfLines={2}>
          {task.title}
        </Text>
        <Text style={type.caption} numberOfLines={1}>
          {[
            task.placed?.section.title,
            task.assignment?.due_at ? `due ${formatShortDate(task.assignment.due_at)}` : null,
          ]
            .filter(Boolean)
            .join(' · ') || (task.kind === 'quiz' ? 'Quiz' : 'Assignment')}
        </Text>
      </View>
      {status ? <Text style={[styles.statusText, { color: status.color }]}>{status.text}</Text> : null}
    </Pressable>
  );
}

type PostPreviewProps = {
  post: Post;
  tint: string;
  isNew: boolean;
  onPress: () => void;
};

function PostPreview({ post, tint, isNew, onPress }: PostPreviewProps) {
  const body = plainText(post.body_html).replace(/\s+/g, ' ');
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.card, styles.postCard, pressed && styles.pressed]}
      accessibilityRole="button"
      accessibilityLabel={post.title || body.slice(0, 60)}
    >
      <View style={styles.taskTop}>
        <MaterialCommunityIcons name="bullhorn-outline" size={18} color={tint} />
        <Text style={type.label} numberOfLines={1}>
          {formatShortDate(post.posted_at)}
        </Text>
        <View style={styles.flex} />
        {isNew ? <NewDot tint={tint} /> : null}
      </View>
      {post.title ? (
        <Text style={styles.cardTitle} numberOfLines={1}>
          {post.title}
        </Text>
      ) : null}
      <Text style={styles.excerpt} numberOfLines={post.title ? 3 : 4}>
        {body}
      </Text>
      <View style={styles.flex} />
      <Text style={styles.cardMeta} numberOfLines={1}>
        {post.author ?? 'Teacher'}
      </Text>
    </Pressable>
  );
}

function ShelvesSkeleton() {
  return (
    <View style={styles.content} accessibilityLabel="Loading course">
      <View style={styles.block}>
        <View style={[styles.bone, styles.boneTitle]} />
        <View style={styles.grid}>
          {[0, 1, 2, 3].map((key) => (
            <View key={key} style={[styles.essential, styles.bone]} />
          ))}
        </View>
      </View>
      {[0, 1].map((shelf) => (
        <View key={shelf} style={styles.block}>
          <View style={[styles.bone, styles.boneTitle]} />
          <View style={[styles.rail, styles.skeletonRail]}>
            {[0, 1, 2].map((key) => (
              <View key={key} style={[styles.bone, styles.boneCard]} />
            ))}
          </View>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: {
    paddingTop: spacing.sm,
    paddingBottom: spacing.xl,
    gap: spacing.lg,
  },
  flex: { flex: 1 },
  block: { gap: spacing.sm },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    minHeight: 48,
  },
  count: {
    minWidth: 24,
    height: 22,
    paddingHorizontal: 7,
    borderRadius: radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  countText: { fontSize: 12, fontWeight: '700' },
  seeAll: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 48,
    paddingLeft: spacing.sm,
  },
  seeAllText: { fontSize: 14, fontWeight: '600' },
  next: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginHorizontal: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 4,
    borderRadius: radii.md,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  essential: {
    flexGrow: 1,
    flexBasis: '40%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm + 4,
    minHeight: 72,
    padding: spacing.sm + 4,
    borderRadius: radii.md,
  },
  essentialIcon: {
    width: 36,
    height: 36,
    borderRadius: radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  essentialTitle: {
    fontSize: 14,
    lineHeight: 19,
    fontWeight: '600',
    color: colors.text,
  },
  rail: { paddingHorizontal: spacing.md },
  railGap: { width: GAP },
  skeletonRail: { flexDirection: 'row', gap: GAP },
  card: {
    height: CARD_HEIGHT,
    borderRadius: radii.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    backgroundColor: colors.background,
    overflow: 'hidden',
  },
  pressed: { backgroundColor: colors.surface },
  tile: { height: 72, alignItems: 'center', justifyContent: 'center' },
  tileDot: { position: 'absolute', top: spacing.sm, right: spacing.sm },
  badge: {
    position: 'absolute',
    bottom: spacing.sm,
    right: spacing.sm,
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: radii.pill,
  },
  badgeText: { fontSize: 11, fontWeight: '700', color: colors.background },
  cardBody: { flex: 1, padding: spacing.sm + 2, gap: 2 },
  cardTitle: {
    fontSize: 14,
    lineHeight: 19,
    fontWeight: '600',
    color: colors.text,
  },
  cardCaption: { fontSize: 12, lineHeight: 16, fontWeight: '600' },
  cardMeta: { fontSize: 12, lineHeight: 16, color: colors.muted },
  taskCard: { padding: spacing.sm + 4, gap: spacing.sm },
  taskTop: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  taskIcon: {
    width: 32,
    height: 32,
    borderRadius: radii.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  doneTitle: { color: colors.muted },
  status: {
    alignSelf: 'flex-start',
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    borderRadius: radii.pill,
    maxWidth: '100%',
  },
  statusText: { fontSize: 12, lineHeight: 16, fontWeight: '600' },
  postCard: {
    padding: spacing.sm + 4,
    gap: spacing.xs + 2,
    backgroundColor: colors.surface,
    borderWidth: 0,
  },
  excerpt: { fontSize: 13, lineHeight: 18, color: colors.text },
  dot: { width: 8, height: 8, borderRadius: 4 },
  list: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
    minHeight: 56,
  },
  rowIcon: {
    width: 40,
    height: 40,
    borderRadius: radii.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  copies: { fontSize: 13, fontWeight: '700', color: colors.muted },
  post: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  notice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginHorizontal: spacing.md,
    padding: spacing.md,
    borderRadius: radii.md,
    backgroundColor: colors.surface,
  },
  bone: { backgroundColor: colors.surface },
  boneTitle: {
    width: 140,
    height: 22,
    borderRadius: radii.sm,
    marginHorizontal: spacing.md,
    marginVertical: 13,
  },
  boneCard: { width: CARD_WIDTH, height: CARD_HEIGHT, borderRadius: radii.md },
});
