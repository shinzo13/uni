import Ionicons from '@expo/vector-icons/Ionicons';
import { Tabs } from 'expo-router';
import type { ComponentProps } from 'react';
import type { ColorValue } from 'react-native';

import { colors } from '@/theme';

type IconName = ComponentProps<typeof Ionicons>['name'];

function tabIcon(name: IconName) {
  return ({ color, size }: { color: ColorValue; size: number }) => (
    <Ionicons name={name} size={size} color={color} />
  );
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
      }}
    >
      <Tabs.Screen name="index" options={{ title: 'Schedule', tabBarIcon: tabIcon('calendar-outline') }} />
      <Tabs.Screen name="assignments" options={{ title: 'Assignments', tabBarIcon: tabIcon('checkbox-outline') }} />
      <Tabs.Screen name="courses" options={{ title: 'Courses', tabBarIcon: tabIcon('book-outline') }} />
      <Tabs.Screen name="grades" options={{ title: 'Grades', tabBarIcon: tabIcon('stats-chart-outline') }} />
    </Tabs>
  );
}
