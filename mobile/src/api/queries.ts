import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';

import { request } from '@/api/client';
import type {
  AcademicEvent,
  Assignment,
  ClassSession,
  Course,
  CourseSection,
  Exam,
  Grade,
  LinkStart,
  Page,
  Post,
  SourceKind,
  SourceStatus,
} from '@/api/types';
import { useSession } from '@/session/SessionProvider';

function usePage<T>(key: unknown[], path: string, params: Record<string, string> = {}) {
  const { token } = useSession();
  const queryClient = useQueryClient();
  const queryKey = [...key, params];
  const query = useQuery({
    queryKey,
    queryFn: () => request<Page<T>>(path, { token, params }),
    enabled: !!token,
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

export function useAssignments() {
  return usePage<Assignment>(['assignments'], '/assignments');
}

export function useCourses() {
  return usePage<Course>(['courses'], '/courses');
}

export function useSections(kind: SourceKind, courseId: string) {
  return usePage<CourseSection>(['sections', kind, courseId], `/courses/${kind}/${encodeURIComponent(courseId)}/sections`);
}

export function usePosts() {
  return usePage<Post>(['posts'], '/posts');
}

export function useGrades() {
  return usePage<Grade>(['grades'], '/grades');
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
