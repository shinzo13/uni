import { useMemo, useState } from 'react';
import { Pressable, RefreshControl, SectionList, StyleSheet, Text, View } from 'react-native';

import { useGrades } from '@/api/queries';
import type { Grade, GradeCategory } from '@/api/types';
import { EmptyState } from '@/components/EmptyState';
import { Loading } from '@/components/Loading';
import { SectionHeader } from '@/components/Row';
import { Segmented } from '@/components/Segmented';
import { SourceIssues } from '@/components/SourceIssues';
import { SubjectIcon } from '@/components/SubjectIcon';
import { courseTitle, termLabel, termOf } from '@/format';
import { editSubject, type Resolve, type SubjectLook, useSubjectResolver } from '@/subjects';
import { colors, sourceNames, spacing, text } from '@/theme';

type CourseGrades = {
  key: string;
  name: string;
  look: SubjectLook | null;
  term: string | null;
  summary: string | null;
  grades: Grade[];
};

const CATEGORIES = [
  { value: 'assignment', label: 'Assignments' },
  { value: 'work', label: 'Works' },
  { value: 'semester', label: 'Semester' },
] as const;

export default function GradesScreen() {
  const grades = useGrades();
  const resolve = useSubjectResolver();
  const [category, setCategory] = useState<GradeCategory>('assignment');
  const [open, setOpen] = useState<string | null>(null);
  const sections = useMemo(
    () =>
      byTerm(
        groupByCourse(grades.data?.items ?? [], category, resolve),
      ),
    [grades.data, category, resolve],
  );

  return (
    <View style={styles.screen}>
      <Segmented options={CATEGORIES} value={category} onChange={setCategory} />
      <SourceIssues sources={grades.data?.sources} />
      {grades.isLoading ? (
        <Loading />
      ) : (
        <SectionList
          sections={sections}
          keyExtractor={(course) => course.key}
          stickySectionHeadersEnabled={false}
          refreshControl={
            <RefreshControl refreshing={grades.refreshing} onRefresh={() => grades.refresh().catch(() => undefined)} />
          }
          renderSectionHeader={({ section }) => <SectionHeader title={section.title} />}
          renderItem={({ item }) => (
            <CourseBlock
              course={item}
              expanded={open === item.key}
              onToggle={() => setOpen(open === item.key ? null : item.key)}
            />
          )}
          ListEmptyComponent={<EmptyState title="No grades yet" />}
        />
      )}
    </View>
  );
}

type BlockProps = {
  course: CourseGrades;
  expanded: boolean;
  onToggle: () => void;
};

function CourseBlock({ course, expanded, onToggle }: BlockProps) {
  const count = `${course.grades.length} ${course.grades.length === 1 ? 'entry' : 'entries'}`;
  return (
    <View style={styles.course}>
      <Pressable
        onPress={onToggle}
        onLongPress={() => {
          const [first] = course.grades;
          editSubject(first.source, first.course_id, first.course_name);
        }}
        style={({ pressed }) => [styles.courseHeader, pressed && styles.pressed]}
      >
        <SubjectIcon icon={course.look?.icon ?? null} color={course.look?.color ?? null} />
        <View style={styles.courseMain}>
          <Text style={text.body} numberOfLines={2}>
            {course.name}
          </Text>
          <Text style={text.caption}>{count}</Text>
        </View>
        {course.summary ? <Text style={styles.summary}>{course.summary}</Text> : null}
      </Pressable>
      {expanded ? (
        <View style={styles.entries}>
          {course.grades.map((grade, index) => (
            <View key={`${grade.source}-${grade.name}-${index}`} style={styles.entry}>
              <View style={styles.entryMain}>
                <Text style={text.body}>{grade.name}</Text>
                <Text style={text.caption}>{[sourceNames[grade.source], grade.comment].filter(Boolean).join(' · ')}</Text>
              </View>
              <Text style={[styles.value, grade.passed === false && { color: colors.danger }]}>
                {grade.max_value ? `${grade.value} / ${grade.max_value}` : grade.value}
              </Text>
            </View>
          ))}
        </View>
      ) : null}
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

function number(value: string | null) {
  if (!value) {
    return null;
  }
  const parsed = Number(value.replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : null;
}

function summarize(grades: Grade[], category: GradeCategory) {
  if (category === 'semester') {
    return grades.find((grade) => grade.source === 'usos')?.value ?? grades[0]?.value ?? null;
  }
  const scored = grades.map((grade) => [number(grade.value), number(grade.max_value)] as const);
  if (scored.length === 0 || scored.some(([value, max]) => value === null || max === null)) {
    return null;
  }
  const total = scored.reduce((sum, [value]) => sum + (value ?? 0), 0);
  const max = scored.reduce((sum, [, maximum]) => sum + (maximum ?? 0), 0);
  return `${Number(total.toFixed(2))} / ${Number(max.toFixed(2))}`;
}

function groupByCourse(all: Grade[], category: GradeCategory, resolve: Resolve): CourseGrades[] {
  const nameKey = (grade: Grade) => `${grade.term ?? termOf(grade.course_name) ?? ''}:${courseKey(grade.course_name)}`;
  const subjectOfName = new Map<string, SubjectLook>();
  for (const grade of all) {
    const look = resolve(grade.source, grade.course_id, grade.course_name);
    if (look.subject && !subjectOfName.has(nameKey(grade))) {
      subjectOfName.set(nameKey(grade), look);
    }
  }
  const grades = all.filter((grade) => grade.category === category);
  const courses = new Map<string, CourseGrades>();
  for (const grade of grades) {
    const own = resolve(grade.source, grade.course_id, grade.course_name);
    const look = own.subject ? own : (subjectOfName.get(nameKey(grade)) ?? null);
    const key = look ? look.key : nameKey(grade);
    const course = courses.get(key) ?? {
      key,
      name: look?.name ?? courseTitle(grade.course_name),
      look,
      term: grade.term ?? termOf(grade.course_name),
      summary: null,
      grades: [],
    };
    course.term = [course.term, grade.term ?? termOf(grade.course_name)].filter(Boolean).sort().pop() ?? null;
    if (grade.source === 'usos' && !look) {
      course.name = courseTitle(grade.course_name);
    }
    course.grades.push(grade);
    courses.set(key, course);
  }
  return [...courses.values()].map((course) => {
    const sorted = [...course.grades].sort((a, b) => (b.graded_at ?? '').localeCompare(a.graded_at ?? ''));
    return { ...course, grades: sorted, summary: summarize(sorted, category) };
  });
}

function byTerm(courses: CourseGrades[]) {
  const terms = new Map<string, CourseGrades[]>();
  for (const course of courses) {
    const term = course.term ?? '';
    terms.set(term, [...(terms.get(term) ?? []), course]);
  }
  return [...terms.entries()]
    .sort(([a], [b]) => (b || '0').localeCompare(a || '0'))
    .map(([term, items]) => ({
      title: termLabel(term || null),
      data: items.sort((a, b) => a.name.localeCompare(b.name)),
    }));
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  course: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  courseHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md - 4,
  },
  pressed: { backgroundColor: colors.surface },
  courseMain: { flex: 1, gap: 2 },
  summary: { fontSize: 17, fontWeight: '600', color: colors.text, fontVariant: ['tabular-nums'] },
  entries: { paddingHorizontal: spacing.md, paddingBottom: spacing.md, gap: spacing.sm },
  entry: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.sm + 2,
    borderRadius: 10,
    backgroundColor: colors.surface,
  },
  entryMain: { flex: 1, gap: 2 },
  value: { ...text.body, fontWeight: '600', fontVariant: ['tabular-nums'] },
});
