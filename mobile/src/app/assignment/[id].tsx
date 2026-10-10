import { Stack, useLocalSearchParams } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { useAssignments } from '@/api/queries';
import type { AssignmentStatus } from '@/api/types';
import { Attachments } from '@/components/Attachments';
import { EmptyState } from '@/components/EmptyState';
import { Loading } from '@/components/Loading';
import { formatDateTime, plainText } from '@/format';
import { useSubjectResolver } from '@/subjects';
import { colors, sourceNames, spacing, text } from '@/theme';

export default function AssignmentScreen() {
  const { id, source } = useLocalSearchParams<{ id: string; source: string }>();
  const assignments = useAssignments();
  const resolve = useSubjectResolver();
  const assignment = assignments.data?.items.find((item) => item.id === id && item.source === source);

  if (assignments.isLoading) {
    return <Loading />;
  }
  if (!assignment) {
    return <EmptyState title="Assignment not found" />;
  }

  const facts = [
    ['Course', resolve(assignment.source, assignment.course_id, assignment.course_name).name],
    ['Due', assignment.due_at ? formatDateTime(assignment.due_at) : 'No deadline'],
    ['Opens', assignment.opens_at ? formatDateTime(assignment.opens_at) : null],
    ['Status', statusLabel(assignment.status, assignment.due_at)],
    ['Submitted', assignment.submitted_at ? formatDateTime(assignment.submitted_at) : null],
    ['Grade', assignment.grade],
  ].filter((fact): fact is [string, string] => !!fact[1]);
  const body = plainText(assignment.description_html);
  const description = body.trim().toLowerCase() === assignment.title.trim().toLowerCase() ? '' : body;

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Stack.Screen options={{ title: `${sourceNames[assignment.source]} ${assignment.kind === 'quiz' ? 'quiz' : 'assignment'}` }} />
      <Text style={styles.title}>{assignment.title}</Text>
      <View style={styles.facts}>
        {facts.map(([label, value]) => (
          <View key={label} style={styles.fact}>
            <Text style={styles.label}>{label}</Text>
            <Text style={styles.value}>{value}</Text>
          </View>
        ))}
      </View>
      {description ? (
        <Text selectable style={text.body}>
          {description}
        </Text>
      ) : null}
      <Attachments source={assignment.source} attachments={assignment.attachments} />
      {assignment.url ? (
        <Pressable style={styles.button} onPress={() => WebBrowser.openBrowserAsync(assignment.url!)}>
          <Text style={styles.buttonLabel}>Open in {sourceNames[assignment.source]}</Text>
        </Pressable>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: spacing.md, gap: spacing.lg },
  title: { fontSize: 22, fontWeight: '700', color: colors.text },
  facts: { gap: spacing.sm },
  fact: { flexDirection: 'row', gap: spacing.md },
  label: { ...text.caption, width: 84 },
  value: { ...text.body, flex: 1 },
  button: { alignItems: 'center', paddingVertical: spacing.md, borderRadius: 12, backgroundColor: colors.accent },
  buttonLabel: { fontSize: 16, fontWeight: '600', color: colors.background },
});

function statusLabel(status: AssignmentStatus, dueAt: string | null) {
  const overdue = !!dueAt && new Date(dueAt) < new Date();
  switch (status) {
    case 'new':
      return overdue ? 'Not submitted, deadline passed' : 'Not submitted';
    case 'draft':
      return overdue ? 'Started, deadline passed' : 'In progress';
    case 'submitted':
      return 'Submitted';
    case 'graded':
      return 'Graded';
    default:
      return null;
  }
}
