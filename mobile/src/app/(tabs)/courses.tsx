import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { ConnectivityBanner } from '@/components/ConnectivityBanner';
import { Loading } from '@/components/Loading';
import { Segmented } from '@/components/Segmented';
import { SourceIssues } from '@/components/SourceIssues';
import { ListLayout } from '@/course/lists/List';
import { StoriesLayout } from '@/course/lists/Stories';
import { TilesLayout } from '@/course/lists/Tiles';
import { type Scope, useCourseEntries } from '@/course/list';
import { useDesign } from '@/design/DesignProvider';
import { colors } from '@/theme';

const SCOPES = [
  { value: 'current', label: 'This semester' },
  { value: 'all', label: 'All' },
] as const;

const LAYOUTS = {
  list: ListLayout,
  stories: StoriesLayout,
  tiles: TilesLayout,
};

export default function CoursesScreen() {
  const [scope, setScope] = useState<Scope>('current');
  const entries = useCourseEntries(scope);
  const { courseListLayout } = useDesign();
  const Layout = LAYOUTS[courseListLayout];

  return (
    <View style={styles.screen}>
      <ConnectivityBanner />
      <Segmented options={SCOPES} value={scope} onChange={setScope} />
      <SourceIssues sources={entries.sources} />
      {entries.isLoading ? (
        <Loading />
      ) : (
        <Layout sections={entries.sections} refreshing={entries.refreshing} onRefresh={entries.refresh} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
});
