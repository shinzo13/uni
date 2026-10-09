import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useMemo, useState } from 'react';
import { FlatList, Modal, Pressable, StyleSheet, Text, TextInput, useWindowDimensions, View } from 'react-native';

import type { IconName } from '@/components/SubjectIcon';
import { colors, spacing, text } from '@/theme';

const CELL = 64;
const SUGGESTED: IconName[] = [
  'book-open-variant',
  'function-variant',
  'sigma',
  'math-integral',
  'math-compass',
  'calculator-variant',
  'matrix',
  'chart-bell-curve',
  'code-braces',
  'language-python',
  'language-java',
  'language-cpp',
  'database',
  'server',
  'lan',
  'web',
  'console',
  'chip',
  'graph',
  'sitemap',
  'atom',
  'flask',
  'dna',
  'earth',
  'translate',
  'brain',
  'scale-balance',
  'bank',
  'palette',
  'music',
  'dumbbell',
  'school',
];
const ALL = Object.keys(MaterialCommunityIcons.glyphMap) as IconName[];

type Props = {
  visible: boolean;
  color: string | null;
  value: string | null;
  onChange: (icon: IconName) => void;
  onClose: () => void;
};

export function IconPicker({ visible, color, value, onChange, onClose }: Props) {
  const [query, setQuery] = useState('');
  const { width } = useWindowDimensions();
  const columns = Math.max(4, Math.floor((width - spacing.md * 2) / CELL));
  const icons = useMemo(() => {
    const words = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
    if (words.length === 0) {
      return [...SUGGESTED, ...ALL.filter((name) => !SUGGESTED.includes(name))];
    }
    return ALL.filter((name) => words.every((word) => name.includes(word)));
  }, [query]);

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={styles.sheet}>
        <View style={styles.header}>
          <Text style={text.title}>Icon</Text>
          <Pressable onPress={onClose} hitSlop={12}>
            <Text style={styles.done}>Done</Text>
          </Pressable>
        </View>
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder={`Search ${ALL.length} icons`}
          placeholderTextColor={colors.muted}
          autoCapitalize="none"
          autoCorrect={false}
          style={styles.search}
        />
        <FlatList
          key={columns}
          data={icons}
          numColumns={columns}
          keyExtractor={(name) => name}
          initialNumToRender={12}
          windowSize={5}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={styles.grid}
          getItemLayout={(_, index) => ({ length: CELL, offset: CELL * index, index })}
          renderItem={({ item }) => {
            const selected = item === value;
            return (
              <Pressable
                accessibilityLabel={item}
                onPress={() => {
                  onChange(item);
                  onClose();
                }}
                style={[styles.cell, selected && { backgroundColor: color ?? colors.text }]}
              >
                <MaterialCommunityIcons name={item} size={28} color={selected ? '#FFFFFF' : colors.text} />
              </Pressable>
            );
          }}
          ListEmptyComponent={<Text style={styles.empty}>No icons match “{query}”</Text>}
        />
      </View>
    </Modal>
  );
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
  grid: { paddingHorizontal: spacing.md, paddingBottom: spacing.xl },
  cell: { width: CELL, height: CELL, alignItems: 'center', justifyContent: 'center', borderRadius: 12 },
  empty: { ...text.caption, textAlign: 'center', marginTop: spacing.xl },
});
