import Ionicons from '@expo/vector-icons/Ionicons';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useMemo, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';

import { useAcademicEvents, useClasses, useExams } from '@/api/queries';
import type { AcademicEvent, ClassSession, Exam, SourceKind } from '@/api/types';
import { Loading } from '@/components/Loading';
import { SourceIssues } from '@/components/SourceIssues';
import { isIconName } from '@/components/SubjectIcon';
import { addDays, formatFullDate, formatTime, isoDate, startOfWeek } from '@/format';
import { editSubject, type Resolve, useSubjectResolver } from '@/subjects';
import { colors, spacing, text } from '@/theme';

const HOUR_HEIGHT = 88;
const HOURS_COLUMN = 56;
const DEFAULT_FIRST_HOUR = 8;
const DEFAULT_LAST_HOUR = 18;
const DAY_LABELS = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'];
const CALENDAR_RANGE_DAYS = 200;
const KIND_COLORS: Record<string, string> = {
  WYK: '#1565A8',
  CW: '#0B6E5A',
  KCW: '#0B6E5A',
  LAB: '#8A5A00',
  SEM: '#5B3F9E',
  EXAM: '#B3261E',
};
const FALLBACK_COLOR = '#4A4A50';

type Block = {
  key: string;
  title: string;
  code: string;
  color: string;
  icon: string | null;
  source: SourceKind;
  courseId: string;
  courseName: string;
  startsAt: Date;
  endsAt: Date;
  details: string[];
  column: number;
  columns: number;
};

export default function ScheduleScreen() {
  const today = new Date();
  const [weekStart, setWeekStart] = useState(() => startOfWeek(today));
  const [dayIndex, setDayIndex] = useState(() => Math.min((today.getDay() + 6) % 7, 4));
  const start = isoDate(weekStart);
  const end = isoDate(addDays(weekStart, 6));
  const calendarStart = isoDate(addDays(startOfWeek(today), -30));
  const calendarEnd = isoDate(addDays(startOfWeek(today), CALENDAR_RANGE_DAYS));

  const classes = useClasses(start, end);
  const resolve = useSubjectResolver();
  const exams = useExams();
  const events = useAcademicEvents(calendarStart, calendarEnd);

  const days = useMemo(() => {
    const weekend = [5, 6].filter((offset) =>
      [...(classes.data?.items ?? []), ...(exams.data?.items ?? [])].some(
        (item) => isoDate(new Date(item.starts_at)) === isoDate(addDays(weekStart, offset)),
      ),
    );
    return [0, 1, 2, 3, 4, ...weekend];
  }, [classes.data, exams.data, weekStart]);

  const selected = addDays(weekStart, days.includes(dayIndex) ? dayIndex : 0);
  const date = isoDate(selected);
  const blocks = useMemo(
    () => layout(toBlocks(date, classes.data?.items ?? [], exams.data?.items ?? [], resolve)),
    [date, classes.data, exams.data, resolve],
  );
  const dayEvents = (events.data?.items ?? []).filter((event) => event.starts_on <= date && date <= event.ends_on);

  const moveWeek = (weeks: number) => setWeekStart(addDays(weekStart, weeks * 7));
  const goToday = () => {
    setWeekStart(startOfWeek(today));
    setDayIndex(Math.min((today.getDay() + 6) % 7, 6));
  };
  const refresh = () => Promise.all([classes.refresh(), exams.refresh(), events.refresh()]).catch(() => undefined);

  return (
    <View style={styles.screen}>
      <View style={styles.weekBar}>
        <Pressable accessibilityLabel="Previous week" hitSlop={12} onPress={() => moveWeek(-1)}>
          <Ionicons name="chevron-back" size={22} color={colors.text} />
        </Pressable>
        <Pressable accessibilityLabel="Go to today" onPress={goToday}>
          <Text style={styles.weekTitle}>
            Week {formatFullDate(weekStart)}–{formatFullDate(addDays(weekStart, 6))}
          </Text>
        </Pressable>
        <Pressable accessibilityLabel="Next week" hitSlop={12} onPress={() => moveWeek(1)}>
          <Ionicons name="chevron-forward" size={22} color={colors.text} />
        </Pressable>
      </View>
      <View style={styles.dayTabs}>
        {days.map((offset) => {
          const isSelected = isoDate(addDays(weekStart, offset)) === date;
          const isToday = isoDate(addDays(weekStart, offset)) === isoDate(today);
          return (
            <Pressable
              key={offset}
              accessibilityRole="tab"
              accessibilityState={{ selected: isSelected }}
              onPress={() => setDayIndex(offset)}
              style={styles.dayTab}
            >
              <Text style={[styles.dayLabel, isSelected && styles.dayLabelSelected, isToday && styles.today]}>
                {DAY_LABELS[offset]}
              </Text>
              <Text style={[styles.dayNumber, isToday && styles.today]}>{addDays(weekStart, offset).getDate()}</Text>
              <View style={[styles.indicator, isSelected && styles.indicatorSelected]} />
            </Pressable>
          );
        })}
      </View>
      <SourceIssues sources={classes.data?.sources} />
      {classes.isLoading ? (
        <Loading />
      ) : (
        <ScrollView
          refreshControl={
            <RefreshControl
              refreshing={classes.refreshing || exams.refreshing || events.refreshing}
              onRefresh={refresh}
            />
          }
        >
          {dayEvents.map((event) => (
            <EventBanner key={`${event.name}-${event.starts_on}`} event={event} />
          ))}
          <DayGrid blocks={blocks} now={date === isoDate(today) ? today : null} />
        </ScrollView>
      )}
    </View>
  );
}

function EventBanner({ event }: { event: AcademicEvent }) {
  const range =
    event.starts_on === event.ends_on
      ? formatFullDate(event.starts_on)
      : `${formatFullDate(event.starts_on)}–${formatFullDate(event.ends_on)}`;
  return (
    <View style={styles.banner}>
      <Text style={text.title}>{event.name}</Text>
      <Text style={text.caption}>{range}</Text>
    </View>
  );
}

function DayGrid({ blocks, now }: { blocks: Block[]; now: Date | null }) {
  const [width, setWidth] = useState(0);
  const firstHour = Math.min(DEFAULT_FIRST_HOUR, ...blocks.map((block) => block.startsAt.getHours()));
  const lastHour = Math.max(
    DEFAULT_LAST_HOUR,
    ...blocks.map((block) => block.endsAt.getHours() + (block.endsAt.getMinutes() > 0 ? 1 : 0)),
  );
  const hours = Array.from({ length: lastHour - firstHour + 1 }, (_, index) => firstHour + index);
  const offset = (moment: Date) => (moment.getHours() - firstHour + moment.getMinutes() / 60) * HOUR_HEIGHT;
  const columnWidth = Math.max(width - HOURS_COLUMN - spacing.sm, 0);

  return (
    <View
      style={[styles.grid, { height: (hours.length - 1) * HOUR_HEIGHT + spacing.lg }]}
      onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
    >
      {hours.map((hour) => (
        <View key={hour} style={[styles.hourRow, { top: (hour - firstHour) * HOUR_HEIGHT }]}>
          <Text style={styles.hourLabel}>{hour}:00</Text>
          <View style={styles.hourLine} />
        </View>
      ))}
      <View style={styles.axis} />
      {blocks.map((block) => {
        const blockWidth = columnWidth / block.columns;
        return (
          <ClassBlock
            key={block.key}
            block={block}
            style={{
              top: offset(block.startsAt),
              height: Math.max(offset(block.endsAt) - offset(block.startsAt), 36),
              left: HOURS_COLUMN + block.column * blockWidth + 2,
              width: blockWidth - 4,
            }}
          />
        );
      })}
      {now && now.getHours() >= firstHour && now.getHours() < lastHour ? (
        <View style={[styles.nowLine, { top: offset(now) }]} />
      ) : null}
      {blocks.length === 0 ? <Text style={styles.free}>No classes</Text> : null}
    </View>
  );
}

function ClassBlock({ block, style }: { block: Block; style: object }) {
  const color = block.color;
  return (
    <Pressable
      accessibilityLabel={`Edit ${block.title}`}
      onPress={() => editSubject(block.source, block.courseId, block.courseName)}
      style={({ pressed }) => [styles.block, { borderColor: color }, style, pressed && styles.blockPressed]}
    >
      <View style={[styles.blockHeader, { backgroundColor: color }]}>
        <View style={styles.blockTopLine}>
          <Text style={styles.blockTime}>
            {formatTime(block.startsAt.toISOString())}–{formatTime(block.endsAt.toISOString())}
          </Text>
          <Text style={styles.blockCode}>{block.code}</Text>
        </View>
        <View style={styles.blockTitleLine}>
          {isIconName(block.icon) ? <MaterialCommunityIcons name={block.icon} size={16} color="#FFFFFF" /> : null}
          <Text style={styles.blockTitle} numberOfLines={2}>
            {block.title}
          </Text>
        </View>
      </View>
      <View style={styles.blockBody}>
        {block.details.map((line) => (
          <Text key={line} style={styles.blockDetail} numberOfLines={1}>
            {line}
          </Text>
        ))}
      </View>
    </Pressable>
  );
}

function toBlocks(date: string, classes: ClassSession[], exams: Exam[], resolve: Resolve): Block[] {
  const subject = (source: SourceKind, courseId: string, courseName: string, code: string) => {
    const look = resolve(source, courseId, courseName);
    return {
      title: look.name,
      code,
      color: look.color ?? KIND_COLORS[code] ?? FALLBACK_COLOR,
      icon: look.icon,
      source,
      courseId,
      courseName,
    };
  };
  const lessons = classes
    .filter((item) => isoDate(new Date(item.starts_at)) === date)
    .map((item) => ({
      key: `class-${item.course_id}-${item.starts_at}`,
      ...subject(item.source, item.course_id, item.course_name, item.kind_code ?? abbreviation(item.kind)),
      startsAt: new Date(item.starts_at),
      endsAt: new Date(item.ends_at),
      details: [item.address, [item.room && `room ${item.room}`, item.building].filter(Boolean).join(', ')].filter(
        (line): line is string => !!line,
      ),
      column: 0,
      columns: 1,
    }));
  const examBlocks = exams
    .filter((item) => isoDate(new Date(item.starts_at)) === date)
    .map((item) => ({
      key: `exam-${item.id}`,
      ...subject(item.source, item.course_id, item.course_name, 'EXAM'),
      startsAt: new Date(item.starts_at),
      endsAt: new Date(item.ends_at),
      details: [item.name, [item.room && `room ${item.room}`, item.building].filter(Boolean).join(', ')].filter(
        (line): line is string => !!line,
      ),
      column: 0,
      columns: 1,
    }));
  return [...lessons, ...examBlocks].sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
}

function layout(blocks: Block[]): Block[] {
  const result: Block[] = [];
  let cluster: Block[] = [];
  let clusterEnd = 0;
  const flush = () => {
    const columnEnds: number[] = [];
    const placed = cluster.map((block) => {
      const free = columnEnds.findIndex((endTime) => endTime <= block.startsAt.getTime());
      const column = free === -1 ? columnEnds.length : free;
      columnEnds[column] = block.endsAt.getTime();
      return { ...block, column };
    });
    result.push(...placed.map((block) => ({ ...block, columns: columnEnds.length })));
    cluster = [];
  };
  for (const block of blocks) {
    if (cluster.length > 0 && block.startsAt.getTime() >= clusterEnd) {
      flush();
    }
    cluster.push(block);
    clusterEnd = Math.max(cluster.length === 1 ? 0 : clusterEnd, block.endsAt.getTime());
  }
  if (cluster.length > 0) {
    flush();
  }
  return result;
}

function abbreviation(kind: string) {
  return kind
    .split(/\s+/)
    .map((word) => word[0]?.toUpperCase() ?? '')
    .join('')
    .slice(0, 4);
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  weekBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
  },
  weekTitle: { ...text.title, fontVariant: ['tabular-nums'] },
  dayTabs: {
    flexDirection: 'row',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  dayTab: { flex: 1, alignItems: 'center', paddingTop: spacing.xs },
  dayLabel: { fontSize: 15, fontWeight: '600', color: colors.muted },
  dayLabelSelected: { color: colors.text },
  dayNumber: { ...text.caption, marginTop: 2 },
  today: { color: colors.danger },
  indicator: { height: 3, alignSelf: 'stretch', marginHorizontal: spacing.md, marginTop: spacing.xs },
  indicatorSelected: { backgroundColor: colors.text },
  banner: {
    margin: spacing.md,
    marginBottom: 0,
    padding: spacing.md,
    borderRadius: 12,
    backgroundColor: colors.surface,
    gap: 2,
  },
  grid: { marginTop: spacing.md, marginRight: spacing.sm },
  hourRow: { position: 'absolute', left: 0, right: 0, flexDirection: 'row', alignItems: 'center' },
  hourLabel: { width: HOURS_COLUMN, textAlign: 'center', ...text.caption, transform: [{ translateY: -8 }] },
  hourLine: { flex: 1, height: StyleSheet.hairlineWidth, backgroundColor: colors.border },
  axis: {
    position: 'absolute',
    left: HOURS_COLUMN - 1,
    top: 0,
    bottom: 0,
    width: StyleSheet.hairlineWidth,
    backgroundColor: colors.border,
  },
  nowLine: { position: 'absolute', left: HOURS_COLUMN, right: 0, height: 2, backgroundColor: colors.danger },
  free: { position: 'absolute', top: HOUR_HEIGHT, left: HOURS_COLUMN, right: 0, textAlign: 'center', ...text.caption },
  block: { position: 'absolute', borderRadius: 6, borderWidth: 1, overflow: 'hidden', backgroundColor: colors.surface },
  blockHeader: { paddingHorizontal: spacing.sm, paddingVertical: spacing.xs + 2, gap: 2 },
  blockTopLine: { flexDirection: 'row', justifyContent: 'space-between' },
  blockTime: { fontSize: 13, color: '#FFFFFF', opacity: 0.9, fontVariant: ['tabular-nums'] },
  blockCode: { fontSize: 13, fontWeight: '700', color: '#FFFFFF' },
  blockPressed: { opacity: 0.8 },
  blockTitleLine: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  blockTitle: { flexShrink: 1, fontSize: 15, fontWeight: '600', color: '#FFFFFF' },
  blockBody: { paddingHorizontal: spacing.sm, paddingVertical: spacing.xs, gap: 1 },
  blockDetail: { fontSize: 13, color: colors.text },
});
