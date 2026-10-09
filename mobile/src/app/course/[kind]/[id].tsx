import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { SourceKind } from '@/api/types';
import { ChecklistLayout } from '@/course/layouts/Checklist';
import { DashboardLayout } from '@/course/layouts/Dashboard';
import { FeedLayout } from '@/course/layouts/Feed';
import { SessionsLayout } from '@/course/layouts/Sessions';
import { ShelvesLayout } from '@/course/layouts/Shelves';
import { useCourseData } from '@/course/data';
import { useDesign } from '@/design/DesignProvider';
import { LayoutSheet } from '@/design/LayoutPicker';
import { SubjectIcon } from '@/components/SubjectIcon';
import { editSubject, useSubjectResolver } from '@/subjects';
import { colors, spacing, type } from '@/theme';

const LAYOUTS = {
  dashboard: DashboardLayout,
  feed: FeedLayout,
  shelves: ShelvesLayout,
  sessions: SessionsLayout,
  checklist: ChecklistLayout,
};

export default function CourseScreen() {
  const { kind, id, name } = useLocalSearchParams<{ kind: SourceKind; id: string; name?: string }>();
  const resolve = useSubjectResolver();
  const look = useMemo(() => resolve(kind, id, name), [resolve, kind, id, name]);
  const data = useCourseData(look);
  const { courseLayout } = useDesign();
  const Layout = LAYOUTS[courseLayout];
  const { markSeen } = data;
  const [picking, setPicking] = useState(false);

  useEffect(() => markSeen, [markSeen]);

  return (
    <View style={styles.screen}>
      <Stack.Screen
        options={{
          title: look.name,
          headerTitle: () => (
            <View style={styles.headerTitle}>
              <SubjectIcon icon={look.glyph} color={look.tint} size={28} />
              <Text style={type.title} numberOfLines={1}>
                {look.name}
              </Text>
            </View>
          ),
          headerRight: () => (
            <View style={styles.actions}>
              <Pressable accessibilityLabel="Change layout" hitSlop={12} onPress={() => setPicking(true)}>
                <MaterialCommunityIcons name="view-dashboard-edit-outline" size={22} color={colors.text} />
              </Pressable>
              <Pressable accessibilityLabel="Edit subject" hitSlop={12} onPress={() => editSubject(kind, id, name)}>
                <MaterialCommunityIcons name="palette-outline" size={22} color={colors.text} />
              </Pressable>
            </View>
          ),
        }}
      />
      <Layout key={courseLayout} data={data} />
      <LayoutSheet visible={picking} onClose={() => setPicking(false)} />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  actions: { flexDirection: 'row', gap: spacing.lg },
  headerTitle: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexShrink: 1 },
});
