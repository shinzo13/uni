import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { router } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Animated, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';

import { useCompletion } from '@/api/queries';
import type { Assignment, ClassSession } from '@/api/types';
import { PostCard } from '@/components/PostCard';
import { type CourseLayoutProps, type PlacedItem, useOpeners } from '@/course/data';
import { itemCaption, itemColor, itemGlyph, KIND_LABELS } from '@/course/items';
import { formatDay, formatShortDate, formatTime, relativeDue } from '@/format';
import { readItem, writeItem } from '@/session/storage';
import { colors, radii, sourceNames, spacing, tinted, type } from '@/theme';
import { useNow } from '@/useNow';

type Mark = 'done' | 'manual' | 'local' | 'auto' | 'open' | 'none';

type Tone = 'muted' | 'danger' | 'success';

type Line = {
  key: string;
  title: string;
  caption: string;
  tone: Tone;
  mark: Mark;
  task: boolean;
  glyph: string;
  glyphColor: string;
  onOpen: () => void;
  onToggle?: (completed: boolean) => void;
};

type Group = {
  key: string;
  title: string;
  eyebrow: string | null;
  lines: Line[];
  bar: boolean;
};

type Filter = 'todo' | 'all';

const SEGMENT_LIMIT = 48;
const AUTO_HINTS: Partial<Record<string, string>> = {
  assignment: 'Completes when you submit',
  quiz: 'Completes when you finish the quiz',
  forum: 'Completes when you post',
};

const isTrackable = (line: Line) => line.mark !== 'none';
const isDone = (line: Line) => line.mark === 'done';
const isFinished = (assignment: Assignment | null) =>
  assignment?.status === 'submitted' || assignment?.status === 'graded';

function useLocalTicks(subjectKey: string) {
  const storageKey = `checklist-${subjectKey.replace(/[^A-Za-z0-9._-]/g, '_')}`;
  const [ticks, setTicks] = useState<Set<string>>(() => new Set());
  useEffect(() => {
    let active = true;
    readItem(storageKey)
      .then((raw) => {
        if (!active || !raw) return;
        const parsed: unknown = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          setTicks(new Set(parsed.filter((value): value is string => typeof value === 'string')));
        }
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [storageKey]);
  const toggle = useCallback(
    (id: string, completed: boolean) => {
      setTicks((current) => {
        const next = new Set(current);
        if (completed) next.add(id);
        else next.delete(id);
        writeItem(storageKey, next.size > 0 ? JSON.stringify([...next]) : null).catch(() =>
          Alert.alert('Could not save', 'Your tick was not saved on this phone.'),
        );
        return next;
      });
    },
    [storageKey],
  );
  return { ticks, toggle };
}

export function ChecklistLayout({ data }: CourseLayoutProps) {
  const { look } = data;
  const tint = look.tint;
  const now = useNow();
  const { openItem, findAssignment } = useOpeners(data.assignments);
  const { mutateAsync } = useCompletion();
  const { ticks, toggle } = useLocalTicks(look.key);
  const [filter, setFilter] = useState<Filter | null>(null);
  const [overrides, setOverrides] = useState<Record<string, boolean>>({});

  const dueCaption = useCallback(
    (dueAt: string | null) => {
      if (!dueAt) return null;
      return `Due ${formatShortDate(dueAt)} · ${relativeDue(dueAt, new Date(now))}`;
    },
    [now],
  );

  const assignmentLine = useCallback(
    (assignment: Assignment): Line => {
      const finished = isFinished(assignment);
      const overdue = !finished && !!assignment.due_at && new Date(assignment.due_at).getTime() < now;
      const caption = finished
        ? assignment.grade
          ? `Graded ${assignment.grade}`
          : 'Submitted'
        : (dueCaption(assignment.due_at) ?? 'No deadline');
      return {
        key: `${assignment.source}:${assignment.id}`,
        title: assignment.title,
        caption: `${sourceNames[assignment.source]} · ${caption}`,
        tone: finished ? 'success' : overdue ? 'danger' : 'muted',
        mark: finished ? 'done' : 'open',
        task: true,
        glyph: assignment.kind === 'quiz' ? 'help-circle-outline' : 'clipboard-check-outline',
        glyphColor: tint,
        onOpen: () =>
          router.push({
            pathname: '/assignment/[id]',
            params: { id: assignment.id, source: assignment.source },
          }),
      };
    },
    [dueCaption, now, tint],
  );

  const itemLine = useCallback(
    (placed: PlacedItem): Line => {
      const { item, courseId } = placed;
      const assignment = item.kind === 'assignment' || item.kind === 'quiz' ? findAssignment(placed) : null;
      const finished = isFinished(assignment);
      const localId = `${courseId}:${item.id}`;
      const task = item.kind === 'assignment' || item.kind === 'quiz';
      const due = task && !finished ? dueCaption(assignment?.due_at ?? null) : null;
      const overdue = !!due && !!assignment?.due_at && new Date(assignment.due_at).getTime() < now;
      const base = {
        key: localId,
        title: item.title,
        task,
        glyph: itemGlyph(item),
        glyphColor: itemColor(item, tint),
        onOpen: () => openItem(placed),
      };
      const doneCaption = assignment?.grade ? `Graded ${assignment.grade}` : finished ? 'Submitted' : 'Done';
      if (item.completion === 'complete' || finished) {
        return { ...base, mark: 'done', caption: doneCaption, tone: 'success' };
      }
      if (item.completion === 'incomplete' && item.manual_completion) {
        return {
          ...base,
          mark: 'manual',
          caption: due ?? KIND_LABELS[item.kind],
          tone: overdue ? 'danger' : 'muted',
          onToggle: (completed) => {
            mutateAsync({ courseId, itemId: item.id, completed }).catch(() =>
              Alert.alert('Could not update Moodle', 'The change was not saved. Check your connection and try again.'),
            );
          },
        };
      }
      if (item.completion === 'incomplete') {
        const hint = AUTO_HINTS[item.kind] ?? 'Completes when you open it';
        return {
          ...base,
          mark: 'auto',
          caption: due ? `${due} · ${hint}` : hint,
          tone: overdue ? 'danger' : 'muted',
        };
      }
      if (item.kind === 'forum') {
        return {
          ...base,
          mark: 'none',
          caption: itemCaption(item),
          tone: 'muted',
        };
      }
      if (ticks.has(localId)) {
        return {
          ...base,
          mark: 'done',
          caption: task ? 'Marked done' : 'Covered',
          tone: 'success',
          onToggle: (completed) => toggle(localId, completed),
        };
      }
      return {
        ...base,
        mark: 'local',
        caption: due ?? itemCaption(item),
        tone: overdue ? 'danger' : 'muted',
        onToggle: (completed) => toggle(localId, completed),
      };
    },
    [dueCaption, findAssignment, mutateAsync, now, openItem, ticks, tint, toggle],
  );

  const model = useMemo(() => {
    const matched = new Set<string>();
    const groups: Group[] = [];
    const multiple = data.moodle.length > 1;
    data.moodle.forEach((course) => {
      course.sections.forEach((section, index) => {
        const lines = section.items
          .filter((item) => item.kind !== 'label')
          .map((item) => {
            const placed = { item, section, courseId: course.courseId };
            const assignment = item.kind === 'assignment' || item.kind === 'quiz' ? findAssignment(placed) : null;
            if (assignment) matched.add(`${assignment.source}:${assignment.id}`);
            return itemLine(placed);
          });
        if (lines.length === 0) return;
        groups.push({
          key: `${course.courseId}:${section.id}`,
          title: section.title.trim() || `Section ${index + 1}`,
          eyebrow: multiple ? (course.detail ?? course.title) : null,
          lines,
          bar: true,
        });
      });
    });
    const extra = data.assignments
      .filter((assignment) => !matched.has(`${assignment.source}:${assignment.id}`))
      .sort((a, b) => (a.due_at ?? '9999').localeCompare(b.due_at ?? '9999'))
      .map(assignmentLine);
    if (data.moodle.length === 0) {
      const open = extra.filter((line) => !isDone(line));
      const done = extra.filter(isDone);
      if (open.length > 0)
        groups.push({
          key: 'open',
          title: 'Open',
          eyebrow: null,
          lines: open,
          bar: false,
        });
      if (done.length > 0)
        groups.push({
          key: 'done',
          title: 'Done',
          eyebrow: null,
          lines: done,
          bar: false,
        });
    } else if (extra.length > 0) {
      groups.push({
        key: 'extra',
        title: 'Other assignments',
        eyebrow: null,
        lines: extra,
        bar: true,
      });
    }
    const all = groups.flatMap((group) => group.lines);
    const trackable = all.filter(isTrackable);
    const moodleTracked = data.items.some((placed) => placed.item.completion !== 'untracked');
    return {
      groups,
      trackable,
      done: trackable.filter(isDone).length,
      openTasks: trackable.filter((line) => line.task && !isDone(line)).length,
      hasLocal: all.some((line) => line.mark === 'local' || (line.mark === 'done' && !!line.onToggle)),
      moodleTracked,
    };
  }, [data.moodle, data.assignments, data.items, findAssignment, itemLine, assignmentLine]);

  const nextDeadline = useMemo(
    () =>
      data.assignments
        .filter(
          (assignment) => !isFinished(assignment) && assignment.due_at && new Date(assignment.due_at).getTime() > now,
        )
        .sort((a, b) => (a.due_at ?? '').localeCompare(b.due_at ?? ''))[0] ?? null,
    [data.assignments, now],
  );

  const activeFilter: Filter = filter ?? (model.trackable.length > model.done ? 'todo' : 'all');
  const teamsOnly = data.moodle.length === 0;

  if (data.isLoading && data.items.length === 0 && data.moodle.length > 0) {
    return <Skeleton />;
  }

  const visibleGroups = model.groups
    .map((group) => ({
      ...group,
      shown: activeFilter === 'todo' ? group.lines.filter((line) => isTrackable(line) && !isDone(line)) : group.lines,
    }))
    .filter((group) => (activeFilter === 'todo' ? group.shown.length > 0 : true));
  const hiddenComplete = activeFilter === 'todo' ? model.groups.length - visibleGroups.length : 0;
  const empty = model.groups.length === 0;

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={data.refreshing} onRefresh={data.refresh} colors={[tint]} />}
    >
      <Summary
        tint={tint}
        done={model.done}
        lines={model.trackable}
        openTasks={model.openTasks}
        nextDeadline={nextDeadline}
        nextClass={data.upcoming[0] ?? null}
        note={
          empty
            ? null
            : model.hasLocal && !model.moodleTracked
              ? "Tick off what you've covered — stays on this phone"
              : model.hasLocal
                ? 'Moodle ticks sync with your account, the rest stays on this phone'
                : teamsOnly
                  ? 'Assignments tick themselves off when you hand them in'
                  : null
        }
        now={now}
      />
      {empty ? (
        <View style={styles.empty}>
          <MaterialCommunityIcons name="checkbox-multiple-blank-outline" size={32} color={colors.muted} />
          <Text style={type.title}>Nothing to tick off yet</Text>
          <Text style={[type.caption, styles.center]}>
            {teamsOnly
              ? 'Assignments from Teams appear here once a teacher posts them.'
              : 'Materials and tasks appear here when the teacher publishes them.'}
          </Text>
        </View>
      ) : (
        <>
          <View style={styles.pills} accessibilityRole="tablist">
            {(['todo', 'all'] as const).map((value) => {
              const selected = value === activeFilter;
              const remaining = model.trackable.length - model.done;
              return (
                <Pressable
                  key={value}
                  onPress={() => setFilter(value)}
                  accessibilityRole="tab"
                  accessibilityState={{ selected }}
                  style={[
                    styles.pill,
                    selected ? { backgroundColor: tint, borderColor: tint } : { borderColor: colors.border },
                  ]}
                >
                  <Text style={[styles.pillText, { color: selected ? '#FFFFFF' : colors.text }]}>
                    {value === 'todo' ? `To do${remaining > 0 ? ` · ${remaining}` : ''}` : 'All'}
                  </Text>
                </Pressable>
              );
            })}
          </View>
          {activeFilter === 'todo' && visibleGroups.length === 0 ? (
            <View style={styles.empty}>
              <MaterialCommunityIcons name="check-all" size={32} color={tint} />
              <Text style={type.title}>All caught up</Text>
              <Text style={[type.caption, styles.center]}>
                Everything trackable here is done. Switch to All to revisit it.
              </Text>
            </View>
          ) : null}
          {visibleGroups.map((group, index) => {
            const total = group.lines.filter(isTrackable).length;
            const done = group.lines.filter(isDone).length;
            const complete = total > 0 && done === total;
            const collapsed = overrides[group.key] ?? complete;
            const showEyebrow = !!group.eyebrow && group.eyebrow !== visibleGroups[index - 1]?.eyebrow;
            return (
              <View key={group.key} style={styles.groupWrap}>
                {showEyebrow ? <Text style={[type.label, styles.eyebrow]}>{group.eyebrow?.toUpperCase()}</Text> : null}
                <SectionCard
                  group={group}
                  lines={group.shown}
                  tint={tint}
                  done={done}
                  total={total}
                  complete={complete}
                  collapsed={collapsed}
                  onToggleCollapsed={() =>
                    setOverrides((current) => ({
                      ...current,
                      [group.key]: !collapsed,
                    }))
                  }
                />
              </View>
            );
          })}
          {hiddenComplete > 0 ? (
            <Pressable onPress={() => setFilter('all')} style={styles.hidden} accessibilityRole="button">
              <MaterialCommunityIcons name="check-circle-outline" size={18} color={colors.muted} />
              <Text style={type.caption}>
                {hiddenComplete} {hiddenComplete === 1 ? 'section' : 'sections'} done or reference only · Show all
              </Text>
            </Pressable>
          ) : null}
        </>
      )}
      {teamsOnly && data.posts.length > 0 && activeFilter === 'all' ? (
        <View style={styles.posts}>
          <Text style={[type.label, styles.eyebrow]}>LATEST POSTS</Text>
          {data.posts.slice(0, 3).map((post) => (
            <PostCard key={`${post.source}:${post.id}`} post={post} tint={tint} compact />
          ))}
        </View>
      ) : null}
    </ScrollView>
  );
}

type SummaryProps = {
  tint: string;
  done: number;
  lines: Line[];
  openTasks: number;
  nextDeadline: Assignment | null;
  nextClass: ClassSession | null;
  note: string | null;
  now: number;
};

function Summary({ tint, done, lines, openTasks, nextDeadline, nextClass, note, now }: SummaryProps) {
  const total = lines.length;
  const percent = total > 0 ? Math.round((done / total) * 100) : 0;
  return (
    <View style={[styles.summary, { backgroundColor: tinted(tint, 0.07) }]}>
      <View style={styles.summaryTop}>
        <Text style={type.display}>
          {done}
          <Text style={[type.titleLarge, styles.of]}> of {total} done</Text>
        </Text>
        {total > 0 ? <Text style={[type.title, { color: tint }]}>{percent}%</Text> : null}
      </View>
      {total > 0 ? (
        total <= SEGMENT_LIMIT ? (
          <View style={styles.segments}>
            {lines.map((line) => (
              <View
                key={line.key}
                style={[styles.segment, { backgroundColor: isDone(line) ? tint : tinted(tint, 0.18) }]}
              />
            ))}
          </View>
        ) : (
          <View style={[styles.track, styles.bigTrack, { backgroundColor: tinted(tint, 0.18) }]}>
            <View style={[styles.fill, { width: `${percent}%`, backgroundColor: tint }]} />
          </View>
        )
      ) : null}
      <View style={styles.stats}>
        <Stat icon="clipboard-text-outline" label="Open tasks" value={openTasks === 0 ? 'None' : String(openTasks)} />
        <Stat
          icon="calendar-clock"
          label="Next deadline"
          value={nextDeadline?.due_at ? relativeDue(nextDeadline.due_at, new Date(now)) : 'None'}
          detail={nextDeadline?.title ?? null}
        />
      </View>
      {nextClass ? (
        <View style={styles.classLine}>
          <MaterialCommunityIcons name="school-outline" size={16} color={colors.muted} />
          <Text style={[type.caption, styles.flex]} numberOfLines={1}>
            Next class {formatDay(nextClass.starts_at)}, {formatTime(nextClass.starts_at)} · {nextClass.kind}
            {nextClass.room ? ` · ${nextClass.room}` : ''}
          </Text>
        </View>
      ) : null}
      {note ? (
        <View style={styles.classLine}>
          <MaterialCommunityIcons name="cellphone-check" size={16} color={colors.muted} />
          <Text style={[type.caption, styles.flex]}>{note}</Text>
        </View>
      ) : null}
    </View>
  );
}

function Stat({ icon, label, value, detail }: { icon: string; label: string; value: string; detail?: string | null }) {
  return (
    <View style={styles.stat}>
      <View style={styles.statHead}>
        <MaterialCommunityIcons name={icon as never} size={14} color={colors.muted} />
        <Text style={type.label}>{label.toUpperCase()}</Text>
      </View>
      <Text style={type.title}>{value}</Text>
      {detail ? (
        <Text style={type.caption} numberOfLines={1}>
          {detail}
        </Text>
      ) : null}
    </View>
  );
}

type SectionCardProps = {
  group: Group;
  lines: Line[];
  tint: string;
  done: number;
  total: number;
  complete: boolean;
  collapsed: boolean;
  onToggleCollapsed: () => void;
};

function SectionCard({ group, lines, tint, done, total, complete, collapsed, onToggleCollapsed }: SectionCardProps) {
  const counter = total > 0 ? `${done}/${total}` : `${group.lines.length}`;
  return (
    <View style={[styles.card, complete && collapsed && { backgroundColor: tinted(tint, 0.05) }]}>
      <Pressable
        onPress={onToggleCollapsed}
        style={({ pressed }) => [styles.cardHead, pressed && styles.pressed]}
        accessibilityRole="button"
        accessibilityState={{ expanded: !collapsed }}
        accessibilityLabel={`${group.title}, ${done} of ${total} done`}
      >
        {complete ? <MaterialCommunityIcons name="check-circle" size={22} color={tint} /> : null}
        <Text style={[type.title, styles.flex, complete && collapsed && styles.mutedText]} numberOfLines={2}>
          {group.title}
        </Text>
        <Text style={[type.caption, complete && { color: tint }]}>{counter}</Text>
        <MaterialCommunityIcons name={collapsed ? 'chevron-down' : 'chevron-up'} size={22} color={colors.muted} />
      </Pressable>
      {group.bar && total > 0 && !(complete && collapsed) ? (
        <View style={[styles.track, styles.cardTrack, { backgroundColor: tinted(tint, 0.14) }]}>
          <View style={[styles.fill, { width: `${(done / total) * 100}%`, backgroundColor: tint }]} />
        </View>
      ) : null}
      {collapsed ? null : (
        <View style={styles.lines}>
          {lines.map((line) => (
            <LineRow key={line.key} line={line} tint={tint} />
          ))}
        </View>
      )}
    </View>
  );
}

function LineRow({ line, tint }: { line: Line; tint: string }) {
  const done = isDone(line);
  const toneColor = line.tone === 'danger' ? colors.danger : line.tone === 'success' ? colors.success : colors.muted;
  return (
    <View style={styles.line}>
      <CheckBox line={line} tint={tint} />
      <Pressable
        onPress={line.onOpen}
        style={({ pressed }) => [styles.lineBody, pressed && styles.pressed]}
        accessibilityRole="button"
        accessibilityLabel={line.title}
      >
        <View style={styles.flex}>
          <Text style={[type.body, done && styles.mutedText]} numberOfLines={2}>
            {line.title}
          </Text>
          <Text style={[type.caption, { color: toneColor }]} numberOfLines={1}>
            {line.caption}
          </Text>
        </View>
        <MaterialCommunityIcons name={line.glyph as never} size={20} color={done ? colors.muted : line.glyphColor} />
      </Pressable>
    </View>
  );
}

function CheckBox({ line, tint }: { line: Line; tint: string }) {
  const [scale] = useState(() => new Animated.Value(1));
  const done = isDone(line);
  const { onToggle } = line;
  if (line.mark === 'none') {
    return (
      <View style={styles.checkSlot}>
        <View style={styles.bullet} />
      </View>
    );
  }
  const box = (
    <Animated.View
      style={[
        styles.box,
        done
          ? { backgroundColor: tint, borderColor: tint }
          : line.mark === 'auto' || line.mark === 'open'
            ? styles.hollow
            : { borderColor: tint },
        { transform: [{ scale }] },
      ]}
    >
      {done ? <MaterialCommunityIcons name="check-bold" size={16} color="#FFFFFF" /> : null}
    </Animated.View>
  );
  if (!onToggle) {
    return <View style={styles.checkSlot}>{box}</View>;
  }
  return (
    <Pressable
      onPress={() => {
        scale.setValue(0.7);
        Animated.spring(scale, {
          toValue: 1,
          speed: 24,
          bounciness: 10,
          useNativeDriver: true,
        }).start();
        onToggle(!done);
      }}
      style={styles.checkSlot}
      hitSlop={4}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: done }}
      accessibilityLabel={line.title}
    >
      {box}
    </Pressable>
  );
}

function Skeleton() {
  return (
    <View style={[styles.screen, styles.content]}>
      <View style={[styles.summary, styles.skeletonSummary]} />
      {[0, 1, 2, 3].map((index) => (
        <View key={index} style={[styles.card, styles.skeletonCard]}>
          <View style={styles.skeletonLine} />
          <View style={[styles.skeletonLine, styles.skeletonShort]} />
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: {
    padding: spacing.md,
    paddingBottom: spacing.xl * 2,
    gap: spacing.sm,
  },
  flex: { flex: 1 },
  center: { textAlign: 'center' },
  mutedText: { color: colors.muted },
  pressed: { backgroundColor: colors.surface },
  summary: {
    borderRadius: radii.lg,
    padding: spacing.md + 4,
    gap: spacing.md,
    marginBottom: spacing.sm,
  },
  summaryTop: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
  },
  of: { color: colors.muted, fontWeight: '500' },
  segments: { flexDirection: 'row', gap: 3, height: 10 },
  segment: { flex: 1, borderRadius: 3 },
  track: { overflow: 'hidden', borderRadius: radii.pill },
  bigTrack: { height: 10 },
  cardTrack: {
    height: 4,
    marginHorizontal: spacing.md,
    marginBottom: spacing.sm,
  },
  fill: { height: '100%', borderRadius: radii.pill },
  stats: { flexDirection: 'row', gap: spacing.md },
  stat: { flex: 1, gap: 2 },
  statHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  classLine: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  pills: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.xs },
  pill: {
    minHeight: 40,
    paddingHorizontal: spacing.md,
    borderRadius: radii.pill,
    borderWidth: 1,
    justifyContent: 'center',
  },
  pillText: { fontSize: 14, fontWeight: '600' },
  groupWrap: { gap: spacing.sm },
  eyebrow: { marginTop: spacing.sm, marginLeft: spacing.xs },
  card: {
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  cardHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: 52,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  lines: { paddingBottom: spacing.xs },
  line: { flexDirection: 'row', alignItems: 'center' },
  lineBody: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: 52,
    paddingVertical: spacing.sm,
    paddingRight: spacing.md,
  },
  checkSlot: {
    width: 52,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  box: {
    width: 24,
    height: 24,
    borderRadius: 7,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  hollow: { borderColor: colors.border, borderStyle: 'dashed' },
  bullet: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.border,
  },
  hidden: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    minHeight: 48,
  },
  empty: {
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.xl,
    paddingHorizontal: spacing.lg,
  },
  posts: { gap: spacing.sm, marginTop: spacing.md },
  skeletonSummary: { height: 168, backgroundColor: colors.surface },
  skeletonCard: {
    padding: spacing.md,
    gap: spacing.sm,
    borderColor: colors.surface,
  },
  skeletonLine: {
    height: 14,
    borderRadius: radii.sm,
    backgroundColor: colors.surface,
  },
  skeletonShort: { width: '45%' },
});
