export type SourceKind = 'usos' | 'moodle' | 'teams';

export type Attachment = {
  name: string;
  url: string;
  mime_type: string | null;
  size: number | null;
};

export type Course = {
  source: SourceKind;
  id: string;
  name: string;
  term: string | null;
  url: string | null;
};

export type ClassSession = {
  source: SourceKind;
  course_id: string;
  course_name: string;
  kind: string;
  starts_at: string;
  ends_at: string;
  room: string | null;
  building: string | null;
  group_number: number | null;
};

export type AcademicEvent = {
  source: SourceKind;
  name: string;
  starts_on: string;
  ends_on: string;
  kind: string;
};

export type Exam = {
  source: SourceKind;
  id: string;
  course_id: string;
  course_name: string;
  name: string;
  starts_at: string;
  ends_at: string;
  room: string | null;
  building: string | null;
};

export type AssignmentStatus = 'new' | 'draft' | 'submitted' | 'graded' | 'unknown';

export type Assignment = {
  source: SourceKind;
  id: string;
  course_id: string;
  course_name: string;
  title: string;
  kind: 'assignment' | 'quiz';
  description_html: string;
  opens_at: string | null;
  due_at: string | null;
  status: AssignmentStatus;
  submitted_at: string | null;
  grade: string | null;
  url: string | null;
  attachments: Attachment[];
};

export type ItemKind = 'page' | 'file' | 'folder' | 'link' | 'label' | 'assignment' | 'quiz' | 'forum' | 'other';

export type CourseItem = {
  id: string;
  kind: ItemKind;
  title: string;
  url: string | null;
  html: string;
  attachments: Attachment[];
};

export type CourseSection = {
  id: string;
  title: string;
  summary_html: string;
  items: CourseItem[];
};

export type Post = {
  source: SourceKind;
  id: string;
  course_id: string;
  course_name: string;
  author: string | null;
  title: string | null;
  body_html: string;
  posted_at: string;
  replies: Post[];
  attachments: Attachment[];
};

export type GradeKind = 'final' | 'partial' | 'points';

export type Grade = {
  source: SourceKind;
  course_id: string;
  course_name: string;
  kind: GradeKind;
  name: string;
  value: string;
  term: string | null;
  passed: boolean | null;
  max_value: string | null;
  comment: string | null;
  graded_at: string | null;
};

export type SourceState = {
  kind: SourceKind;
  fetched_at: string | null;
  error: string | null;
};

export type Page<T> = {
  items: T[];
  sources: SourceState[];
};

export type SourceStatus = {
  kind: SourceKind;
  linked: boolean;
  expired: boolean;
  linked_at: string | null;
};

export type LinkStart = {
  kind: SourceKind;
  url: string;
  user_code: string | null;
};
