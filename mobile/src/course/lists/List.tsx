import { RefreshControl, SectionList, StyleSheet } from 'react-native';

import { EmptyState } from '@/components/EmptyState';
import { Row, SectionHeader } from '@/components/Row';
import { SubjectIcon } from '@/components/SubjectIcon';
import { type CourseListProps, editEntry, entryCaption, entryKey, openEntry } from '@/course/list';
import { colors } from '@/theme';

export function ListLayout({ sections, refreshing, onRefresh }: CourseListProps) {
  return (
    <SectionList
      sections={sections}
      keyExtractor={entryKey}
      stickySectionHeadersEnabled={false}
      style={styles.list}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      renderSectionHeader={({ section }) => <SectionHeader title={section.title} />}
      renderItem={({ item }) => (
        <Row
          title={item.look.name}
          subtitle={entryCaption(item)}
          leading={<SubjectIcon icon={item.look.glyph} color={item.look.tint} />}
          onPress={() => openEntry(item)}
          onLongPress={() => editEntry(item)}
        />
      )}
      ListEmptyComponent={<EmptyState title="No courses" hint="Connect Moodle or Teams in sources." />}
    />
  );
}

const styles = StyleSheet.create({
  list: { backgroundColor: colors.background },
});
