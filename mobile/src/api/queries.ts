import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';

import { request } from '@/api/client';
import type {
  AcademicEvent,
  Assignment,
  ClassSession,
  Course,
  CourseRef,
  CourseSection,
  Exam,
  Grade,
  LinkStart,
  Page,
  Post,
  SourceKind,
  SourceStatus,
  Subject,
  SubjectDraft,
} from '@/api/types';
import { formatScore } from '@/format';
import { useSession } from '@/session/SessionProvider';

function usePage<T>(
  key: unknown[],
  path: string,
  params: Record<string, string> = {},
  select?: (page: Page<T>) => Page<T>,
) {
  const { token } = useSession();
  const queryClient = useQueryClient();
  const queryKey = [...key, params];
  const query = useQuery({
    queryKey,
    queryFn: () => request<Page<T>>(path, { token, params }),
    enabled: !!token,
    select,
  });
  const [refreshing, setRefreshing] = useState(false);
  const refresh = async () => {
    setRefreshing(true);
    try {
      queryClient.setQueryData(queryKey, await request<Page<T>>(path, { token, params: { ...params, refresh: true } }));
    } finally {
      setRefreshing(false);
    }
  };
  return { ...query, refresh, refreshing };
}

export function useClasses(start: string, end: string) {
  return usePage<ClassSession>(['classes'], '/schedule/classes', { start, end });
}

export function useExams() {
  return usePage<Exam>(['exams'], '/schedule/exams');
}

export function useAcademicEvents(start: string, end: string) {
  return usePage<AcademicEvent>(['events'], '/schedule/events', { start, end });
}

function readableAssignments(page: Page<Assignment>) {
  return {
    ...page,
    items: page.items.map((item) => (item.grade ? { ...item, grade: formatScore(item.grade) } : item)),
  };
}

function readableGrades(page: Page<Grade>) {
  return {
    ...page,
    items: page.items.map((grade) => ({
      ...grade,
      value: formatScore(grade.value),
      max_value: grade.max_value && formatScore(grade.max_value),
    })),
  };
}

export function useAssignments() {
  return usePage<Assignment>(['assignments'], '/assignments', {}, readableAssignments);
}

export function useCourses() {
  return usePage<Course>(['courses'], '/courses');
}

export function useSections(kind: SourceKind, courseId: string) {
  return usePage<CourseSection>(
    ['sections', kind, courseId],
    `/courses/${kind}/${encodeURIComponent(courseId)}/sections`,
  );
}

export function usePosts() {
  return usePage<Post>(['posts'], '/posts');
}

export function useGrades() {
  return usePage<Grade>(['grades'], '/grades', {}, readableGrades);
}

export function useSources() {
  const { token } = useSession();
  return useQuery({
    queryKey: ['sources'],
    queryFn: () => request<SourceStatus[]>('/sources', { token }),
    enabled: !!token,
  });
}

export function useSourceActions() {
  const { token } = useSession();
  const queryClient = useQueryClient();
  const unlink = useMutation({
    mutationFn: (kind: SourceKind) => request<void>(`/sources/${kind}`, { method: 'DELETE', token }),
    onSuccess: () => queryClient.invalidateQueries(),
  });
  const actions = useMemo(() => {
    const invalidate = () => queryClient.invalidateQueries();
    return {
      start: (kind: SourceKind) => request<LinkStart>(`/sources/${kind}/link`, { method: 'POST', token }),
      completeMoodle: (redirect: string) =>
        request<void>('/sources/moodle/complete', { method: 'POST', token, body: { redirect } }).then(invalidate),
      pollTeams: async () => {
        const result = await request<{ linked: boolean }>('/sources/teams/complete', { method: 'POST', token });
        if (result.linked) {
          await invalidate();
        }
        return result.linked;
      },
      refresh: invalidate,
    };
  }, [queryClient, token]);
  return { ...actions, unlink };
}

export function useSubjects() {
  const { token } = useSession();
  return useQuery({
    queryKey: ['subjects'],
    queryFn: () => request<Subject[]>('/subjects', { token }),
    enabled: !!token,
  });
}

export function useSubjectActions() {
  const { token } = useSession();
  const queryClient = useQueryClient();
  return useMemo(() => {
    const invalidate = () => queryClient.invalidateQueries({ queryKey: ['subjects'] });
    return {
      save: (draft: SubjectDraft, id?: string) =>
        request<Subject>(id ? `/subjects/${id}` : '/subjects', {
          method: id ? 'PUT' : 'POST',
          token,
          body: draft,
        }).then(invalidate),
      remove: (id: string) => request<void>(`/subjects/${id}`, { method: 'DELETE', token }).then(invalidate),
    };
  }, [queryClient, token]);
}

function combineSections(results: { data?: Page<CourseSection>; isLoading: boolean }[]) {
  return {
    pages: results.map((result) => result.data),
    isLoading: results.some((result) => result.isLoading),
  };
}

function sectionsPath(ref: CourseRef) {
  return `/courses/${ref.source}/${encodeURIComponent(ref.course_id)}/sections`;
}

export function useMaterialSections(refs: CourseRef[]) {
  const { token } = useSession();
  const queryClient = useQueryClient();
  const [refreshing, setRefreshing] = useState(false);
  const { pages, isLoading } = useQueries({
    queries: refs.map((ref) => ({
      queryKey: ['sections', ref.source, ref.course_id, {}],
      queryFn: () => request<Page<CourseSection>>(sectionsPath(ref), { token }),
      enabled: !!token,
    })),
    combine: combineSections,
  });
  const refresh = async () => {
    setRefreshing(true);
    try {
      await Promise.all(
        refs.map(async (ref) =>
          queryClient.setQueryData(
            ['sections', ref.source, ref.course_id, {}],
            await request<Page<CourseSection>>(sectionsPath(ref), { token, params: { refresh: true } }),
          ),
        ),
      );
    } finally {
      setRefreshing(false);
    }
  };
  return {
    pages,
    isLoading,
    refresh,
    refreshing,
  };
}

export function useCompletion() {
  const { token } = useSession();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ courseId, itemId, completed }: { courseId: string; itemId: string; completed: boolean }) =>
      request<void>(`/courses/moodle/${encodeURIComponent(courseId)}/items/${encodeURIComponent(itemId)}/completion`, {
        method: 'POST',
        token,
        body: { completed },
      }),
    onMutate: ({ courseId, itemId, completed }) => {
      const key = ['sections', 'moodle', courseId, {}];
      const previous = queryClient.getQueryData<Page<CourseSection>>(key);
      if (previous) {
        queryClient.setQueryData<Page<CourseSection>>(key, {
          ...previous,
          items: previous.items.map((section) => ({
            ...section,
            items: section.items.map((item) =>
              item.id === itemId ? { ...item, completion: completed ? 'complete' : 'incomplete' } : item,
            ),
          })),
        });
      }
      return { key, previous };
    },
    onError: (_error, _variables, context) => {
      if (context?.previous) {
        queryClient.setQueryData(context.key, context.previous);
      }
    },
  });
}

export function useItemHtml(courseId: string, itemId: string) {
  const { token } = useSession();
  return useQuery({
    queryKey: ['item-html', courseId, itemId],
    queryFn: () =>
      request<{ title: string; html: string }>(
        `/courses/moodle/${encodeURIComponent(courseId)}/items/${encodeURIComponent(itemId)}/html`,
        { token },
      ),
    enabled: !!token,
    staleTime: 0,
    gcTime: 0,
  });
}
