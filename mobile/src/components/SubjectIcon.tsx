import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { StyleSheet, View } from 'react-native';

import { colors } from '@/theme';

export type IconName = keyof typeof MaterialCommunityIcons.glyphMap;

export const DEFAULT_ICON: IconName = 'book-open-variant';

export function isIconName(name: string | null | undefined): name is IconName {
  return !!name && name in MaterialCommunityIcons.glyphMap;
}

type Props = {
  icon: string | null;
  color: string | null;
  size?: number;
};

export function SubjectIcon({ icon, color, size = 36 }: Props) {
  return (
    <View
      style={[
        styles.badge,
        { width: size, height: size, borderRadius: size * 0.28, backgroundColor: color ?? colors.surface },
      ]}
    >
      <MaterialCommunityIcons
        name={isIconName(icon) ? icon : DEFAULT_ICON}
        size={size * 0.58}
        color={color ? '#FFFFFF' : colors.muted}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  badge: { alignItems: 'center', justifyContent: 'center' },
});
