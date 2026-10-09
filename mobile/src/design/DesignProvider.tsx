import { createContext, type PropsWithChildren, use, useCallback, useEffect, useMemo, useState } from 'react';

import { readItem, writeItem } from '@/session/storage';

export type CourseLayout = 'dashboard' | 'feed' | 'shelves' | 'sessions' | 'checklist';
export type CourseListLayout = 'list' | 'stories' | 'tiles';

export const COURSE_LAYOUTS: { value: CourseLayout; label: string; hint: string }[] = [
  { value: 'dashboard', label: 'Dashboard', hint: 'Next class, deadline and points on top, sections below' },
  { value: 'feed', label: 'Feed', hint: 'What changed in the course, newest first' },
  { value: 'shelves', label: 'Shelves', hint: 'Materials grouped by meaning, not by teacher sections' },
  { value: 'sessions', label: 'Sessions', hint: 'Materials matched to your classes from the timetable' },
  { value: 'checklist', label: 'Checklist', hint: 'Sections as progress tracks with Moodle completion' },
];

export const COURSE_LIST_LAYOUTS: { value: CourseListLayout; label: string; hint: string }[] = [
  { value: 'list', label: 'List', hint: 'Compact list grouped by semester' },
  { value: 'stories', label: 'Stories', hint: 'Updates across courses as stories on top' },
  { value: 'tiles', label: 'Tiles', hint: 'Colored tiles with the next class and deadline' },
];

type Design = {
  courseLayout: CourseLayout;
  courseListLayout: CourseListLayout;
  setCourseLayout: (layout: CourseLayout) => void;
  setCourseListLayout: (layout: CourseListLayout) => void;
  lastSeen: (key: string) => string | null;
  markSeen: (key: string) => void;
};

const COURSE_LAYOUT_KEY = 'design-course-layout';
const COURSE_LIST_LAYOUT_KEY = 'design-course-list-layout';
const SEEN_KEY = 'design-seen';

const DesignContext = createContext<Design | null>(null);

export function useDesign() {
  const design = use(DesignContext);
  if (!design) {
    throw new Error('useDesign must be used inside DesignProvider');
  }
  return design;
}

export function DesignProvider({ children }: PropsWithChildren) {
  const [courseLayout, setCourseLayoutState] = useState<CourseLayout>('dashboard');
  const [courseListLayout, setCourseListLayoutState] = useState<CourseListLayout>('tiles');
  const [seen, setSeen] = useState<Record<string, string>>({});

  useEffect(() => {
    Promise.all([readItem(COURSE_LAYOUT_KEY), readItem(COURSE_LIST_LAYOUT_KEY), readItem(SEEN_KEY)])
      .then(([layout, listLayout, stored]) => {
        if (COURSE_LAYOUTS.some((option) => option.value === layout)) {
          setCourseLayoutState(layout as CourseLayout);
        }
        if (COURSE_LIST_LAYOUTS.some((option) => option.value === listLayout)) {
          setCourseListLayoutState(listLayout as CourseListLayout);
        }
        setSeen(stored ? JSON.parse(stored) : {});
      })
      .catch(() => undefined);
  }, []);

  const setCourseLayout = useCallback((layout: CourseLayout) => {
    setCourseLayoutState(layout);
    writeItem(COURSE_LAYOUT_KEY, layout).catch(() => undefined);
  }, []);

  const setCourseListLayout = useCallback((layout: CourseListLayout) => {
    setCourseListLayoutState(layout);
    writeItem(COURSE_LIST_LAYOUT_KEY, layout).catch(() => undefined);
  }, []);

  const markSeen = useCallback((key: string) => {
    setSeen((current) => {
      const next = { ...current, [key]: new Date().toISOString() };
      writeItem(SEEN_KEY, JSON.stringify(next)).catch(() => undefined);
      return next;
    });
  }, []);

  const lastSeen = useCallback((key: string) => seen[key] ?? null, [seen]);

  const value = useMemo(
    () => ({ courseLayout, courseListLayout, setCourseLayout, setCourseListLayout, lastSeen, markSeen }),
    [courseLayout, courseListLayout, setCourseLayout, setCourseListLayout, lastSeen, markSeen],
  );
  return <DesignContext value={value}>{children}</DesignContext>;
}
