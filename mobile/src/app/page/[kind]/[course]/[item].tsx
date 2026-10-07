import { Stack, useLocalSearchParams } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { WebView, type WebViewNavigation } from 'react-native-webview';

import { useSections } from '@/api/queries';
import type { SourceKind } from '@/api/types';
import { EmptyState } from '@/components/EmptyState';
import { Loading } from '@/components/Loading';
import { colors } from '@/theme';

const PAGE_STYLE = `
  body { font: 16px -apple-system, Roboto, sans-serif; color: ${colors.text}; margin: 16px; line-height: 1.45; }
  table { border-collapse: collapse; width: 100%; margin: 12px 0; }
  td, th { border: 1px solid ${colors.border}; padding: 6px 8px; text-align: left; }
  img { max-width: 100%; height: auto; }
  pre, code { white-space: pre-wrap; font-size: 14px; background: ${colors.surface}; }
  a { color: ${colors.text}; }
`;

export default function PageScreen() {
  const { kind, course, item } = useLocalSearchParams<{ kind: SourceKind; course: string; item: string }>();
  const sections = useSections(kind, course);
  const page = sections.data?.items.flatMap((section) => section.items).find((entry) => entry.id === item);

  if (sections.isLoading) {
    return <Loading />;
  }
  if (!page) {
    return <EmptyState title="Page not found" />;
  }

  const html = `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>${PAGE_STYLE}</style></head><body>${page.html}</body></html>`;
  const openExternally = (event: WebViewNavigation) => {
    if (event.url.startsWith('http')) {
      WebBrowser.openBrowserAsync(event.url);
      return false;
    }
    return true;
  };

  return (
    <>
      <Stack.Screen options={{ title: page.title }} />
      <WebView
        originWhitelist={['*']}
        source={{ html }}
        onShouldStartLoadWithRequest={openExternally}
        style={{ backgroundColor: colors.background }}
      />
    </>
  );
}
