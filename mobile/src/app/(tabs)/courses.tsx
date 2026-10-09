import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { RefreshControl, SectionList, StyleSheet, View } from 'react-native';

import { useCourses } from '@/api/queries';
import type { Course } from '@/api/types';
import { EmptyState } from '@/components/EmptyState';
import { Loading } from '@/components/Loading';
import { Row, SectionHeader } from '@/components/Row';
import { Segmented } from '@/components/Segmented';
import { SourceIssues } from '@/components/SourceIssues';
import { SubjectIcon } from '@/components/SubjectIcon';
import { courseDetail, currentTerm, termLabel, termOf } from '@/format';
import { editSubject, type SubjectLook, useSubjectResolver } from '@/subjects';
import { colors, sourceNames } from '@/theme';

type Scope = 'current' | 'all';

type Entry = {
  look: SubjectLook;
  courses: Course[];
  term: string | null;
};

const SCOPES = [
  { value: 'current', label: 'This semester' },
  { value: 'all', label: 'All' },
] as const;
const BROWSABLE = new Set(['moodle', 'teams']);

export default function CoursesScreen() {
  const [scope, setScope] = useState<Scope>('current');
  const courses = useCourses();
  const resolve = useSubjectResolver();
  const sections = useMemo(() => {
    const entries = new Map<string, Entry>();
    for (const course of courses.data?.items ?? []) {
      if (!BROWSABLE.has(course.source)) {
        continue;
      }
      const look = resolve(course.source, course.id, course.name);
      const entry = entries.get(look.key) ?? { look, courses: [], term: null };
      entry.courses.push(course);
      entry.term = [entry.term, termOfCourse(course)].filter(Boolean).sort().pop() ?? null;
      entries.set(look.key, entry);
    }
    const current = currentTerm().code;
    const items = [...entries.values()]
      .filter((entry) => scope === 'all' || entry.courses.some((course) => termOfCourse(course) === current))
      .sort((a, b) => a.look.name.localeCompare(b.look.name));
    if (scope === 'current') {
      return items.length ? [{ title: termLabel(current), data: items }] : [];
    }
    const terms = new Map<string, Entry[]>();
    for (const entry of items) {
      terms.set(entry.term ?? '', [...(terms.get(entry.term ?? '') ?? []), entry]);
    }
    return [...terms.entries()]
      .sort(([a], [b]) => (b || '0').localeCompare(a || '0'))
      .map(([term, data]) => ({ title: termLabel(term || null), data }));
  }, [courses.data, resolve, scope]);

  return (
    <View style={styles.screen}>
      <Segmented options={SCOPES} value={scope} onChange={setScope} />
      <SourceIssues sources={courses.data?.sources} />
      {courses.isLoading ? (
        <Loading />
      ) : (
        <SectionList
          sections={sections}
          keyExtractor={(entry) => entry.look.key}
          stickySectionHeadersEnabled={false}
          refreshControl={
            <RefreshControl refreshing={courses.refreshing} onRefresh={() => courses.refresh().catch(() => undefined)} />
          }
          renderSectionHeader={({ section }) => <SectionHeader title={section.title} />}
          renderItem={({ item }) => {
            const [first] = item.courses;
            return (
              <Row
                title={item.look.name}
                subtitle={subtitle(item)}
                leading={<SubjectIcon icon={item.look.icon} color={item.look.color} />}
                onPress={() =>
                  router.push({
                    pathname: '/course/[kind]/[id]',
                    params: { kind: first.source, id: first.id, name: first.name },
                  })
                }
                onLongPress={() => editSubject(first.source, first.id, first.name)}
              />
            );
          }}
          ListEmptyComponent={<EmptyState title="No courses" hint="Connect Moodle or Teams in sources." />}
        />
      )}
    </View>
  );
}

function termOfCourse(course: Course) {
  return course.term ?? termOf(course.name);
}

function subtitle(entry: Entry) {
  if (entry.courses.length === 1) {
    const [course] = entry.courses;
    return [sourceNames[course.source], courseDetail(course.name)].filter(Boolean).join(' · ');
  }
  const counts = new Map<string, number>();
  for (const course of entry.courses) {
    counts.set(course.source, (counts.get(course.source) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([source, count]) => `${sourceNames[source as Course['source']]}${count > 1 ? ` ×${count}` : ''}`)
    .join(' · ');
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
});
