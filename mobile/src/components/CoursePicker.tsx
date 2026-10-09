import { useMemo, useState } from 'react';
import { FlatList, Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import type { Course, CourseRef } from '@/api/types';
import { Row, SectionHeader } from '@/components/Row';
import { courseTitle, termLabel, termOf } from '@/format';
import { refKey, similarity, type SubjectLook, useSubjectResolver } from '@/subjects';
import { colors, sourceNames, spacing, text } from '@/theme';

const SUGGESTION_THRESHOLD = 0.5;
const SUGGESTIONS = 6;

type Props = {
  visible: boolean;
  courses: Course[];
  selected: CourseRef[];
  onPick: (courses: CourseRef[]) => void;
  onClose: () => void;
};

export function CoursePicker({ visible, courses, selected, onPick, onClose }: Props) {
  const [query, setQuery] = useState('');
  const resolve = useSubjectResolver();
  const { suggested, rest } = useMemo(() => {
    const taken = new Set(selected.map((course) => refKey(course.source, course.course_id)));
    const members = courses.filter((course) => taken.has(refKey(course.source, course.id)));
    const words = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
    const candidates = courses
      .filter((course) => !taken.has(refKey(course.source, course.id)))
      .filter((course) => words.every((word) => `${course.name} ${course.id}`.toLowerCase().includes(word)));
    const score = (course: Course) =>
      Math.max(0, ...members.map((member) => similarity(`${member.id} ${member.name}`, `${course.id} ${course.name}`)));
    const ranked = candidates
      .map((course) => ({ course, score: score(course) }))
      .filter((entry) => entry.score >= SUGGESTION_THRESHOLD)
      .sort((a, b) => b.score - a.score)
      .slice(0, SUGGESTIONS)
      .map((entry) => entry.course);
    return {
      suggested: ranked,
      rest: candidates.filter((course) => !ranked.includes(course)).sort((a, b) => a.name.localeCompare(b.name)),
    };
  }, [courses, selected, query]);

  const data = [
    ...(suggested.length ? [{ header: 'Suggested' }, ...suggested] : []),
    ...(rest.length ? [{ header: 'All courses' }, ...rest] : []),
  ];

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={styles.sheet}>
        <View style={styles.header}>
          <Text style={text.title}>Merge with</Text>
          <Pressable onPress={onClose} hitSlop={12}>
            <Text style={styles.done}>Cancel</Text>
          </Pressable>
        </View>
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search courses"
          placeholderTextColor={colors.muted}
          autoCorrect={false}
          style={styles.search}
        />
        <FlatList
          data={data}
          keyboardShouldPersistTaps="handled"
          keyExtractor={(item) => ('header' in item ? item.header : refKey(item.source, item.id))}
          renderItem={({ item }) =>
            'header' in item ? (
              <SectionHeader title={item.header} />
            ) : (
              <Row
                title={courseTitle(item.name)}
                subtitle={subtitle(item, resolve(item.source, item.id, item.name))}
                onPress={() => {
                  onPick(resolve(item.source, item.id, item.name).courses);
                  setQuery('');
                  onClose();
                }}
              />
            )
          }
          ListEmptyComponent={<Text style={styles.empty}>No courses</Text>}
        />
      </View>
    </Modal>
  );
}

function subtitle(course: Course, look: SubjectLook) {
  const parts = [sourceNames[course.source], termLabel(course.term ?? termOf(course.name))];
  if (look.subject && look.courses.length > 1) {
    parts.push(`in ${look.name} with ${look.courses.length - 1} more`);
  } else if (look.subject?.name) {
    parts.push(`alias ${look.name}`);
  }
  return parts.join(' · ');
}

const styles = StyleSheet.create({
  sheet: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: spacing.md,
  },
  done: { ...text.body, fontWeight: '600' },
  search: {
    marginHorizontal: spacing.md,
    marginBottom: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
    borderRadius: 10,
    backgroundColor: colors.surface,
    ...text.body,
  },
  empty: { ...text.caption, textAlign: 'center', marginTop: spacing.xl },
});
