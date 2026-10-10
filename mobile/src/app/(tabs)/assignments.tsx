import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { RefreshControl, SectionList, StyleSheet, Text, View } from 'react-native';

import { useAssignments } from '@/api/queries';
import type { Assignment } from '@/api/types';
import { EmptyState } from '@/components/EmptyState';
import { Loading } from '@/components/Loading';
import { Row, SectionHeader } from '@/components/Row';
import { Segmented } from '@/components/Segmented';
import { SourceIssues } from '@/components/SourceIssues';
import { SubjectIcon } from '@/components/SubjectIcon';
import { currentTerm, formatDateTime, relativeDue, termOf } from '@/format';
import { type Resolve, useSubjectResolver } from '@/subjects';
import { colors, sourceNames, text } from '@/theme';

type Tab = 'current' | 'archive';

const TABS = [
  { value: 'current', label: 'Current' },
  { value: 'archive', label: 'Archive' },
] as const;
const RECENT_WITHOUT_DEADLINE_DAYS = 60;
const STATUS_LABELS: Record<Assignment['status'], string> = {
  new: 'Not submitted',
  draft: 'In progress',
  submitted: 'Submitted',
  graded: 'Graded',
  unknown: '',
};

export default function AssignmentsScreen() {
  const [tab, setTab] = useState<Tab>('current');
  const assignments = useAssignments();
  const resolve = useSubjectResolver();
  const sections = useMemo(() => group(assignments.data?.items ?? [], tab), [assignments.data, tab]);

  return (
    <View style={styles.screen}>
      <Segmented options={TABS} value={tab} onChange={setTab} />
      <SourceIssues sources={assignments.data?.sources} />
      {assignments.isLoading ? (
        <Loading />
      ) : (
        <SectionList
          sections={sections}
          keyExtractor={(item) => `${item.source}-${item.id}`}
          stickySectionHeadersEnabled={false}
          refreshControl={
            <RefreshControl
              refreshing={assignments.refreshing}
              onRefresh={() => assignments.refresh().catch(() => undefined)}
            />
          }
          renderSectionHeader={({ section }) => <SectionHeader title={section.title} />}
          renderItem={({ item }) => <AssignmentRow assignment={item} current={tab === 'current'} resolve={resolve} />}
          ListEmptyComponent={
            <EmptyState title={tab === 'current' ? 'Nothing due' : 'No past assignments'} />
          }
        />
      )}
    </View>
  );
}

type RowProps = {
  assignment: Assignment;
  current: boolean;
  resolve: Resolve;
};

function AssignmentRow({ assignment, current, resolve }: RowProps) {
  const look = resolve(assignment.source, assignment.course_id, assignment.course_name);
  const status = STATUS_LABELS[assignment.status];
  const subtitle = [look.name, sourceNames[assignment.source], assignment.kind === 'quiz' ? 'Quiz' : null]
    .filter(Boolean)
    .join(' · ');
  const due = assignment.due_at ? (
    <View style={styles.due}>
      <Text style={styles.dueDate}>{formatDateTime(assignment.due_at)}</Text>
      <Text style={text.caption}>{assignment.grade ?? (current ? relativeDue(assignment.due_at) : status)}</Text>
    </View>
  ) : (
    <Text style={text.caption}>{assignment.grade ?? status}</Text>
  );
  return (
    <Row
      title={assignment.title}
      subtitle={subtitle}
      detail={due}
      leading={<SubjectIcon icon={look.glyph} color={look.tint} size={32} />}
      onPress={() =>
        router.push({ pathname: '/assignment/[id]', params: { id: assignment.id, source: assignment.source } })
      }
    />
  );
}

function isDone(assignment: Assignment) {
  return assignment.status === 'submitted' || assignment.status === 'graded';
}

function isCurrent(assignment: Assignment, now: Date) {
  if (isDone(assignment)) {
    return false;
  }
  if (assignment.due_at) {
    return new Date(assignment.due_at) >= now;
  }
  if (termOf(assignment.course_name) === currentTerm(now).code) {
    return true;
  }
  const opened = assignment.opens_at ? new Date(assignment.opens_at) : null;
  return !!opened && now.getTime() - opened.getTime() < RECENT_WITHOUT_DEADLINE_DAYS * 86_400_000;
}

function group(items: Assignment[], tab: Tab) {
  const now = new Date();
  if (tab === 'current') {
    const current = items.filter((item) => isCurrent(item, now));
    const week = new Date(now.getTime() + 7 * 86_400_000);
    const sorted = current.sort((a, b) => (a.due_at ?? '9999').localeCompare(b.due_at ?? '9999'));
    return [
      { title: 'This week', data: sorted.filter((item) => item.due_at && new Date(item.due_at) <= week) },
      { title: 'Later', data: sorted.filter((item) => item.due_at && new Date(item.due_at) > week) },
      { title: 'No deadline', data: sorted.filter((item) => !item.due_at) },
    ].filter((section) => section.data.length > 0);
  }
  const archive = items
    .filter((item) => !isCurrent(item, now))
    .sort((a, b) => (b.due_at ?? b.opens_at ?? '').localeCompare(a.due_at ?? a.opens_at ?? ''));
  return [
    { title: 'Missed', data: archive.filter((item) => !isDone(item) && item.due_at) },
    { title: 'Done', data: archive.filter(isDone) },
    { title: 'Without deadline', data: archive.filter((item) => !isDone(item) && !item.due_at) },
  ].filter((section) => section.data.length > 0);
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  due: { alignItems: 'flex-end', gap: 2 },
  dueDate: { ...text.caption, color: colors.text },
});
