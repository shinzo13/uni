import Ionicons from '@expo/vector-icons/Ionicons';
import { Link, Tabs } from 'expo-router';
import type { ComponentProps } from 'react';
import { type ColorValue, Pressable } from 'react-native';

import { colors } from '@/theme';

type IconName = ComponentProps<typeof Ionicons>['name'];

function tabIcon(name: IconName) {
  return function TabIcon({ color, size }: { color: ColorValue; size: number }) {
    return <Ionicons name={name} size={size} color={color} />;
  };
}

function tabOptions(title: string, icon: IconName) {
  return { title, tabBarAccessibilityLabel: title, tabBarIcon: tabIcon(icon) };
}

export default function TabLayout() {
  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.muted,
        tabBarStyle: { borderTopColor: colors.border },
        headerShadowVisible: false,
        headerTitleStyle: { color: colors.text },
        headerRight: () => (
          <Link href="/sources" asChild>
            <Pressable accessibilityLabel="Sources" hitSlop={12} style={{ marginRight: 16 }}>
              <Ionicons name="person-circle-outline" size={26} color={colors.text} />
            </Pressable>
          </Link>
        ),
      }}
    >
      <Tabs.Screen name="index" options={tabOptions('Schedule', 'calendar-outline')} />
      <Tabs.Screen name="assignments" options={tabOptions('Assignments', 'checkbox-outline')} />
      <Tabs.Screen name="courses" options={tabOptions('Courses', 'book-outline')} />
      <Tabs.Screen name="grades" options={tabOptions('Grades', 'stats-chart-outline')} />
    </Tabs>
  );
}
