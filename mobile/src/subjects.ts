import { router } from 'expo-router';
import { useMemo } from 'react';

import { useCourses, useSubjects } from '@/api/queries';
import type { Course, CourseRef, SourceKind, Subject } from '@/api/types';
import { courseDetail, courseTitle, termLabel, termOf } from '@/format';
import { sourceNames, subjectPalette } from '@/theme';

export type SubjectLook = {
  key: string;
  name: string;
  color: string | null;
  icon: string | null;
  tint: string;
  glyph: string;
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
      const original = defaultName(members, courses) || courseTitle(fallbackName ?? courseId);
      return {
        key: subject ? subject.id : key,
        name: subject?.name || original,
        color: subject?.color ?? null,
        icon: subject?.icon ?? null,
        tint: subject?.color ?? autoTint(original),
        glyph: subject?.icon ?? autoGlyph(original),
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

const GENERIC_WORDS = new Set(['zastosowaniami', 'wstęp', 'podstawy', 'elementy', 'teorii', 'oraz', 'dla']);

export function similarity(a: string, b: string) {
  const code = (name: string) => name.match(/\b\d{2}-[A-Z0-9]+-[A-Z0-9]+\b/)?.[0];
  if (code(a) && code(a) === code(b)) {
    return 10;
  }
  const tokens = (name: string) =>
    courseTitle(name)
      .toLowerCase()
      .split(/[^\p{L}\d]+/u)
      .filter(Boolean);
  const words = (name: string) =>
    new Set(tokens(name).filter((word) => word.length > 2 && !/\d/.test(word) && !GENERIC_WORDS.has(word)));
  const numbers = (name: string) => tokens(name).filter((word) => /^\d+$/.test(word)).join();
  if (numbers(a) && numbers(b) && numbers(a) !== numbers(b)) {
    return 0;
  }
  const left = words(a);
  const right = words(b);
  const shared = [...left].filter((word) => right.has(word)).length;
  return shared / Math.max(1, Math.min(left.size, right.size));
}

const SUGGESTION_THRESHOLD = 0.5;
const SUGGESTIONS = 6;

export function courseTerm(course: Course) {
  return course.term ?? termOf(course.name);
}

function score(members: Course[], candidate: Course) {
  return Math.max(
    0,
    ...members.map((member) => {
      const sameTerm = !courseTerm(member) || !courseTerm(candidate) || courseTerm(member) === courseTerm(candidate);
      return sameTerm ? similarity(`${member.id} ${member.name}`, `${candidate.id} ${candidate.name}`) : 0;
    }),
  );
}

export function suggestMerges(members: Course[], candidates: Course[]) {
  return candidates
    .map((course) => ({ course, score: score(members, course) }))
    .filter((entry) => entry.score >= SUGGESTION_THRESHOLD)
    .sort((a, b) => b.score - a.score)
    .slice(0, SUGGESTIONS)
    .map((entry) => entry.course);
}

export function sameCourse(member: Course, candidate: Course) {
  if (candidate.source === 'usos' && member.name.includes(candidate.id)) {
    return true;
  }
  return (
    courseTitle(member.name).toLowerCase() === courseTitle(candidate.name).toLowerCase() &&
    !!courseTerm(member) &&
    courseTerm(member) === courseTerm(candidate)
  );
}

export function sameCourses(members: Course[], candidates: Course[]) {
  const matched = candidates.filter((candidate) => members.some((member) => sameCourse(member, candidate)));
  const usos = matched.filter((course) => course.source === 'usos');
  return members.some((member) => member.source === 'usos') || usos.length <= 1
    ? matched
    : matched.filter((course) => course.source !== 'usos');
}

const SOURCE_ORDER: SourceKind[] = ['usos', 'moodle', 'teams'];

export function membersCaption(members: CourseRef[]) {
  return SOURCE_ORDER.map((source) => [source, members.filter((member) => member.source === source).length] as const)
    .filter(([, count]) => count > 0)
    .map(([source, count]) => `${sourceNames[source]}${count > 1 ? ` ×${count}` : ''}`)
    .join(' · ');
}

export function editSubject(source: SourceKind, courseId: string, name?: string) {
  router.push({ pathname: '/subject/edit', params: { source, course: courseId, name } });
}

export function courseCaption(course: Course) {
  return [sourceNames[course.source], courseDetail(course.name), termLabel(courseTerm(course))]
    .filter(Boolean)
    .join(' · ');
}

const GLYPH_HINTS: [RegExp, string][] = [
  [/analiz|calculus|rachunek różn/i, 'function-variant'],
  [/algebr|macierz|matrix/i, 'matrix'],
  [/prawdopodob|statyst|probab/i, 'dice-multiple-outline'],
  [/dyskretn|graf|logik|mnogo/i, 'vector-polyline'],
  [/liczb|arytm/i, 'numeric'],
  [/bazy danych|database|sql/i, 'database-outline'],
  [/sieci|network/i, 'lan'],
  [/systemy operac|operating/i, 'cog-outline'],
  [/internet|web|html/i, 'web'],
  [/algorytm|struktur/i, 'sitemap-outline'],
  [/programow|paradygmat|code|warsztat/i, 'code-braces'],
  [/informaty|komputer/i, 'laptop'],
  [/angiel|język|lektorat|english|polsk/i, 'translate'],
  [/fizyk|physic/i, 'atom'],
  [/siłown|wf|sport|wychowanie fiz/i, 'dumbbell'],
  [/bhp|bezpiecze/i, 'shield-check-outline'],
  [/egzamin|exam/i, 'clipboard-text-outline'],
  [/matematy|math/i, 'math-compass'],
];

export function autoGlyph(name: string) {
  return GLYPH_HINTS.find(([pattern]) => pattern.test(name))?.[1] ?? 'book-open-variant';
}

export function autoTint(name: string) {
  let hash = 0;
  for (const char of courseTitle(name).toLowerCase()) {
    hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  }
  return subjectPalette[hash % (subjectPalette.length - 1)];
}
