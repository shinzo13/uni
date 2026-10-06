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
import { currentTerm } from '@/format';
import { colors, sourceNames } from '@/theme';

type Scope = 'current' | 'all';

const SCOPES = [
  { value: 'current', label: 'This semester' },
  { value: 'all', label: 'All' },
] as const;
const BROWSABLE = new Set(['moodle', 'teams']);

export default function CoursesScreen() {
  const [scope, setScope] = useState<Scope>('current');
  const courses = useCourses();
  const sections = useMemo(() => {
    const items = (courses.data?.items ?? [])
      .filter((course) => BROWSABLE.has(course.source))
      .filter((course) => scope === 'all' || inCurrentTerm(course))
      .sort((a, b) => a.name.localeCompare(b.name));
    return (['moodle', 'teams'] as const)
      .map((source) => ({ title: sourceNames[source], data: items.filter((course) => course.source === source) }))
      .filter((section) => section.data.length > 0);
  }, [courses.data, scope]);

  return (
    <View style={styles.screen}>
      <Segmented options={SCOPES} value={scope} onChange={setScope} />
      <SourceIssues sources={courses.data?.sources} />
      {courses.isLoading ? (
        <Loading />
      ) : (
        <SectionList
          sections={sections}
          keyExtractor={(course) => `${course.source}-${course.id}`}
          stickySectionHeadersEnabled={false}
          refreshControl={
            <RefreshControl refreshing={courses.refreshing} onRefresh={() => courses.refresh().catch(() => undefined)} />
          }
          renderSectionHeader={({ section }) => <SectionHeader title={section.title} />}
          renderItem={({ item }) => (
            <Row
              title={displayName(item)}
              subtitle={item.term}
              onPress={() =>
                router.push({
                  pathname: '/course/[kind]/[id]',
                  params: { kind: item.source, id: item.id, name: displayName(item) },
                })
              }
            />
          )}
          ListEmptyComponent={<EmptyState title="No courses" hint="Connect Moodle or Teams in sources." />}
        />
      )}
    </View>
  );
}

function inCurrentTerm(course: Course) {
  const term = currentTerm();
  const season = term.code.endsWith('SZ') ? 'SZ' : 'SL';
  if (course.term) {
    return course.term === term.code;
  }
  return course.name.includes(term.code) || course.name.includes(`${term.academic} ${season}`);
}

function displayName(course: Course) {
  return course.source === 'teams' ? course.name.replace(/^\d{4}\/(SZ|SL)\s+\S+\s+/, '') : course.name;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
});
