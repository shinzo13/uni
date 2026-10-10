import type { Attachment, CourseItem } from '@/api/types';

export type FileKind = 'pdf' | 'slides' | 'document' | 'sheet' | 'archive' | 'image' | 'code' | 'notebook' | 'video' | 'audio' | 'other';

export type Shelf = 'info' | 'tasks' | 'lectures' | 'files' | 'links' | 'discussion';

const EXTENSIONS: [RegExp, FileKind][] = [
  [/\.pdf$/i, 'pdf'],
  [/\.(pptx?|odp|key)$/i, 'slides'],
  [/\.(docx?|odt|rtf|txt|md)$/i, 'document'],
  [/\.(xlsx?|ods|csv)$/i, 'sheet'],
  [/\.(zip|rar|7z|tar|gz)$/i, 'archive'],
  [/\.(png|jpe?g|gif|svg|webp|heic)$/i, 'image'],
  [/\.ipynb$/i, 'notebook'],
  [/\.(py|java|c|cpp|h|js|ts|sql|sh|hs|rs|go|kt)$/i, 'code'],
  [/\.(mp4|mov|mkv|webm|avi)$/i, 'video'],
  [/\.(mp3|wav|m4a|ogg)$/i, 'audio'],
];

export const FILE_GLYPHS: Record<FileKind, string> = {
  pdf: 'file-pdf-box',
  slides: 'file-powerpoint-box',
  document: 'file-word-box',
  sheet: 'file-excel-box',
  archive: 'folder-zip-outline',
  image: 'file-image-outline',
  code: 'file-code-outline',
  notebook: 'notebook-outline',
  video: 'file-video-outline',
  audio: 'file-music-outline',
  other: 'file-document-outline',
};

export const FILE_COLORS: Record<FileKind, string> = {
  pdf: '#C62828',
  slides: '#D84315',
  document: '#1565A8',
  sheet: '#2E7D32',
  archive: '#6D4C41',
  image: '#7B1FA2',
  code: '#37474F',
  notebook: '#E65100',
  video: '#AD1457',
  audio: '#00838F',
  other: '#5F6368',
};

const KIND_GLYPHS: Record<CourseItem['kind'], string> = {
  page: 'text-box-outline',
  file: 'file-document-outline',
  folder: 'folder-outline',
  link: 'link-variant',
  label: 'note-text-outline',
  assignment: 'clipboard-check-outline',
  quiz: 'help-circle-outline',
  forum: 'forum-outline',
  other: 'puzzle-outline',
};

export const KIND_LABELS: Record<CourseItem['kind'], string> = {
  page: 'Page',
  file: 'File',
  folder: 'Folder',
  link: 'Link',
  label: 'Note',
  assignment: 'Assignment',
  quiz: 'Quiz',
  forum: 'Forum',
  other: 'Activity',
};

const LECTURE_TITLES = /wykład|wyklad|lecture|slajd|slide|prezentac|moduł|modul|rozdział|chapter|notatk/i;
const INFO_TITLES = /warunki|zasady|regulamin|sylabus|syllabus|literatur|dyżur|dyzur|konsultac|harmonogram|kontakt|organizac/i;

export function fileKind(attachment: Attachment): FileKind {
  const byName = EXTENSIONS.find(([pattern]) => pattern.test(attachment.name))?.[1];
  if (byName) {
    return byName;
  }
  const mime = attachment.mime_type ?? '';
  if (mime.includes('pdf')) return 'pdf';
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('audio/')) return 'audio';
  if (mime.includes('presentation')) return 'slides';
  if (mime.includes('spreadsheet')) return 'sheet';
  if (mime.includes('word')) return 'document';
  return 'other';
}

export function itemFileKind(item: CourseItem): FileKind | null {
  if (item.kind !== 'file' || item.attachments.length === 0) {
    return null;
  }
  return fileKind(item.attachments[0]);
}

export function itemGlyph(item: CourseItem) {
  const file = itemFileKind(item);
  return file ? FILE_GLYPHS[file] : KIND_GLYPHS[item.kind];
}

export function itemColor(item: CourseItem, tint: string) {
  const file = itemFileKind(item);
  if (file) return FILE_COLORS[file];
  if (item.kind === 'assignment' || item.kind === 'quiz') return tint;
  return '#5F6368';
}

export function formatSize(bytes: number | null) {
  if (!bytes) return null;
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function itemCaption(item: CourseItem) {
  const file = itemFileKind(item);
  if (file && item.attachments.length === 1) {
    const [attachment] = item.attachments;
    const extension = attachment.name.split('.').pop()?.toUpperCase();
    return [extension && extension.length <= 5 ? extension : null, formatSize(attachment.size)].filter(Boolean).join(' · ');
  }
  if (item.kind === 'folder') {
    return `${item.attachments.length} ${item.attachments.length === 1 ? 'file' : 'files'}`;
  }
  return KIND_LABELS[item.kind];
}

export function shelfOf(item: CourseItem, sectionTitle: string): Shelf {
  if (item.kind === 'assignment' || item.kind === 'quiz') return 'tasks';
  if (item.kind === 'forum') return 'discussion';
  if (item.kind === 'link') return 'links';
  if (INFO_TITLES.test(item.title)) return 'info';
  if (item.kind === 'page') return 'lectures';
  const file = itemFileKind(item);
  if (file === 'slides' || LECTURE_TITLES.test(item.title) || LECTURE_TITLES.test(sectionTitle)) return 'lectures';
  return 'files';
}

export function isNewSince(item: CourseItem, lastSeen: string | null) {
  return !!lastSeen && !!item.modified_at && item.modified_at > lastSeen;
}

export function isVisibleItem(item: CourseItem) {
  return item.kind !== 'label' || item.html.trim().length > 0;
}
