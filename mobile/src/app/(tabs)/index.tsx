import Ionicons from '@expo/vector-icons/Ionicons';
import { useMemo, useState } from 'react';
import { Pressable, RefreshControl, SectionList, StyleSheet, Text, View } from 'react-native';

import { useAcademicEvents, useClasses, useExams } from '@/api/queries';
import type { AcademicEvent, ClassSession, Exam } from '@/api/types';
import { EmptyState } from '@/components/EmptyState';
import { Loading } from '@/components/Loading';
import { Row, SectionHeader } from '@/components/Row';
import { SourceIssues } from '@/components/SourceIssues';
import { addDays, formatDay, formatShortDate, formatTime, isoDate, startOfWeek } from '@/format';
import { colors, spacing, text } from '@/theme';

type Entry = { type: 'class'; item: ClassSession } | { type: 'exam'; item: Exam };

type Day = {
  date: string;
  title: string;
  events: AcademicEvent[];
  data: Entry[];
};

const CALENDAR_RANGE_DAYS = 200;

export default function ScheduleScreen() {
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date()));
  const start = isoDate(weekStart);
  const end = isoDate(addDays(weekStart, 6));
  const calendarStart = isoDate(addDays(startOfWeek(new Date()), -30));
  const calendarEnd = isoDate(addDays(startOfWeek(new Date()), CALENDAR_RANGE_DAYS));

  const classes = useClasses(start, end);
  const exams = useExams();
  const events = useAcademicEvents(calendarStart, calendarEnd);

  const days = useMemo(
    () => buildWeek(weekStart, classes.data?.items ?? [], exams.data?.items ?? [], events.data?.items ?? []),
    [weekStart, classes.data, exams.data, events.data],
  );

  const refresh = () =>
    Promise.all([classes.refresh(), exams.refresh(), events.refresh()]).catch(() => undefined);

  return (
    <View style={styles.screen}>
      <View style={styles.weekBar}>
        <Pressable accessibilityLabel="Previous week" hitSlop={12} onPress={() => setWeekStart(addDays(weekStart, -7))}>
          <Ionicons name="chevron-back" size={22} color={colors.text} />
        </Pressable>
        <Pressable onPress={() => setWeekStart(startOfWeek(new Date()))}>
          <Text style={text.title}>
            {formatShortDate(weekStart)} – {formatShortDate(addDays(weekStart, 6))}
          </Text>
        </Pressable>
        <Pressable accessibilityLabel="Next week" hitSlop={12} onPress={() => setWeekStart(addDays(weekStart, 7))}>
          <Ionicons name="chevron-forward" size={22} color={colors.text} />
        </Pressable>
      </View>
      <SourceIssues sources={classes.data?.sources} />
      {classes.isLoading ? (
        <Loading />
      ) : (
        <SectionList
          sections={days}
          keyExtractor={(entry, index) => `${entry.type}-${entry.item.starts_at}-${index}`}
          stickySectionHeadersEnabled={false}
          refreshControl={
            <RefreshControl
              refreshing={classes.refreshing || exams.refreshing || events.refreshing}
              onRefresh={refresh}
            />
          }
          renderSectionHeader={({ section }) => (
            <View>
              <SectionHeader title={section.title} />
              {section.events.map((event) => (
                <Text key={`${event.name}-${event.starts_on}`} style={styles.event}>
                  {event.name}
                </Text>
              ))}
              {section.data.length === 0 && section.events.length === 0 ? (
                <Text style={styles.free}>No classes</Text>
              ) : null}
            </View>
          )}
          renderItem={({ item: entry }) =>
            entry.type === 'class' ? <ClassRow session={entry.item} /> : <ExamRow exam={entry.item} />
          }
          ListEmptyComponent={<EmptyState title="Nothing this week" />}
        />
      )}
    </View>
  );
}

function ClassRow({ session }: { session: ClassSession }) {
  const place = [session.room, session.building].filter(Boolean).join(', ');
  return (
    <Row
      title={session.course_name}
      subtitle={[session.kind, place].filter(Boolean).join(' · ')}
      detail={`${formatTime(session.starts_at)}\n${formatTime(session.ends_at)}`}
    />
  );
}

function ExamRow({ exam }: { exam: Exam }) {
  const place = [exam.room, exam.building].filter(Boolean).join(', ');
  return (
    <Row
      title={`Exam · ${exam.course_name}`}
      subtitle={[exam.name, place].filter(Boolean).join(' · ')}
      detail={`${formatTime(exam.starts_at)}\n${formatTime(exam.ends_at)}`}
    />
  );
}

function buildWeek(weekStart: Date, classes: ClassSession[], exams: Exam[], events: AcademicEvent[]): Day[] {
  return Array.from({ length: 7 }, (_, offset) => {
    const date = isoDate(addDays(weekStart, offset));
    const entries: Entry[] = [
      ...classes.filter((item) => isoDate(new Date(item.starts_at)) === date).map((item) => ({ type: 'class' as const, item })),
      ...exams.filter((item) => isoDate(new Date(item.starts_at)) === date).map((item) => ({ type: 'exam' as const, item })),
    ].sort((a, b) => a.item.starts_at.localeCompare(b.item.starts_at));
    return {
      date,
      title: formatDay(addDays(weekStart, offset)),
      events: events.filter((event) => event.starts_on <= date && date <= event.ends_on),
      data: entries,
    };
  }).filter((day, index) => index < 5 || day.data.length > 0 || day.events.length > 0);
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  weekBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  event: {
    ...text.body,
    marginHorizontal: spacing.md,
    marginBottom: spacing.sm,
    padding: spacing.sm,
    borderRadius: 8,
    backgroundColor: colors.surface,
  },
  free: { ...text.caption, paddingHorizontal: spacing.md, paddingBottom: spacing.sm },
});
