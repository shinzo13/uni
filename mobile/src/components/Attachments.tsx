import Ionicons from '@expo/vector-icons/Ionicons';
import * as WebBrowser from 'expo-web-browser';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { request } from '@/api/client';
import type { Attachment, SourceKind } from '@/api/types';
import { useSession } from '@/session/SessionProvider';
import { colors, spacing, text } from '@/theme';

type Props = {
  source: SourceKind;
  attachments: Attachment[];
};

export function Attachments({ source, attachments }: Props) {
  const { token } = useSession();
  if (attachments.length === 0) {
    return null;
  }
  const open = async (attachment: Attachment) => {
    const link = await request<{ url: string }>('/files/link', {
      method: 'POST',
      token,
      body: { kind: source, url: attachment.url },
    });
    await WebBrowser.openBrowserAsync(link.url);
  };
  return (
    <View style={styles.list}>
      {attachments.map((attachment) => (
        <Pressable key={attachment.url} onPress={() => open(attachment)} style={styles.item}>
          <Ionicons name="document-outline" size={18} color={colors.text} />
          <Text style={styles.name} numberOfLines={1}>
            {attachment.name}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { gap: spacing.sm },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.sm + 2,
    borderRadius: 10,
    backgroundColor: colors.surface,
  },
  name: { ...text.body, flex: 1 },
});
