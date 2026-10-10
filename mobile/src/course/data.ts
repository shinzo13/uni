import { router } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useCallback, useMemo } from 'react';

import { request } from '@/api/client';
import { useAssignments, useClasses, useGrades, useMoodleSections, usePosts } from '@/api/queries';
import type {
  Assignment,
  Attachment,
  ClassSession,
  CourseItem,
  CourseSection,
  Grade,
  Post,
  SourceKind,
} from '@/api/types';
import { useDesign } from '@/design/DesignProvider';
import { addDays, courseDetail, currentTerm, isoDate } from '@/format';
import { useSession } from '@/session/SessionProvider';
import { useNow } from '@/useNow';
import { refKey, type SubjectLook, useCourseIndex } from '@/subjects';

export const UPCOMING_DAYS = 14;

export type MoodleCourse = {
  courseId: string;
  title: string;
  detail: string | null;
  sections: CourseSection[];
};

export type PlacedItem = {
  item: CourseItem;
  section: CourseSection;
  courseId: string;
};

export type CourseData = {
  look: SubjectLook;
  moodle: MoodleCourse[];
  items: PlacedItem[];
  posts: Post[];
  assignments: Assignment[];
  grades: Grade[];
  upcoming: ClassSession[];
  lastSeen: string | null;
  isLoading: boolean;
  refreshing: boolean;
  refresh: () => Promise<void>;
  markSeen: () => void;
};

export type CourseLayoutProps = { data: CourseData };

export function termRange(now = new Date()) {
  const term = currentTerm(now);
  const year = Number(term.code.slice(0, 4));
  return term.code.endsWith('SZ')
    ? { start: `${year}-10-01`, end: `${year + 1}-02-28` }
    : { start: `${year}-02-15`, end: `${year}-06-30` };
}

export function useTermClasses() {
  const { start, end } = termRange();
  return useClasses(start, end);
}

export function useUpcomingClasses() {
  const today = new Date();
  return useClasses(isoDate(today), isoDate(addDays(today, UPCOMING_DAYS)));
}

export function useCourseData(look: SubjectLook): CourseData {
  const index = useCourseIndex();
  const design = useDesign();
  const moodleIds = useMemo(
    () => look.courses.filter((course) => course.source === 'moodle').map((course) => course.course_id),
    [look.courses],
  );
  const sections = useMoodleSections(moodleIds);
  const posts = usePosts();
  const assignments = useAssignments();
  const grades = useGrades();
  const classes = useUpcomingClasses();
  const members = useMemo(
    () => new Set(look.courses.map((course) => refKey(course.source, course.course_id))),
    [look.courses],
  );
  const belongs = useCallback(
    (source: SourceKind, courseId: string) => members.has(refKey(source, courseId)),
    [members],
  );

  const moodle = useMemo(
    () =>
      moodleIds.map((courseId, position) => {
        const name = index.get(refKey('moodle', courseId))?.name ?? courseId;
        return {
          courseId,
          title: name,
          detail: courseDetail(name),
          sections: withoutDuplicateForums(sections.pages[position]?.items ?? []),
        };
      }),
    [moodleIds, sections.pages, index],
  );
  const items = useMemo(
    () =>
      moodle.flatMap((course) =>
        course.sections.flatMap((section) =>
          section.items.map((item) => ({ item, section, courseId: course.courseId })),
        ),
      ),
    [moodle],
  );
  const now = useNow();
  const filtered = useMemo(
    () => ({
      posts: (posts.data?.items ?? [])
        .filter((post) => belongs(post.source, post.course_id))
        .sort((a, b) => b.posted_at.localeCompare(a.posted_at)),
      assignments: (assignments.data?.items ?? []).filter((item) => belongs(item.source, item.course_id)),
      grades: (grades.data?.items ?? []).filter((grade) => belongs(grade.source, grade.course_id)),
    }),
    [posts.data, assignments.data, grades.data, belongs],
  );
  const upcoming = useMemo(
    () =>
      (classes.data?.items ?? []).filter(
        (session) => belongs(session.source, session.course_id) && new Date(session.ends_at).getTime() > now,
      ),
    [classes.data, belongs, now],
  );

  const { markSeen: markKeySeen } = design;
  const markSeen = useCallback(() => markKeySeen(look.key), [markKeySeen, look.key]);

  const refresh = async () => {
    await Promise.all([
      sections.refresh(),
      posts.refresh(),
      assignments.refresh(),
      grades.refresh(),
      classes.refresh(),
    ]).catch(() => undefined);
  };

  return {
    look,
    moodle,
    items,
    ...filtered,
    upcoming,
    lastSeen: design.lastSeen(look.key),
    isLoading: sections.isLoading,
    refreshing: sections.refreshing || posts.refreshing || assignments.refreshing,
    refresh,
    markSeen,
  };
}

export function useOpeners(assignments: Assignment[]) {
  const { token } = useSession();
  const openAttachment = useCallback(
    async (attachment: Attachment) => {
      const link = await request<{ url: string }>('/files/link', {
        method: 'POST',
        token,
        body: { kind: 'moodle', url: attachment.url },
      });
      await WebBrowser.openBrowserAsync(link.url);
    },
    [token],
  );
  const openItem = useCallback(
    (placed: PlacedItem) => {
      const { item, courseId } = placed;
      if (item.kind === 'page') {
        router.push({
          pathname: '/page/[kind]/[course]/[item]',
          params: { kind: 'moodle', course: courseId, item: item.id },
        });
        return;
      }
      if (item.kind === 'file' && item.attachments.length === 1) {
        openAttachment(item.attachments[0]).catch(() => undefined);
        return;
      }
      if (item.kind === 'folder' || item.attachments.length > 1) {
        router.push({ pathname: '/folder/[course]/[item]', params: { course: courseId, item: item.id } });
        return;
      }
      if (item.kind === 'assignment' || item.kind === 'quiz') {
        const match = assignments.find(
          (assignment) =>
            assignment.source === 'moodle' && assignment.course_id === courseId && assignment.title === item.title,
        );
        if (match) {
          router.push({ pathname: '/assignment/[id]', params: { id: match.id, source: match.source } });
          return;
        }
      }
      if (item.url) {
        WebBrowser.openBrowserAsync(item.url).catch(() => undefined);
      }
    },
    [assignments, openAttachment],
  );
  const findAssignment = useCallback(
    (placed: PlacedItem) =>
      assignments.find(
        (assignment) =>
          assignment.source === 'moodle' &&
          assignment.course_id === placed.courseId &&
          assignment.title === placed.item.title,
      ) ?? null,
    [assignments],
  );
  return { openItem, openAttachment, findAssignment };
}

function withoutDuplicateForums(sections: CourseSection[]) {
  const seen = new Set<string>();
  return sections.map((section) => ({
    ...section,
    items: section.items.filter((item) => {
      if (item.kind !== 'forum') {
        return true;
      }
      const key = item.title.trim().toLowerCase();
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    }),
  }));
}
