import { Linking, StyleSheet, Text } from 'react-native';

import { linkSegments } from '@/format';
import { text } from '@/theme';

export function LinkedText({ html }: { html: string }) {
  return (
    <Text selectable style={text.body}>
      {linkSegments(html).map((segment, index) =>
        segment.url ? (
          <Text key={index} style={styles.link} onPress={() => Linking.openURL(segment.url!).catch(() => undefined)}>
            {segment.text}
          </Text>
        ) : (
          segment.text
        ),
      )}
    </Text>
  );
}

const styles = StyleSheet.create({
  link: { color: '#1565A8', textDecorationLine: 'underline' },
});
