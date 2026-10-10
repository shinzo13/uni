import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useQueryClient } from '@tanstack/react-query';
import { Pressable, StyleSheet, Text } from 'react-native';

import { useConnectivity } from '@/api/connectivity';
import { colors, spacing, type } from '@/theme';

const MESSAGES = {
  offline: 'No internet connection — showing saved data',
  unreachable: 'Server is not reachable — showing saved data',
};

export function ConnectivityBanner() {
  const queryClient = useQueryClient();
  const state = useConnectivity(queryClient);
  if (state === 'online') {
    return null;
  }
  return (
    <Pressable
      onPress={() => queryClient.refetchQueries({ type: 'active' })}
      style={styles.banner}
      accessibilityRole="button"
      accessibilityLabel={`${MESSAGES[state]}. Tap to retry`}
    >
      <MaterialCommunityIcons name={state === 'offline' ? 'wifi-off' : 'cloud-off-outline'} size={18} color="#FFFFFF" />
      <Text style={styles.text}>{MESSAGES[state]}</Text>
      <Text style={styles.retry}>Retry</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
    backgroundColor: colors.text,
  },
  text: { ...type.caption, color: '#FFFFFF', flex: 1 },
  retry: { ...type.label, color: '#FFFFFF' },
});
