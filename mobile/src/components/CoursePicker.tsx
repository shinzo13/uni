import { useMemo, useState } from 'react';
import { FlatList, Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import type { Course, CourseRef } from '@/api/types';
import { Row, SectionHeader } from '@/components/Row';
import { courseTitle } from '@/format';
import { courseCaption, refKey, type SubjectLook, suggestMerges, useSubjectResolver } from '@/subjects';
import { colors, spacing, text } from '@/theme';

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
    const ranked = suggestMerges(members, candidates);
    return {
      suggested: ranked,
      rest: candidates.filter((course) => !ranked.includes(course)).sort((a, b) => a.name.localeCompare(b.name)),
    };
  }, [courses, selected, query]);
  const close = () => {
    setQuery('');
    onClose();
  };

  const data = [
    ...(suggested.length ? [{ header: 'Suggested' }, ...suggested] : []),
    ...(rest.length ? [{ header: 'All courses' }, ...rest] : []),
  ];

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={close}>
      <View style={styles.sheet}>
        <View style={styles.header}>
          <Text style={text.title}>Merge with</Text>
          <Pressable onPress={close} hitSlop={12}>
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
                  close();
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
  const parts = [courseCaption(course)];
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
