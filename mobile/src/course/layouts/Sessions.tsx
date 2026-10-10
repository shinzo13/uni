import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { router } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Animated, FlatList, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';

import type { Assignment, ClassSession, CourseRef } from '@/api/types';
import { EmptyState } from '@/components/EmptyState';
import { PostCard } from '@/components/PostCard';
import {
  type CourseLayoutProps,
  type MaterialCourse,
  type PlacedItem,
  useOpeners,
  useTermClasses,
} from '@/course/data';
import { ItemRow } from '@/course/ItemRow';
import { isNewSince, isVisibleItem } from '@/course/items';
import { formatDay, formatShortDate, formatTime, isoDate, relativeDue, startOfWeek } from '@/format';
import { refKey } from '@/subjects';
import { colors, radii, spacing, tinted, type } from '@/theme';
import { useNow } from '@/useNow';

type Meeting = {
  key: string;
  session: ClassSession;
  code: string;
  number: number;
  week: number;
  day: string;
  shortDate: string;
};

type Group = { key: string; title: string; items: PlacedItem[] };

type Matching = {
  byMeeting: Map<string, Group[]>;
  general: Group[];
  matched: number;
};

type Parsed = {
  kind: string | null;
  number: number | null;
  week: boolean;
  date: string | null;
};

const KIND_NAMES: Record<string, string> = {
  WYK: 'Lecture',
  CW: 'Classes',
  KCW: 'Computer lab',
  LAB: 'Laboratory',
  SEM: 'Seminar',
  KON: 'Consultations',
  PRO: 'Project',
  LEK: 'Language class',
};

const KIND_PATTERNS: [RegExp, string][] = [
  [/sali komp|komputer|\bkcw\b|computer lab/i, 'KCW'],
  [/laborat|\blab(?![a-z])/i, 'LAB'],
  [/ćw|cwicz|\bcw\b|exercise|tutorial/i, 'CW'],
  [/wykład|wyklad|lecture/i, 'WYK'],
  [/seminar/i, 'SEM'],
];

const PRACTICAL = ['KCW', 'CW', 'LAB'];

const KEYWORD_NUMBER =
  /(?:wykład|wyklad|lecture|ćwiczenia|cwiczenia|ćw\.?|laboratorium|lab|tydzień|tydzien|week|moduł|modul|module|zajęcia|zajecia|spotkanie|meeting|session|topic|temat|nr\.?|no\.)\s*(?:nr\.?\s*)?0?(\d{1,2})(?!\d)/i;
const KEYWORD_ROMAN =
  /(?:[Ww]ykład|[Ww]yklad|[Ll]ecture|[Ćć]wiczenia|[Ll]ab\w*|[Tt]ydzień|[Ww]eek|[Mm]oduł|[Mm]odule|[Zz]ajęcia|[Tt]emat|nr\.?)\s+([IVXLC]{1,6})(?![A-Za-z])/;
const TASK_NUMBER =
  /(?:quiz|test|zadani\w*|lista|sprawdz\w*|kartkówka|notatnik|projekt|task|exercise|assignment)\D{0,24}?0?(\d{1,2})(?!\d)/i;
const LEADING_NUMBER = /^\s*0?(\d{1,2})(?:[.):-]|\s)(?!\d)/;
const TRAILING_NUMBER = /\s0?(\d{1,2})\s*$/;
const DATE = /(?:^|\D)(\d{1,2})[./](\d{1,2})(?:[./]\d{2,4})?(?!\d)/;
const WEEKLY = /tydzień|tydzien|week/i;
const WEEK_MS = 7 * 24 * 3_600_000;
const SHORT_WEEKDAY = new Intl.DateTimeFormat('en-GB', { weekday: 'short' });
const POSTS_PREVIEW = 3;

function romanValue(roman: string) {
  const values: Record<string, number> = { I: 1, V: 5, X: 10, L: 50, C: 100 };
  return [...roman].reduce(
    (total, letter, position) =>
      values[letter] < (values[roman[position + 1]] ?? 0) ? total - values[letter] : total + values[letter],
    0,
  );
}

function kindOf(text: string | null) {
  if (!text) return null;
  return KIND_PATTERNS.find(([pattern]) => pattern.test(text))?.[1] ?? null;
}

function parseTitle(title: string, loose: boolean): Parsed {
  const date = title.match(DATE);
  const day = date ? Number(date[1]) : 0;
  const month = date ? Number(date[2]) : 0;
  const validDate = day >= 1 && day <= 31 && month >= 1 && month <= 12;
  const keyword = title.match(KEYWORD_NUMBER)?.[1];
  const roman = title.match(KEYWORD_ROMAN)?.[1];
  const loosely = loose
    ? (title.match(TASK_NUMBER)?.[1] ?? title.match(LEADING_NUMBER)?.[1] ?? title.match(TRAILING_NUMBER)?.[1])
    : undefined;
  const value = keyword ? Number(keyword) : roman ? romanValue(roman) : loosely ? Number(loosely) : null;
  return {
    kind: kindOf(title),
    number: value && value > 0 && value < 40 ? value : null,
    week: WEEKLY.test(title),
    date: validDate ? `${String(day).padStart(2, '0')}.${String(month).padStart(2, '0')}` : null,
  };
}

function resolveKind(kind: string | null, codes: string[]) {
  if (!kind) return codes.length === 1 ? codes[0] : null;
  if (codes.includes(kind)) return kind;
  if (PRACTICAL.includes(kind)) return PRACTICAL.find((code) => codes.includes(code)) ?? null;
  return null;
}

function buildMeetings(sessions: ClassSession[], refs: CourseRef[]): Meeting[] {
  const members = new Set(refs.map((ref) => refKey(ref.source, ref.course_id)));
  const unique = new Map<string, ClassSession>();
  sessions
    .filter((session) => members.has(refKey(session.source, session.course_id)))
    .forEach((session) => unique.set(`${session.starts_at}|${session.kind_code ?? session.kind}`, session));
  const sorted = [...unique.entries()].sort(([, a], [, b]) => Date.parse(a.starts_at) - Date.parse(b.starts_at));
  if (sorted.length === 0) return [];
  const firstWeek = startOfWeek(new Date(sorted[0][1].starts_at)).getTime();
  const counters = new Map<string, number>();
  return sorted.map(([key, session]) => {
    const code = (session.kind_code ?? session.kind.slice(0, 3)).toUpperCase();
    const number = (counters.get(code) ?? 0) + 1;
    counters.set(code, number);
    const start = new Date(session.starts_at);
    return {
      key,
      session,
      code,
      number,
      week: Math.round((startOfWeek(start).getTime() - firstWeek) / WEEK_MS) + 1,
      day: isoDate(start),
      shortDate: formatShortDate(start),
    };
  });
}

function targetsFor(parsed: Parsed, fallbackKind: string | null, meetings: Meeting[], codes: string[]) {
  if (parsed.date) {
    const sameDay = meetings.filter((meeting) => meeting.shortDate === parsed.date);
    const kind = resolveKind(parsed.kind ?? fallbackKind, codes);
    const exact = sameDay.filter((meeting) => meeting.code === kind);
    if (exact.length > 0) return exact.slice(0, 1);
    return sameDay.slice(0, 1);
  }
  if (parsed.number === null) return [];
  const kind = resolveKind(parsed.kind ?? fallbackKind, codes);
  if (parsed.week) {
    return meetings.filter((meeting) => meeting.week === parsed.number && (!kind || meeting.code === kind));
  }
  if (!kind) return [];
  const meeting = meetings.find((candidate) => candidate.code === kind && candidate.number === parsed.number);
  return meeting ? [meeting] : [];
}

function dominantKind(course: MaterialCourse) {
  const counts = new Map<string, number>();
  course.sections.forEach((section) => {
    const kind = kindOf(section.title);
    if (kind) counts.set(kind, (counts.get(kind) ?? 0) + 1);
  });
  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  return ranked.length === 1 || (ranked.length > 1 && ranked[0][1] > ranked[1][1]) ? ranked[0][0] : null;
}

function matchSections(moodle: MaterialCourse[], meetings: Meeting[]): Matching {
  const codes = [...new Set(meetings.map((meeting) => meeting.code))];
  const byMeeting = new Map<string, Group[]>();
  const general: Group[] = [];
  let matched = 0;
  const attach = (meeting: Meeting, key: string, title: string, items: PlacedItem[]) => {
    const groups = byMeeting.get(meeting.key) ?? [];
    const existing = groups.find((group) => group.key === key);
    if (existing) existing.items.push(...items);
    else groups.push({ key, title, items: [...items] });
    byMeeting.set(meeting.key, groups);
  };
  moodle.forEach((course) => {
    const courseKind = kindOf(course.detail) ?? dominantKind(course);
    course.sections.forEach((section) => {
      const placed = section.items
        .filter(isVisibleItem)
        .map((item) => ({ item, section, courseId: course.courseId, source: course.source }));
      if (placed.length === 0) return;
      const key = `${course.courseId}:${section.id}`;
      const sectionKind = kindOf(section.title);
      const targets =
        meetings.length > 0 ? targetsFor(parseTitle(section.title, true), courseKind, meetings, codes) : [];
      if (targets.length > 0) {
        targets.forEach((meeting) => attach(meeting, key, section.title, placed));
        matched += placed.length;
        return;
      }
      const rest: PlacedItem[] = [];
      placed.forEach((entry) => {
        const parsed = parseTitle(entry.item.title, !!sectionKind);
        const itemTargets =
          meetings.length > 0 && parsed.number !== null
            ? targetsFor({ ...parsed, date: null }, sectionKind ?? courseKind, meetings, codes)
            : [];
        if (itemTargets.length > 0) {
          itemTargets.forEach((meeting) => attach(meeting, key, section.title, [entry]));
          matched += 1;
        } else {
          rest.push(entry);
        }
      });
      if (rest.length > 0) general.push({ key, title: section.title, items: rest });
    });
  });
  return { byMeeting, general, matched };
}

function dayDistance(from: number, to: string) {
  const start = new Date(from);
  const startDay = new Date(start.getFullYear(), start.getMonth(), start.getDate()).getTime();
  const target = new Date(to);
  const targetDay = new Date(target.getFullYear(), target.getMonth(), target.getDate()).getTime();
  return Math.round((targetDay - startDay) / (24 * 3_600_000));
}

function whenLabel(meeting: Meeting, now: number) {
  const { starts_at, ends_at } = meeting.session;
  const start = new Date(starts_at).getTime();
  if (start <= now && new Date(ends_at).getTime() > now) return 'Happening now';
  const days = dayDistance(now, starts_at);
  if (days === 0) return start > now ? 'Today' : 'Earlier today';
  if (days === 1) return 'Tomorrow';
  if (days === -1) return 'Yesterday';
  if (days > 1) return days < 14 ? `In ${days} days` : `In ${Math.round(days / 7)} weeks`;
  return -days < 14 ? `${-days} days ago` : `${Math.round(-days / 7)} weeks ago`;
}

function placeLine(session: ClassSession) {
  return [session.room, session.building].filter(Boolean).join(' · ');
}

function isOpen(assignment: Assignment) {
  return assignment.status === 'new' || assignment.status === 'draft' || assignment.status === 'unknown';
}

function openAssignment(assignment: Assignment) {
  router.push({ pathname: '/assignment/[id]', params: { id: assignment.id, source: assignment.source } });
}

export function SessionsLayout({ data }: CourseLayoutProps) {
  const { look } = data;
  const tint = look.tint;
  const term = useTermClasses(data.look);
  const now = useNow();
  const openers = useOpeners(data.assignments);
  const [mode, setMode] = useState<'focus' | 'all'>('focus');
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [generalOpen, setGeneralOpen] = useState(false);
  const [allPosts, setAllPosts] = useState(false);

  const meetings = useMemo(() => buildMeetings(term.data?.items ?? [], look.courses), [term.data, look.courses]);
  const matching = useMemo(() => matchSections(data.materials, meetings), [data.materials, meetings]);
  const nextIndex = useMemo(() => {
    const index = meetings.findIndex((meeting) => new Date(meeting.session.ends_at).getTime() > now);
    return index === -1 ? meetings.length - 1 : index;
  }, [meetings, now]);
  const selectedIndex = Math.max(
    0,
    selectedKey ? meetings.findIndex((meeting) => meeting.key === selectedKey) : nextIndex,
  );
  const selected = meetings[selectedIndex] ?? null;
  const selectedGroups = useMemo(
    () => (selected ? (matching.byMeeting.get(selected.key) ?? []) : []),
    [selected, matching],
  );

  const dueWindow = useMemo(() => {
    if (!selected) return [];
    const from = Date.parse(selected.session.starts_at);
    const following = meetings[selectedIndex + 1];
    const until = following ? Date.parse(following.session.starts_at) : null;
    const shown = new Set(
      selectedGroups.flatMap((group) => group.items.map((entry) => `${entry.courseId}|${entry.item.title}`)),
    );
    return data.assignments
      .filter((assignment) => {
        const due = assignment.due_at ? Date.parse(assignment.due_at) : null;
        return due !== null && due >= from && (until === null || due < until);
      })
      .filter(
        (assignment) => !(assignment.source === 'moodle' && shown.has(`${assignment.course_id}|${assignment.title}`)),
      )
      .sort((a, b) => (a.due_at ?? '').localeCompare(b.due_at ?? ''));
  }, [selected, selectedIndex, selectedGroups, meetings, data.assignments]);

  const openTasks = useMemo(() => {
    const inWindow = new Set(
      mode === 'focus' ? dueWindow.map((assignment) => `${assignment.source}:${assignment.id}`) : [],
    );
    return data.assignments
      .filter(
        (assignment) =>
          isOpen(assignment) &&
          !inWindow.has(`${assignment.source}:${assignment.id}`) &&
          (!assignment.due_at || new Date(assignment.due_at).getTime() > now),
      )
      .sort((a, b) => (a.due_at ?? '9999').localeCompare(b.due_at ?? '9999'));
  }, [data.assignments, dueWindow, mode, now]);

  const hasMoodle = data.materials.length > 0;
  const hasSections = matching.general.length > 0 || matching.matched > 0;
  const unmatched = meetings.length > 0 && hasMoodle && !data.isLoading && matching.matched === 0 && hasSections;
  const plainSections = meetings.length === 0 || matching.matched === 0;
  const posts = allPosts ? data.posts : data.posts.slice(0, POSTS_PREVIEW);
  const refreshing = data.refreshing || term.refreshing;
  const onRefresh = () => {
    Promise.all([data.refresh(), term.refresh()]).catch(() => undefined);
  };

  const nothing =
    !data.isLoading &&
    !term.isLoading &&
    meetings.length === 0 &&
    !hasSections &&
    data.posts.length === 0 &&
    data.assignments.length === 0;

  const renderItems = (groups: Group[]) =>
    groups.map((group) => (
      <View key={group.key} style={styles.group}>
        <Text style={styles.groupTitle} numberOfLines={2}>
          {group.title}
        </Text>
        {group.items.map((entry) => {
          const assignment = openers.findAssignment(entry);
          return (
            <ItemRow
              key={`${entry.courseId}:${entry.item.id}`}
              placed={entry}
              tint={tint}
              isNew={isNewSince(entry.item, data.lastSeen)}
              caption={
                assignment?.due_at
                  ? `Due ${formatShortDate(assignment.due_at)} · ${formatTime(assignment.due_at)}`
                  : null
              }
              onOpen={openers.openItem}
              onOpenAttachment={(attachment) => {
                openers.openAttachment(attachment).catch(() => undefined);
              }}
            />
          );
        })}
      </View>
    ));

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[tint]} tintColor={tint} />}
    >
      {nothing ? (
        <View style={styles.empty}>
          <EmptyState
            title="Nothing here yet"
            hint="Classes appear once the subject is linked with USOS; materials appear when the teacher publishes them."
          />
        </View>
      ) : null}

      {term.isLoading ? <SkeletonStrip /> : null}

      {!term.isLoading && meetings.length > 0 ? (
        <View style={styles.head}>
          <View style={styles.headText}>
            <Text style={styles.overline}>Semester classes</Text>
            <Text style={type.caption}>{kindSummary(meetings)}</Text>
          </View>
          <View style={styles.toggle}>
            {(['focus', 'all'] as const).map((value) => (
              <Pressable
                key={value}
                onPress={() => setMode(value)}
                accessibilityRole="button"
                accessibilityState={{ selected: mode === value }}
                style={[styles.toggleOption, mode === value && { backgroundColor: tint }]}
              >
                <Text style={[styles.toggleText, mode === value && styles.toggleTextActive]}>
                  {value === 'focus' ? 'Class' : 'All sessions'}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>
      ) : null}

      {!term.isLoading && meetings.length > 0 && mode === 'focus' && selected ? (
        <>
          <MeetingStrip
            meetings={meetings}
            selectedIndex={selectedIndex}
            nextIndex={nextIndex}
            now={now}
            tint={tint}
            matched={matching.byMeeting}
            onSelect={(meeting) => setSelectedKey(meeting.key)}
          />
          <View style={[styles.card, { borderColor: tinted(tint, 0.28) }]}>
            <View style={styles.cardHead}>
              <View style={[styles.badge, { backgroundColor: tinted(tint, 0.14) }]}>
                <Text style={[styles.badgeText, { color: tint }]}>
                  {selected.code} {selected.number}
                </Text>
              </View>
              <Text style={[styles.when, selectedIndex === nextIndex && { color: tint }]}>
                {whenLabel(selected, now)}
              </Text>
            </View>
            <View style={styles.cardTitle}>
              <Text style={type.headline}>{formatDay(selected.session.starts_at)}</Text>
              <Text style={type.body}>
                {formatTime(selected.session.starts_at)}–{formatTime(selected.session.ends_at)} ·{' '}
                {KIND_NAMES[selected.code] ?? selected.session.kind}
                {selected.session.group_number ? ` · group ${selected.session.group_number}` : ''}
              </Text>
            </View>
            {placeLine(selected.session) || selected.session.address ? (
              <View style={styles.place}>
                <MaterialCommunityIcons name="map-marker-outline" size={18} color={colors.muted} />
                <View style={styles.flex}>
                  {placeLine(selected.session) ? <Text style={type.body}>{placeLine(selected.session)}</Text> : null}
                  {selected.session.address ? <Text style={type.caption}>{selected.session.address}</Text> : null}
                </View>
              </View>
            ) : null}
            <View style={styles.cardBody}>
              {data.isLoading ? <SkeletonRows /> : renderItems(selectedGroups)}
              {!data.isLoading && hasMoodle && selectedGroups.length === 0 && !unmatched ? (
                <Text style={styles.hint}>No materials matched to this class yet.</Text>
              ) : null}
              {dueWindow.length > 0 ? (
                <View style={styles.group}>
                  <Text style={styles.groupTitle}>Due before the next class</Text>
                  {dueWindow.map((assignment) => (
                    <AssignmentRow
                      key={`${assignment.source}:${assignment.id}`}
                      assignment={assignment}
                      tint={tint}
                      now={now}
                    />
                  ))}
                </View>
              ) : null}
            </View>
          </View>
        </>
      ) : null}

      {!term.isLoading && meetings.length > 0 && mode === 'all' ? (
        <Timeline
          meetings={meetings}
          nextIndex={nextIndex}
          now={now}
          tint={tint}
          matched={matching.byMeeting}
          renderItems={renderItems}
          onFocus={(meeting) => {
            setSelectedKey(meeting.key);
            setMode('focus');
          }}
        />
      ) : null}

      {!term.isLoading && meetings.length === 0 && !nothing ? (
        <View style={styles.notice}>
          <MaterialCommunityIcons name="calendar-blank-outline" size={20} color={colors.muted} />
          <Text style={[type.caption, styles.flex]}>
            No classes in the USOS timetable for this subject this semester.
          </Text>
        </View>
      ) : null}

      {unmatched ? (
        <View style={styles.notice}>
          <MaterialCommunityIcons name="link-variant-off" size={20} color={colors.muted} />
          <Text style={[type.caption, styles.flex]}>Couldn&apos;t match materials to classes — showing sections.</Text>
        </View>
      ) : null}

      {data.isLoading && (meetings.length === 0 || mode === 'all') ? <SkeletonRows /> : null}

      {!data.isLoading && matching.general.length > 0 ? (
        plainSections ? (
          <View style={styles.block}>
            <Text style={[styles.overline, styles.blockTitle]}>Sections</Text>
            {renderItems(matching.general)}
          </View>
        ) : (
          <View style={styles.block}>
            <Pressable
              onPress={() => setGeneralOpen(!generalOpen)}
              style={({ pressed }) => [styles.disclosure, pressed && styles.pressed]}
              accessibilityRole="button"
              accessibilityState={{ expanded: generalOpen }}
            >
              <View style={[styles.disclosureIcon, { backgroundColor: tinted(tint, 0.12) }]}>
                <MaterialCommunityIcons name="information-outline" size={20} color={tint} />
              </View>
              <View style={styles.flex}>
                <Text style={type.title}>General</Text>
                <Text style={type.caption} numberOfLines={1}>
                  {matching.general.map((group) => group.title).join(' · ')}
                </Text>
              </View>
              <MaterialCommunityIcons
                name={generalOpen ? 'chevron-up' : 'chevron-down'}
                size={22}
                color={colors.muted}
              />
            </Pressable>
            {generalOpen ? renderItems(matching.general) : null}
          </View>
        )
      ) : null}

      {openTasks.length > 0 ? (
        <View style={styles.block}>
          <Text style={[styles.overline, styles.blockTitle]}>
            {mode === 'focus' && selected ? 'Later tasks' : 'Open tasks'}
          </Text>
          {openTasks.map((assignment) => (
            <AssignmentRow
              key={`${assignment.source}:${assignment.id}`}
              assignment={assignment}
              tint={tint}
              now={now}
            />
          ))}
        </View>
      ) : null}

      {data.posts.length > 0 ? (
        <View style={styles.block}>
          <Text style={[styles.overline, styles.blockTitle]}>Posts</Text>
          {posts.map((post) => (
            <PostCard key={`${post.source}:${post.id}`} post={post} tint={tint} compact />
          ))}
          {data.posts.length > POSTS_PREVIEW ? (
            <Pressable onPress={() => setAllPosts(!allPosts)} style={styles.more} accessibilityRole="button">
              <Text style={[styles.moreText, { color: tint }]}>
                {allPosts ? 'Show fewer posts' : `Show all ${data.posts.length} posts`}
              </Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
    </ScrollView>
  );
}

function kindSummary(meetings: Meeting[]) {
  const counts = new Map<string, number>();
  meetings.forEach((meeting) => counts.set(meeting.code, (counts.get(meeting.code) ?? 0) + 1));
  return [...counts.entries()].map(([code, count]) => `${count} × ${KIND_NAMES[code] ?? code}`).join(' · ');
}

const CHIP_WIDTH = 96;
const CHIP_GAP = spacing.sm;

type StripProps = {
  meetings: Meeting[];
  selectedIndex: number;
  nextIndex: number;
  now: number;
  tint: string;
  matched: Map<string, Group[]>;
  onSelect: (meeting: Meeting) => void;
};

function MeetingStrip({ meetings, selectedIndex, nextIndex, now, tint, matched, onSelect }: StripProps) {
  const today = isoDate(new Date(now));
  return (
    <FlatList
      horizontal
      data={meetings}
      keyExtractor={(meeting) => meeting.key}
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.strip}
      initialScrollIndex={Math.max(0, selectedIndex - 1)}
      getItemLayout={(_, index) => ({
        length: CHIP_WIDTH + CHIP_GAP,
        offset: (CHIP_WIDTH + CHIP_GAP) * index,
        index,
      })}
      renderItem={({ item: meeting, index }) => {
        const selected = index === selectedIndex;
        const next = index === nextIndex && new Date(meeting.session.ends_at).getTime() > now;
        const past = new Date(meeting.session.ends_at).getTime() <= now;
        const isToday = meeting.day === today;
        const hasMaterials = (matched.get(meeting.key)?.length ?? 0) > 0;
        const foreground = selected ? colors.background : past ? colors.muted : next ? tint : colors.text;
        return (
          <Pressable
            onPress={() => onSelect(meeting)}
            accessibilityRole="button"
            accessibilityState={{ selected }}
            accessibilityLabel={`${meeting.code} ${meeting.number}, ${formatDay(meeting.session.starts_at)}`}
            style={[
              styles.chip,
              past && styles.chipPast,
              next && { backgroundColor: tinted(tint, 0.1), borderColor: tint },
              selected && { backgroundColor: tint, borderColor: tint },
            ]}
          >
            <View style={styles.chipTop}>
              <Text style={[styles.chipCode, { color: foreground }]}>
                {meeting.code} {meeting.number}
              </Text>
              {hasMaterials ? (
                <View
                  style={[
                    styles.chipDot,
                    { backgroundColor: selected ? colors.background : past ? colors.muted : tint },
                  ]}
                />
              ) : null}
            </View>
            <Text style={[styles.chipDate, { color: foreground }]}>
              {isToday ? 'Today' : SHORT_WEEKDAY.format(new Date(meeting.session.starts_at))} · {meeting.shortDate}
            </Text>
          </Pressable>
        );
      }}
    />
  );
}

type TimelineProps = {
  meetings: Meeting[];
  nextIndex: number;
  now: number;
  tint: string;
  matched: Map<string, Group[]>;
  renderItems: (groups: Group[]) => React.ReactNode;
  onFocus: (meeting: Meeting) => void;
};

function Timeline({ meetings, nextIndex, now, tint, matched, renderItems, onFocus }: TimelineProps) {
  const [open, setOpen] = useState<Set<string>>(() => new Set());
  const toggle = (key: string) => {
    const nextOpen = new Set(open);
    if (nextOpen.has(key)) nextOpen.delete(key);
    else nextOpen.add(key);
    setOpen(nextOpen);
  };
  return (
    <View style={styles.timeline}>
      {meetings.map((meeting, index) => {
        const groups = matched.get(meeting.key) ?? [];
        const count = groups.reduce((total, group) => total + group.items.length, 0);
        const past = new Date(meeting.session.ends_at).getTime() <= now;
        const next = index === nextIndex && !past;
        const expanded = open.has(meeting.key);
        return (
          <View key={meeting.key} style={styles.timelineRow}>
            <View style={styles.rail}>
              <View
                style={[
                  styles.railLine,
                  index === 0 && styles.railFirst,
                  index === meetings.length - 1 && (index === 0 ? styles.railNone : styles.railLast),
                ]}
              />
              <View
                style={[
                  styles.railDot,
                  past ? styles.railDotPast : { borderColor: tint },
                  next && { backgroundColor: tint, width: 14, height: 14, borderRadius: 7 },
                ]}
              />
            </View>
            <View style={[styles.timelineBody, next && { backgroundColor: tinted(tint, 0.08) }]}>
              <Pressable
                onPress={() => (count > 0 ? toggle(meeting.key) : onFocus(meeting))}
                onLongPress={() => onFocus(meeting)}
                style={styles.timelineHead}
                accessibilityRole="button"
                accessibilityState={count > 0 ? { expanded } : undefined}
              >
                <View style={styles.flex}>
                  <Text style={[type.title, past && styles.mutedText, next && { color: tint }]}>
                    {meeting.code} {meeting.number}
                    {next ? <Text style={type.caption}>{'  '}Next</Text> : null}
                  </Text>
                  <Text style={type.caption} numberOfLines={1}>
                    {SHORT_WEEKDAY.format(new Date(meeting.session.starts_at))} {meeting.shortDate} ·{' '}
                    {formatTime(meeting.session.starts_at)}
                    {placeLine(meeting.session) ? ` · ${placeLine(meeting.session)}` : ''}
                  </Text>
                </View>
                {count > 0 ? (
                  <View style={styles.count}>
                    <Text style={[styles.countText, { color: past ? colors.muted : tint }]}>{count}</Text>
                    <MaterialCommunityIcons
                      name={expanded ? 'chevron-up' : 'chevron-down'}
                      size={20}
                      color={colors.muted}
                    />
                  </View>
                ) : (
                  <MaterialCommunityIcons name="chevron-right" size={20} color={colors.border} />
                )}
              </Pressable>
              {expanded ? <View style={styles.timelineItems}>{renderItems(groups)}</View> : null}
            </View>
          </View>
        );
      })}
    </View>
  );
}

function AssignmentRow({ assignment, tint, now }: { assignment: Assignment; tint: string; now: number }) {
  const done = !isOpen(assignment);
  const overdue = !done && !!assignment.due_at && new Date(assignment.due_at).getTime() < now;
  const caption = [
    assignment.due_at
      ? `Due ${formatShortDate(assignment.due_at)} ${formatTime(assignment.due_at)} · ${relativeDue(assignment.due_at, new Date(now))}`
      : 'No deadline',
    assignment.grade ?? (assignment.status === 'submitted' ? 'Submitted' : null),
  ]
    .filter(Boolean)
    .join(' · ');
  return (
    <Pressable
      onPress={() => openAssignment(assignment)}
      style={({ pressed }) => [styles.taskRow, pressed && styles.pressed]}
      accessibilityRole="button"
      accessibilityLabel={assignment.title}
    >
      <View style={[styles.taskIcon, { backgroundColor: tinted(done ? colors.success : tint, 0.12) }]}>
        <MaterialCommunityIcons
          name={done ? 'check' : assignment.kind === 'quiz' ? 'help-circle-outline' : 'clipboard-check-outline'}
          size={20}
          color={done ? colors.success : tint}
        />
      </View>
      <View style={styles.flex}>
        <Text style={type.body} numberOfLines={2}>
          {assignment.title}
        </Text>
        <Text style={[type.caption, overdue && { color: colors.danger }]} numberOfLines={1}>
          {caption}
        </Text>
      </View>
    </Pressable>
  );
}

function usePulse() {
  const [opacity] = useState(() => new Animated.Value(0.5));
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 1, duration: 700, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0.5, duration: 700, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [opacity]);
  return opacity;
}

function SkeletonStrip() {
  const opacity = usePulse();
  return (
    <Animated.View style={[styles.strip, styles.skeletonStrip, { opacity }]}>
      {[0, 1, 2, 3].map((index) => (
        <View key={index} style={[styles.chip, styles.skeletonChip]} />
      ))}
    </Animated.View>
  );
}

function SkeletonRows() {
  const opacity = usePulse();
  return (
    <Animated.View style={[styles.skeletonRows, { opacity }]}>
      {[0, 1, 2].map((index) => (
        <View key={index} style={styles.skeletonRow}>
          <View style={styles.skeletonGlyph} />
          <View style={styles.flex}>
            <View style={[styles.skeletonLine, { width: `${70 - index * 15}%` }]} />
            <View style={[styles.skeletonLine, styles.skeletonShort]} />
          </View>
        </View>
      ))}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { paddingTop: spacing.sm, paddingBottom: spacing.xl },
  flex: { flex: 1 },
  empty: { minHeight: 320 },
  pressed: { backgroundColor: colors.surface },
  mutedText: { color: colors.muted },
  overline: { ...type.label, textTransform: 'uppercase' },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm,
  },
  headText: { flex: 1, gap: 2 },
  toggle: { flexDirection: 'row', backgroundColor: colors.surface, borderRadius: radii.pill, padding: 3 },
  toggleOption: {
    minHeight: 40,
    paddingHorizontal: spacing.md,
    borderRadius: radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  toggleText: { ...type.label, color: colors.text },
  toggleTextActive: { color: colors.background },
  strip: { paddingHorizontal: spacing.md, paddingVertical: spacing.xs, gap: CHIP_GAP },
  skeletonStrip: { flexDirection: 'row', marginTop: spacing.xl },
  chip: {
    width: CHIP_WIDTH,
    minHeight: 56,
    paddingHorizontal: spacing.sm + 2,
    paddingVertical: spacing.sm,
    borderRadius: radii.md,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.background,
    justifyContent: 'center',
    gap: 2,
  },
  chipPast: { backgroundColor: colors.surface, borderColor: colors.surface },
  chipTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  chipCode: { fontSize: 15, lineHeight: 20, fontWeight: '700' },
  chipDot: { width: 6, height: 6, borderRadius: 3 },
  chipDate: { fontSize: 12, lineHeight: 16 },
  skeletonChip: { backgroundColor: colors.surface, borderColor: colors.surface },
  card: {
    marginHorizontal: spacing.md,
    marginTop: spacing.md,
    paddingTop: spacing.md,
    borderRadius: radii.lg,
    borderWidth: 1,
    backgroundColor: colors.background,
    gap: spacing.xs,
    overflow: 'hidden',
  },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.md },
  badge: { paddingHorizontal: spacing.sm + 2, paddingVertical: 3, borderRadius: radii.pill },
  badgeText: { fontSize: 13, fontWeight: '700', letterSpacing: 0.3 },
  when: { ...type.label, fontSize: 13 },
  place: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.xs,
  },
  cardTitle: { paddingHorizontal: spacing.md, paddingTop: spacing.sm, gap: 2 },
  cardBody: { paddingTop: spacing.sm, paddingBottom: spacing.sm },
  group: { paddingTop: spacing.sm },
  groupTitle: { ...type.label, paddingHorizontal: spacing.md, paddingBottom: spacing.xs },
  hint: { ...type.caption, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  notice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginHorizontal: spacing.md,
    marginTop: spacing.md,
    padding: spacing.md,
    borderRadius: radii.md,
    backgroundColor: colors.surface,
  },
  block: { marginTop: spacing.lg },
  blockTitle: { paddingHorizontal: spacing.md, paddingBottom: spacing.sm },
  disclosure: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: 56,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  disclosureIcon: { width: 40, height: 40, borderRadius: radii.md, alignItems: 'center', justifyContent: 'center' },
  more: { minHeight: 48, justifyContent: 'center', paddingHorizontal: spacing.md },
  moreText: { ...type.label, fontSize: 14 },
  taskRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: 56,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  taskIcon: { width: 40, height: 40, borderRadius: radii.md, alignItems: 'center', justifyContent: 'center' },
  timeline: { paddingTop: spacing.sm, paddingRight: spacing.md },
  timelineRow: { flexDirection: 'row' },
  rail: { width: 40, alignItems: 'center' },
  railLine: { position: 'absolute', top: 0, bottom: 0, width: 2, backgroundColor: colors.border },
  railFirst: { top: 26 },
  railLast: { bottom: '100%', marginBottom: -26 },
  railNone: { width: 0 },
  railDot: {
    marginTop: 20,
    width: 12,
    height: 12,
    borderRadius: 6,
    borderWidth: 2,
    backgroundColor: colors.background,
  },
  railDotPast: { borderColor: colors.muted, backgroundColor: colors.muted },
  timelineBody: { flex: 1, borderRadius: radii.md, marginVertical: 2 },
  timelineHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: 56,
    paddingHorizontal: spacing.sm + 4,
    paddingVertical: spacing.sm,
  },
  timelineItems: { marginLeft: -spacing.sm, paddingBottom: spacing.sm },
  count: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  countText: { fontSize: 14, fontWeight: '700' },
  skeletonRows: { paddingVertical: spacing.sm },
  skeletonRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.md },
  skeletonGlyph: { width: 40, height: 40, borderRadius: radii.md, backgroundColor: colors.surface },
  skeletonLine: { height: 12, borderRadius: 6, backgroundColor: colors.surface, marginVertical: 3 },
  skeletonShort: { width: '30%' },
});
