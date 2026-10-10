import { router } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useCallback, useMemo } from 'react';

import { request } from '@/api/client';
import { useAssignments, useClasses, useGrades, useMaterialSections, usePosts } from '@/api/queries';
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
import { addDays, courseDetail, currentTerm, isoDate, termOf } from '@/format';
import { useSession } from '@/session/SessionProvider';
import { useNow } from '@/useNow';
import { refKey, type SubjectLook, useCourseIndex } from '@/subjects';

export const UPCOMING_DAYS = 14;
const MATERIAL_SOURCES = new Set<SourceKind>(['moodle', 'teams']);

export type MaterialCourse = {
  source: SourceKind;
  courseId: string;
  title: string;
  detail: string | null;
  sections: CourseSection[];
};

export type PlacedItem = {
  item: CourseItem;
  section: CourseSection;
  courseId: string;
  source: SourceKind;
};

export type CourseData = {
  look: SubjectLook;
  materials: MaterialCourse[];
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

export function termRange(code = currentTerm().code) {
  const year = Number(code.slice(0, 4));
  return code.endsWith('SZ')
    ? { start: `${year}-10-01`, end: `${year + 1}-02-28` }
    : { start: `${year}-02-15`, end: `${year}-06-30` };
}

export function beforeCurrentTerm(iso: string) {
  return Date.parse(iso) < Date.parse(`${termRange().start}T00:00:00`);
}

export function useTermClasses(look: SubjectLook) {
  const index = useCourseIndex();
  const current = currentTerm().code;
  const terms = look.courses
    .map((ref) => index.get(refKey(ref.source, ref.course_id)))
    .map((course) => (course ? (course.term ?? termOf(course.name)) : null))
    .filter((term): term is string => !!term && term <= current)
    .sort();
  const { start, end } = termRange(terms.includes(current) ? current : (terms.pop() ?? current));
  return useClasses(start, end);
}

export function useUpcomingClasses() {
  const today = new Date();
  return useClasses(isoDate(today), isoDate(addDays(today, UPCOMING_DAYS)));
}

export function useCourseData(look: SubjectLook): CourseData {
  const index = useCourseIndex();
  const design = useDesign();
  const materialRefs = useMemo(
    () => look.courses.filter((course) => MATERIAL_SOURCES.has(course.source)),
    [look.courses],
  );
  const sections = useMaterialSections(materialRefs);
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

  const materials = useMemo(
    () =>
      materialRefs
        .map((ref, position) => {
          const name = index.get(refKey(ref.source, ref.course_id))?.name ?? ref.course_id;
          return {
            source: ref.source,
            courseId: ref.course_id,
            title: name,
            detail: courseDetail(name),
            sections: withoutDuplicateForums(sections.pages[position]?.items ?? []),
          };
        })
        .filter((course) => course.source === 'moodle' || course.sections.length > 0)
        .sort((a, b) => Number(a.source !== 'moodle') - Number(b.source !== 'moodle')),
    [materialRefs, sections.pages, index],
  );
  const items = useMemo(
    () =>
      materials.flatMap((course) =>
        course.sections.flatMap((section) =>
          section.items.map((item) => ({ item, section, courseId: course.courseId, source: course.source })),
        ),
      ),
    [materials],
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
    materials,
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
        body: { kind: attachmentSource(attachment), url: attachment.url },
      });
      await WebBrowser.openBrowserAsync(link.url);
    },
    [token],
  );
  const openItem = useCallback(
    (placed: PlacedItem) => {
      const { item, courseId, source } = placed;
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
        router.push({
          pathname: '/folder/[kind]/[course]/[item]',
          params: { kind: source, course: courseId, item: item.id },
        });
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

export function attachmentSource(attachment: Attachment): SourceKind {
  return /^https:\/\/[^/]+\.sharepoint\.com\//.test(attachment.url) ? 'teams' : 'moodle';
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
