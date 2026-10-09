import Ionicons from '@expo/vector-icons/Ionicons';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { useCourses, useSubjectActions, useSubjects } from '@/api/queries';
import type { Course, CourseRef, SourceKind, SubjectDraft } from '@/api/types';
import { ColorPicker } from '@/components/ColorPicker';
import { CoursePicker } from '@/components/CoursePicker';
import { IconPicker } from '@/components/IconPicker';
import { Loading } from '@/components/Loading';
import { DEFAULT_ICON, isIconName, SubjectIcon } from '@/components/SubjectIcon';
import { courseTitle, termLabel, termOf } from '@/format';
import { refKey, type SubjectLook, useCourseIndex, useSubjectResolver } from '@/subjects';
import { colors, sourceNames, spacing, text } from '@/theme';

export default function EditSubjectScreen() {
  const { source, course, name } = useLocalSearchParams<{ source: SourceKind; course: string; name?: string }>();
  const resolve = useSubjectResolver();
  const courses = useCourses();
  const subjects = useSubjects();

  if (courses.isLoading || subjects.isLoading) {
    return <Loading />;
  }
  return <Editor look={resolve(source, course, name)} originalName={courseTitle(name ?? course)} courses={courses.data?.items ?? []} />;
}

type EditorProps = {
  look: SubjectLook;
  originalName: string;
  courses: Course[];
};

function Editor({ look, originalName, courses }: EditorProps) {
  const index = useCourseIndex();
  const actions = useSubjectActions();
  const [draft, setDraft] = useState<SubjectDraft>({
    name: look.subject?.name ?? '',
    color: look.color,
    icon: look.icon,
    courses: look.courses,
  });
  const [picking, setPicking] = useState<'icon' | 'course' | null>(null);
  const [saving, setSaving] = useState(false);

  const update = (patch: Partial<SubjectDraft>) => setDraft({ ...draft, ...patch });
  const fallbackName = look.subject?.name ? originalName : look.name;
  const unchanged = !look.subject && !draft.name?.trim() && !draft.color && !draft.icon && draft.courses.length === 1;

  const save = async () => {
    if (unchanged) {
      router.back();
      return;
    }
    setSaving(true);
    try {
      await actions.save({ ...draft, name: draft.name?.trim() || null }, look.subject?.id);
      router.back();
    } catch (error) {
      Alert.alert('Could not save', String(error));
    } finally {
      setSaving(false);
    }
  };

  const reset = () =>
    Alert.alert('Reset subject?', 'Alias, color and icon are removed and merged courses are split again.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Reset',
        style: 'destructive',
        onPress: async () => {
          await actions.remove(look.subject!.id);
          router.back();
        },
      },
    ]);

  const removeCourse = (member: CourseRef) =>
    update({ courses: draft.courses.filter((item) => refKey(item.source, item.course_id) !== refKey(member.source, member.course_id)) });

  return (
    <>
      <Stack.Screen
        options={{
          title: 'Subject',
          headerRight: () => (
            <Pressable onPress={save} disabled={saving} hitSlop={12}>
              <Text style={[styles.save, saving && styles.disabled]}>Save</Text>
            </Pressable>
          ),
        }}
      />
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={styles.preview}>
          <SubjectIcon icon={draft.icon} color={draft.color} size={64} />
          <Text style={styles.previewName} numberOfLines={2}>
            {draft.name?.trim() || fallbackName}
          </Text>
        </View>

        <Text style={text.section}>Alias</Text>
        <TextInput
          value={draft.name ?? ''}
          onChangeText={(value) => update({ name: value })}
          placeholder={fallbackName}
          placeholderTextColor={colors.muted}
          maxLength={120}
          style={styles.input}
        />

        <Text style={text.section}>Color</Text>
        <ColorPicker value={draft.color} onChange={(color) => update({ color })} />

        <Text style={text.section}>Icon</Text>
        <View style={styles.iconRow}>
          <Pressable onPress={() => setPicking('icon')} style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}>
            <MaterialCommunityIcons name={isIconName(draft.icon) ? draft.icon : DEFAULT_ICON} size={24} color={colors.text} />
            <Text style={[text.body, styles.grow]}>{draft.icon ?? 'Default'}</Text>
            <Ionicons name="chevron-forward" size={18} color={colors.muted} />
          </Pressable>
          {draft.icon ? (
            <Pressable onPress={() => update({ icon: null })} hitSlop={8}>
              <Text style={text.caption}>Clear</Text>
            </Pressable>
          ) : null}
        </View>

        <Text style={text.section}>Courses</Text>
        <View style={styles.card}>
          {draft.courses.map((member) => {
            const known = index.get(refKey(member.source, member.course_id));
            return (
              <View key={refKey(member.source, member.course_id)} style={styles.member}>
                <View style={styles.grow}>
                  <Text style={text.body} numberOfLines={2}>
                    {known ? courseTitle(known.name) : member.course_id}
                  </Text>
                  <Text style={text.caption}>
                    {[sourceNames[member.source], known ? termLabel(known.term ?? termOf(known.name)) : null]
                      .filter(Boolean)
                      .join(' · ')}
                  </Text>
                </View>
                {draft.courses.length > 1 ? (
                  <Pressable accessibilityLabel="Remove from subject" onPress={() => removeCourse(member)} hitSlop={8}>
                    <Ionicons name="remove-circle-outline" size={22} color={colors.danger} />
                  </Pressable>
                ) : null}
              </View>
            );
          })}
          <Pressable onPress={() => setPicking('course')} style={({ pressed }) => [styles.member, pressed && styles.pressed]}>
            <Ionicons name="git-merge-outline" size={20} color={colors.text} />
            <Text style={[text.body, styles.grow]}>Merge with another course</Text>
          </Pressable>
        </View>
        <Text style={text.caption}>
          Merged courses share one name, color and icon everywhere: schedule, assignments, materials and grades.
        </Text>

        {look.subject ? (
          <Pressable onPress={reset} style={styles.reset}>
            <Text style={styles.resetLabel}>Reset subject</Text>
          </Pressable>
        ) : null}
      </ScrollView>

      <IconPicker
        visible={picking === 'icon'}
        color={draft.color}
        value={draft.icon}
        onChange={(icon) => update({ icon })}
        onClose={() => setPicking(null)}
      />
      <CoursePicker
        visible={picking === 'course'}
        courses={courses}
        selected={draft.courses}
        onPick={(picked) => update({ courses: [...draft.courses, { source: picked.source, course_id: picked.id }] })}
        onClose={() => setPicking(null)}
      />
    </>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.md, gap: spacing.md, paddingBottom: spacing.xl * 2 },
  save: { ...text.body, fontWeight: '600' },
  disabled: { color: colors.muted },
  preview: { alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.md },
  previewName: { ...text.title, fontSize: 20, textAlign: 'center' },
  input: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 4,
    borderRadius: 10,
    backgroundColor: colors.surface,
    ...text.body,
  },
  iconRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  iconButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md - 4,
    borderRadius: 10,
    backgroundColor: colors.surface,
  },
  pressed: { opacity: 0.6 },
  grow: { flex: 1 },
  card: { borderRadius: 10, backgroundColor: colors.surface, overflow: 'hidden' },
  member: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md - 4,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  reset: { alignItems: 'center', padding: spacing.md, marginTop: spacing.md },
  resetLabel: { ...text.body, color: colors.danger },
});
