import { router } from 'expo-router';
import { useMemo } from 'react';

import { useCourses, useSubjects } from '@/api/queries';
import type { Course, CourseRef, SourceKind, Subject } from '@/api/types';
import { courseTitle } from '@/format';

export type SubjectLook = {
  key: string;
  name: string;
  color: string | null;
  icon: string | null;
  subject: Subject | null;
  courses: CourseRef[];
};

export type Resolve = (source: SourceKind, courseId: string, fallbackName?: string) => SubjectLook;

const NAME_PRIORITY: SourceKind[] = ['usos', 'moodle', 'teams'];

export function refKey(source: SourceKind, courseId: string) {
  return `${source}:${courseId}`;
}

export function useCourseIndex() {
  const courses = useCourses();
  return useMemo(
    () => new Map((courses.data?.items ?? []).map((course) => [refKey(course.source, course.id), course])),
    [courses.data],
  );
}

export function useSubjectResolver(): Resolve {
  const subjects = useSubjects();
  const courses = useCourseIndex();
  return useMemo(() => {
    const index = new Map<string, Subject>();
    for (const subject of subjects.data ?? []) {
      for (const course of subject.courses) {
        index.set(refKey(course.source, course.course_id), subject);
      }
    }
    return (source, courseId, fallbackName) => {
      const key = refKey(source, courseId);
      const subject = index.get(key) ?? null;
      const members = subject?.courses ?? [{ source, course_id: courseId }];
      return {
        key: subject ? subject.id : key,
        name: subject?.name || defaultName(members, courses) || courseTitle(fallbackName ?? courseId),
        color: subject?.color ?? null,
        icon: subject?.icon ?? null,
        subject,
        courses: members,
      };
    };
  }, [subjects.data, courses]);
}

function defaultName(members: CourseRef[], courses: Map<string, Course>) {
  const named = members
    .map((member) => courses.get(refKey(member.source, member.course_id)))
    .filter((course): course is Course => !!course)
    .sort((a, b) => NAME_PRIORITY.indexOf(a.source) - NAME_PRIORITY.indexOf(b.source));
  return named[0] ? courseTitle(named[0].name) : null;
}

export function similarity(a: string, b: string) {
  const words = (name: string) =>
    new Set(
      courseTitle(name)
        .toLowerCase()
        .split(/[^\p{L}\d]+/u)
        .filter((word) => word.length > 2 || /\d/.test(word)),
    );
  const left = words(a);
  const right = words(b);
  const shared = [...left].filter((word) => right.has(word)).length;
  const code = (name: string) => name.match(/\b\d{2}-[A-Z0-9]+-[A-Z0-9]+\b/)?.[0];
  const sameCode = code(a) && code(a) === code(b) ? 10 : 0;
  return shared / Math.max(1, Math.min(left.size, right.size)) + sameCode;
}

export function editSubject(source: SourceKind, courseId: string, name?: string) {
  router.push({ pathname: '/subject/edit', params: { source, course: courseId, name } });
}
