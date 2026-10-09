import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { Attachment } from '@/api/types';
import type { PlacedItem } from '@/course/data';
import { FILE_COLORS, FILE_GLYPHS, fileKind, formatSize, itemCaption, itemColor, itemGlyph } from '@/course/items';
import { plainText } from '@/format';
import { colors, radii, spacing, tinted, type } from '@/theme';

type Props = {
  placed: PlacedItem;
  tint: string;
  isNew?: boolean;
  caption?: string | null;
  trailing?: React.ReactNode;
  onOpen: (placed: PlacedItem) => void;
  onOpenAttachment: (attachment: Attachment) => void;
};

export function ItemRow({ placed, tint, isNew, caption, trailing, onOpen, onOpenAttachment }: Props) {
  const { item } = placed;
  const [expanded, setExpanded] = useState(false);
  if (item.kind === 'label') {
    return <Text style={styles.note}>{plainText(item.html)}</Text>;
  }
  const expandable = item.kind === 'folder' || item.attachments.length > 1;
  const color = itemColor(item, tint);
  return (
    <View>
      <Pressable
        onPress={() => (expandable ? setExpanded(!expanded) : onOpen(placed))}
        style={({ pressed }) => [styles.row, pressed && styles.pressed]}
        accessibilityRole="button"
        accessibilityLabel={item.title}
      >
        <View style={[styles.glyph, { backgroundColor: tinted(color, 0.12) }]}>
          <MaterialCommunityIcons name={itemGlyph(item) as never} size={22} color={color} />
        </View>
        <View style={styles.main}>
          <Text style={type.body} numberOfLines={2}>
            {item.title}
          </Text>
          <View style={styles.meta}>
            {isNew ? <View style={[styles.dot, { backgroundColor: tint }]} /> : null}
            <Text style={type.caption} numberOfLines={1}>
              {caption ?? itemCaption(item)}
            </Text>
          </View>
        </View>
        {trailing ??
          (expandable ? (
            <MaterialCommunityIcons name={expanded ? 'chevron-up' : 'chevron-down'} size={22} color={colors.muted} />
          ) : null)}
      </Pressable>
      {expanded ? (
        <View style={styles.files}>
          {item.attachments.length === 0 ? <Text style={type.caption}>Empty folder</Text> : null}
          {item.attachments.map((attachment) => {
            const kind = fileKind(attachment);
            return (
              <Pressable
                key={attachment.url}
                onPress={() => onOpenAttachment(attachment)}
                style={({ pressed }) => [styles.file, pressed && styles.pressed]}
              >
                <MaterialCommunityIcons name={FILE_GLYPHS[kind] as never} size={20} color={FILE_COLORS[kind]} />
                <Text style={[type.body, styles.main]} numberOfLines={1}>
                  {attachment.name}
                </Text>
                <Text style={type.caption}>{formatSize(attachment.size)}</Text>
              </Pressable>
            );
          })}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
    minHeight: 56,
  },
  pressed: { backgroundColor: colors.surface },
  glyph: { width: 40, height: 40, borderRadius: radii.md, alignItems: 'center', justifyContent: 'center' },
  main: { flex: 1, gap: 2 },
  meta: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs + 2 },
  dot: { width: 7, height: 7, borderRadius: 4 },
  note: { ...type.caption, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  files: { marginLeft: 72, marginRight: spacing.md, marginBottom: spacing.sm, gap: 2 },
  file: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.sm,
    borderRadius: radii.sm,
  },
});
