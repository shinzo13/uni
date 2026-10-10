import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { Stack, useLocalSearchParams } from 'expo-router';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';

import { useSections } from '@/api/queries';
import { EmptyState } from '@/components/EmptyState';
import { Loading } from '@/components/Loading';
import { useOpeners } from '@/course/data';
import { FILE_COLORS, FILE_GLYPHS, fileKind, formatSize } from '@/course/items';
import { colors, radii, spacing, tinted, type } from '@/theme';

export default function FolderScreen() {
  const { course, item } = useLocalSearchParams<{ course: string; item: string }>();
  const sections = useSections('moodle', course);
  const { openAttachment } = useOpeners([]);
  const folder = sections.data?.items.flatMap((section) => section.items).find((entry) => entry.id === item);

  if (sections.isLoading) {
    return <Loading />;
  }
  if (!folder) {
    return <EmptyState title="Folder not found" />;
  }

  return (
    <>
      <Stack.Screen options={{ title: folder.title }} />
      <FlatList
        data={folder.attachments}
        keyExtractor={(attachment) => attachment.url}
        style={styles.list}
        renderItem={({ item: attachment }) => {
          const kind = fileKind(attachment);
          return (
            <Pressable
              onPress={() => openAttachment(attachment).catch(() => undefined)}
              style={({ pressed }) => [styles.row, pressed && styles.pressed]}
              accessibilityRole="button"
              accessibilityLabel={attachment.name}
            >
              <View style={[styles.glyph, { backgroundColor: tinted(FILE_COLORS[kind], 0.12) }]}>
                <MaterialCommunityIcons name={FILE_GLYPHS[kind] as never} size={22} color={FILE_COLORS[kind]} />
              </View>
              <Text style={[type.body, styles.name]} numberOfLines={2}>
                {attachment.name}
              </Text>
              <Text style={type.caption}>{formatSize(attachment.size)}</Text>
            </Pressable>
          );
        }}
        ListEmptyComponent={
          <EmptyState title="This folder is empty" hint="The teacher has not uploaded any files to it yet." />
        }
      />
    </>
  );
}

const styles = StyleSheet.create({
  list: { backgroundColor: colors.background },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.md, minHeight: 56 },
  pressed: { backgroundColor: colors.surface },
  glyph: { width: 40, height: 40, borderRadius: radii.md, alignItems: 'center', justifyContent: 'center' },
  name: { flex: 1 },
});
