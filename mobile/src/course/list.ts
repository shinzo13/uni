import { router } from 'expo-router';
import { useMemo } from 'react';

import { useAssignments, useCourses, usePosts, useSubjects } from '@/api/queries';
import type { Assignment, ClassSession, Course, Post } from '@/api/types';
import { useUpcomingClasses } from '@/course/data';
import { useDesign } from '@/design/DesignProvider';
import { useNow } from '@/useNow';
import { courseDetail, currentTerm, termLabel, termOf } from '@/format';
import { editSubject, membersCaption, refKey, type SubjectLook, useSubjectResolver } from '@/subjects';
import { sourceNames } from '@/theme';

export type Scope = 'current' | 'all';

export type CourseEntry = {
  look: SubjectLook;
  courses: Course[];
  term: string | null;
  nextClass: ClassSession | null;
  nextDeadline: Assignment | null;
  openTasks: number;
  updates: Update[];
  lastSeen: string | null;
};

export type Update =
  | { kind: 'post'; at: string; post: Post; look: SubjectLook }
  | { kind: 'assignment'; at: string; assignment: Assignment; look: SubjectLook };

export type CourseSections = { title: string; data: CourseEntry[] }[];

const BROWSABLE = new Set(['moodle', 'teams']);
const UPDATE_WINDOW_DAYS = 14;

export function termOfCourse(course: Course) {
  return course.term ?? termOf(course.name);
}

export function isOpenTask(assignment: Assignment, now: number) {
  return (
    (assignment.status === 'new' || assignment.status === 'draft') &&
    !!assignment.due_at &&
    new Date(assignment.due_at).getTime() > now
  );
}

export function useCourseEntries(scope: Scope) {
  const courses = useCourses();
  const subjects = useSubjects();
  const posts = usePosts();
  const assignments = useAssignments();
  const classes = useUpcomingClasses();
  const resolve = useSubjectResolver();
  const { lastSeen } = useDesign();
  const now = useNow();

  const sections = useMemo<CourseSections>(() => {
    const windowStart = new Date(now - UPDATE_WINDOW_DAYS * 86_400_000).toISOString();
    const entries = new Map<string, CourseEntry>();
    for (const course of courses.data?.items ?? []) {
      if (!BROWSABLE.has(course.source)) {
        continue;
      }
      const look = resolve(course.source, course.id, course.name);
      const entry = entries.get(look.key) ?? {
        look,
        courses: [],
        term: null,
        nextClass: null,
        nextDeadline: null,
        openTasks: 0,
        updates: [],
        lastSeen: lastSeen(look.key),
      };
      entry.courses.push(course);
      entry.term = [entry.term, termOfCourse(course)].filter(Boolean).sort().pop() ?? null;
      entries.set(look.key, entry);
    }
    const entryOf = (source: Course['source'], courseId: string) => {
      const look = resolve(source, courseId);
      return entries.get(look.key) ?? null;
    };
    for (const session of classes.data?.items ?? []) {
      const entry = entryOf(session.source, session.course_id);
      if (entry && new Date(session.ends_at).getTime() > now && !entry.nextClass) {
        entry.nextClass = session;
      }
    }
    for (const assignment of assignments.data?.items ?? []) {
      const entry = entryOf(assignment.source, assignment.course_id);
      if (!entry) {
        continue;
      }
      if (isOpenTask(assignment, now)) {
        entry.openTasks += 1;
        if (!entry.nextDeadline || assignment.due_at! < entry.nextDeadline.due_at!) {
          entry.nextDeadline = assignment;
        }
      }
      const at = assignment.opens_at;
      if (at && at > (entry.lastSeen ?? windowStart) && new Date(at).getTime() <= now) {
        entry.updates.push({ kind: 'assignment', at, assignment, look: entry.look });
      }
    }
    for (const post of posts.data?.items ?? []) {
      const entry = entryOf(post.source, post.course_id);
      if (entry && post.posted_at > (entry.lastSeen ?? windowStart)) {
        entry.updates.push({ kind: 'post', at: post.posted_at, post, look: entry.look });
      }
    }
    for (const entry of entries.values()) {
      entry.updates.sort((a, b) => b.at.localeCompare(a.at));
    }
    const current = currentTerm().code;
    const items = [...entries.values()]
      .filter((entry) => scope === 'all' || entry.courses.some((course) => termOfCourse(course) === current))
      .sort((a, b) => a.look.name.localeCompare(b.look.name));
    if (scope === 'current') {
      return items.length ? [{ title: termLabel(current), data: items }] : [];
    }
    const terms = new Map<string, CourseEntry[]>();
    for (const entry of items) {
      terms.set(entry.term ?? '', [...(terms.get(entry.term ?? '') ?? []), entry]);
    }
    return [...terms.entries()]
      .sort(([a], [b]) => (b || '0').localeCompare(a || '0'))
      .map(([term, data]) => ({ title: termLabel(term || null), data }));
  }, [courses.data, posts.data, assignments.data, classes.data, resolve, lastSeen, scope, now]);

  const refresh = async () => {
    await Promise.all([
      courses.refresh(),
      posts.refresh(),
      assignments.refresh(),
      classes.refresh(),
      subjects.refetch(),
    ]).catch(() => undefined);
  };

  return {
    sections,
    sources: courses.data?.sources,
    isLoading: courses.isLoading,
    refreshing: courses.refreshing,
    refresh,
  };
}

export function entryKey(entry: CourseEntry) {
  return entry.look.key;
}

export function memberKeys(entry: CourseEntry) {
  return entry.look.courses.map((course) => refKey(course.source, course.course_id));
}

export type CourseListProps = {
  sections: CourseSections;
  refreshing: boolean;
  onRefresh: () => Promise<void>;
};

export function openEntry(entry: CourseEntry) {
  const [first] = entry.courses;
  router.push({ pathname: '/course/[kind]/[id]', params: { kind: first.source, id: first.id, name: first.name } });
}

export function editEntry(entry: CourseEntry) {
  const [first] = entry.courses;
  editSubject(first.source, first.id, first.name);
}

export function entryCaption(entry: CourseEntry) {
  if (entry.look.courses.length === 1) {
    const [course] = entry.courses;
    return [sourceNames[course.source], courseDetail(course.name)].filter(Boolean).join(' · ');
  }
  return membersCaption(entry.look.courses);
}
