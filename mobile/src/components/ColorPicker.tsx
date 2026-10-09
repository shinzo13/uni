import Ionicons from '@expo/vector-icons/Ionicons';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { colors, spacing, subjectPalette, text } from '@/theme';

const HEX = /^#[0-9A-Fa-f]{6}$/;

type Props = {
  value: string | null;
  onChange: (color: string | null) => void;
};

export function ColorPicker({ value, onChange }: Props) {
  const [custom, setCustom] = useState(value ?? '');
  const submitCustom = (input: string) => {
    const hex = input.startsWith('#') ? input : `#${input}`;
    setCustom(input);
    if (HEX.test(hex)) {
      onChange(hex.toUpperCase());
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.swatches}>
        <Pressable
          accessibilityLabel="No color"
          onPress={() => {
            setCustom('');
            onChange(null);
          }}
          style={[styles.swatch, styles.none, value === null && styles.selected]}
        >
          <Ionicons name="close" size={18} color={colors.muted} />
        </Pressable>
        {subjectPalette.map((color) => (
          <Pressable
            key={color}
            accessibilityLabel={color}
            onPress={() => {
              setCustom(color);
              onChange(color);
            }}
            style={[styles.swatch, { backgroundColor: color }, value === color && styles.selected]}
          >
            {value === color ? <Ionicons name="checkmark" size={18} color="#FFFFFF" /> : null}
          </Pressable>
        ))}
      </View>
      <View style={styles.customRow}>
        <View style={[styles.preview, { backgroundColor: value ?? colors.surface }]} />
        <TextInput
          value={custom}
          onChangeText={submitCustom}
          placeholder="Custom hex, e.g. #3A7BD5"
          placeholderTextColor={colors.muted}
          autoCapitalize="characters"
          autoCorrect={false}
          maxLength={7}
          style={styles.input}
        />
      </View>
      {custom && !HEX.test(custom.startsWith('#') ? custom : `#${custom}`) ? (
        <Text style={text.caption}>Use six hex digits</Text>
      ) : null}
    </View>
  );
}

const SIZE = 36;

const styles = StyleSheet.create({
  container: { gap: spacing.md },
  swatches: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm + 2 },
  swatch: { width: SIZE, height: SIZE, borderRadius: SIZE / 2, alignItems: 'center', justifyContent: 'center' },
  none: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  selected: { borderWidth: 3, borderColor: colors.text },
  customRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  preview: { width: SIZE, height: SIZE, borderRadius: 8, borderWidth: 1, borderColor: colors.border },
  input: {
    flex: 1,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
    borderRadius: 10,
    backgroundColor: colors.surface,
    ...text.body,
  },
});
