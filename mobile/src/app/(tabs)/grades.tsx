import { useMemo, useState } from 'react';
import { FlatList, RefreshControl, StyleSheet, Text, View } from 'react-native';

import { useGrades } from '@/api/queries';
import type { Grade } from '@/api/types';
import { EmptyState } from '@/components/EmptyState';
import { Loading } from '@/components/Loading';
import { Row } from '@/components/Row';
import { SourceIssues } from '@/components/SourceIssues';
import { colors, sourceNames, spacing, text } from '@/theme';

type CourseGrades = {
  key: string;
  name: string;
  term: string | null;
  headline: string | null;
  grades: Grade[];
};

const KIND_ORDER: Record<Grade['kind'], number> = { final: 0, partial: 1, points: 2 };

export default function GradesScreen() {
  const grades = useGrades();
  const [open, setOpen] = useState<string | null>(null);
  const courses = useMemo(() => groupByCourse(grades.data?.items ?? []), [grades.data]);

  return (
    <View style={styles.screen}>
      <SourceIssues sources={grades.data?.sources} />
      {grades.isLoading ? (
        <Loading />
      ) : (
        <FlatList
          data={courses}
          keyExtractor={(course) => course.key}
          refreshControl={
            <RefreshControl refreshing={grades.refreshing} onRefresh={() => grades.refresh().catch(() => undefined)} />
          }
          renderItem={({ item }) => (
            <Row
              title={item.name}
              subtitle={[item.term, `${item.grades.length} ${item.grades.length === 1 ? 'entry' : 'entries'}`]
                .filter(Boolean)
                .join(' · ')}
              detail={item.headline ? <Text style={styles.headline}>{item.headline}</Text> : undefined}
              onPress={() => setOpen(open === item.key ? null : item.key)}
            >
              {open === item.key ? <GradeList grades={item.grades} /> : null}
            </Row>
          )}
          ListEmptyComponent={<EmptyState title="No grades yet" />}
        />
      )}
    </View>
  );
}

function GradeList({ grades }: { grades: Grade[] }) {
  return (
    <View style={styles.list}>
      {grades.map((grade, index) => (
        <View key={`${grade.source}-${grade.name}-${index}`} style={styles.grade}>
          <View style={styles.gradeMain}>
            <Text style={text.body} numberOfLines={2}>
              {grade.name}
            </Text>
            <Text style={text.caption}>
              {[sourceNames[grade.source], grade.comment].filter(Boolean).join(' · ')}
            </Text>
          </View>
          <Text style={[styles.value, grade.passed === false && { color: colors.danger }]}>
            {grade.max_value ? `${grade.value} / ${grade.max_value}` : grade.value}
          </Text>
        </View>
      ))}
    </View>
  );
}

function courseKey(name: string) {
  return name
    .replace(/^\d{4}\/(SZ|SL)\s+\S+\s+\S+\s+/, '')
    .replace(/\s+-\s+(Grupa\s+)?\d+$/i, '')
    .replace(/\([^)]*\)/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function groupByCourse(grades: Grade[]): CourseGrades[] {
  const courses = new Map<string, CourseGrades>();
  for (const grade of grades) {
    const key = courseKey(grade.course_name);
    const course = courses.get(key) ?? { key, name: grade.course_name, term: null, headline: null, grades: [] };
    if (grade.source === 'usos') {
      course.name = grade.course_name;
    }
    course.term = course.term ?? grade.term;
    course.grades.push(grade);
    courses.set(key, course);
  }
  return [...courses.values()]
    .map((course) => {
      const sorted = [...course.grades].sort(
        (a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || (b.graded_at ?? '').localeCompare(a.graded_at ?? ''),
      );
      const headline = sorted.find((grade) => grade.kind !== 'points');
      return { ...course, grades: sorted, headline: headline?.value ?? null };
    })
    .sort((a, b) => (b.term ?? '').localeCompare(a.term ?? '') || a.name.localeCompare(b.name));
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  headline: { fontSize: 17, fontWeight: '600', color: colors.text },
  list: { marginTop: spacing.sm, gap: spacing.sm },
  grade: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  gradeMain: { flex: 1 },
  value: { ...text.body, fontWeight: '600', fontVariant: ['tabular-nums'] },
});
