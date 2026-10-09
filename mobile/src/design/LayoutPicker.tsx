import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { COURSE_LAYOUTS, COURSE_LIST_LAYOUTS, useDesign } from '@/design/DesignProvider';
import { colors, radii, spacing, type } from '@/theme';

type Option<T extends string> = { value: T; label: string; hint: string };

type GroupProps<T extends string> = {
  title: string;
  options: Option<T>[];
  value: T;
  onChange: (value: T) => void;
};

function OptionGroup<T extends string>({ title, options, value, onChange }: GroupProps<T>) {
  return (
    <View style={styles.group}>
      <Text style={type.label}>{title.toUpperCase()}</Text>
      <View style={styles.card}>
        {options.map((option) => {
          const selected = option.value === value;
          return (
            <Pressable
              key={option.value}
              accessibilityRole="radio"
              accessibilityState={{ selected }}
              onPress={() => onChange(option.value)}
              style={({ pressed }) => [styles.option, pressed && styles.pressed]}
            >
              <MaterialCommunityIcons
                name={selected ? 'radiobox-marked' : 'radiobox-blank'}
                size={22}
                color={selected ? colors.text : colors.muted}
              />
              <View style={styles.optionText}>
                <Text style={type.title}>{option.label}</Text>
                <Text style={type.caption}>{option.hint}</Text>
              </View>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

export function CourseLayoutOptions() {
  const design = useDesign();
  return (
    <OptionGroup
      title="Course page"
      options={COURSE_LAYOUTS}
      value={design.courseLayout}
      onChange={design.setCourseLayout}
    />
  );
}

export function CourseListLayoutOptions() {
  const design = useDesign();
  return (
    <OptionGroup
      title="Course list"
      options={COURSE_LIST_LAYOUTS}
      value={design.courseListLayout}
      onChange={design.setCourseListLayout}
    />
  );
}

export function LayoutSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Close" />
      <View style={styles.sheet}>
        <View style={styles.handle} />
        <CourseLayoutOptions />
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  group: { gap: spacing.sm },
  card: { borderRadius: radii.md, backgroundColor: colors.surface, overflow: 'hidden' },
  option: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.md - 2, minHeight: 56 },
  pressed: { opacity: 0.6 },
  optionText: { flex: 1, gap: 2 },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.32)' },
  sheet: {
    padding: spacing.md,
    paddingBottom: spacing.xl,
    gap: spacing.md,
    borderTopLeftRadius: radii.lg,
    borderTopRightRadius: radii.lg,
    backgroundColor: colors.background,
  },
  handle: { alignSelf: 'center', width: 32, height: 4, borderRadius: 2, backgroundColor: colors.border },
});
