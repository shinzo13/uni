import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, RefreshControl, SectionList, StyleSheet, Text, View } from 'react-native';

import type { Assignment, Attachment, CourseSection, Post } from '@/api/types';
import { Attachments } from '@/components/Attachments';
import { LinkedText } from '@/components/LinkedText';
import { Loading } from '@/components/Loading';
import { type CourseData, type CourseLayoutProps, type PlacedItem, termRange, useOpeners } from '@/course/data';
import { ItemRow } from '@/course/ItemRow';
import { isNewSince, isVisibleItem, itemCaption, itemColor, itemFileKind, itemGlyph } from '@/course/items';
import { formatShortDate, formatTime, isoDate, plainText, relativeDue, startOfWeek } from '@/format';
import { colors, radii, sourceNames, spacing, tinted, type } from '@/theme';
import { useNow } from '@/useNow';

type Mode = 'updates' | 'everything';

type FeedEvent =
  | { kind: 'post'; key: string; at: number; post: Post }
  | { kind: 'opened'; key: string; at: number; assignment: Assignment }
  | {
      kind: 'due';
      key: string;
      at: number;
      assignment: Assignment;
      pinned: boolean;
    }
  | {
      kind: 'materials';
      key: string;
      at: number;
      section: CourseSection;
      course: string | null;
      items: PlacedItem[];
    };

type FeedSection = {
  key: string;
  title: string;
  caption: string | null;
  fresh: boolean;
  data: FeedEvent[];
};

type ShelfSection = {
  key: string;
  title: string;
  caption: string | null;
  data: PlacedItem[];
};

type Openers = ReturnType<typeof useOpeners>;

const DAY = 86_400_000;
const PINNED_DAYS = 7;
const PREVIEW_ITEMS = 4;
const EXCERPT_LINES = 4;

const MONTH = new Intl.DateTimeFormat('en-GB', {
  month: 'long',
  year: 'numeric',
});
const WEEKDAY_TIME = new Intl.DateTimeFormat('en-GB', {
  weekday: 'short',
  hour: '2-digit',
  minute: '2-digit',
});

const STATUS_LABELS: Record<Assignment['status'], string | null> = {
  new: 'Not submitted',
  draft: 'Draft',
  submitted: 'Submitted',
  graded: 'Graded',
  unknown: null,
};

export function FeedLayout({ data }: CourseLayoutProps) {
  const [mode, setMode] = useState<Mode>('updates');
  const openers = useOpeners(data.assignments);
  const now = useNow();
  const feed = useFeed(data, openers, now);
  const shelves = useShelves(data);
  const hasMoodle = data.moodle.length > 0;

  if (data.isLoading && feed.sections.length === 0) {
    return <Loading />;
  }

  return (
    <View style={styles.screen}>
      {hasMoodle ? (
        <View style={styles.pills} accessibilityRole="tablist">
          <Pill
            label="Updates"
            count={feed.count}
            selected={mode === 'updates'}
            tint={data.look.tint}
            onPress={() => setMode('updates')}
          />
          <Pill
            label="Everything"
            count={shelves.count}
            selected={mode === 'everything'}
            tint={data.look.tint}
            onPress={() => setMode('everything')}
          />
        </View>
      ) : null}
      {mode === 'everything' && hasMoodle ? (
        <EverythingList data={data} sections={shelves.sections} openers={openers} />
      ) : (
        <UpdatesList
          data={data}
          sections={feed.sections}
          undated={feed.undated}
          now={now}
          openers={openers}
          onBrowse={hasMoodle ? () => setMode('everything') : null}
        />
      )}
    </View>
  );
}

function useFeed(data: CourseData, openers: Openers, now: number) {
  const { items, posts, assignments, moodle, lastSeen } = data;
  const { findAssignment } = openers;
  return useMemo(() => {
    const events: FeedEvent[] = [];
    const pinned: FeedEvent[] = [];
    for (const post of posts) {
      const at = Date.parse(post.posted_at);
      if (at <= now)
        events.push({
          kind: 'post',
          key: `post:${post.source}:${post.id}`,
          at,
          post,
        });
    }
    for (const assignment of assignments) {
      const key = `${assignment.source}:${assignment.id}`;
      const opens = assignment.opens_at ? Date.parse(assignment.opens_at) : null;
      const due = assignment.due_at ? Date.parse(assignment.due_at) : null;
      if (opens !== null && opens <= now) {
        events.push({
          kind: 'opened',
          key: `opened:${key}`,
          at: opens,
          assignment,
        });
      }
      if (due !== null && due > now && due - now <= PINNED_DAYS * DAY) {
        pinned.push({
          kind: 'due',
          key: `due:${key}`,
          at: due,
          assignment,
          pinned: true,
        });
      } else if (due !== null && due <= now && opens === null) {
        events.push({
          kind: 'due',
          key: `due:${key}`,
          at: due,
          assignment,
          pinned: false,
        });
      }
    }
    const dated = items
      .filter(({ item }) => item.modified_at && isVisibleItem(item))
      .filter(
        (placed) =>
          !(placed.item.kind === 'assignment' || placed.item.kind === 'quiz') || !findAssignment(placed)?.opens_at,
      )
      .map((placed) => ({ placed, at: Date.parse(placed.item.modified_at!) }))
      .filter(({ at }) => at <= now)
      .sort((a, b) => b.at - a.at);
    const courseLabels = new Map(
      moodle.map((course) => [course.courseId, moodle.length > 1 ? (course.detail ?? course.title) : null]),
    );
    let group: Extract<FeedEvent, { kind: 'materials' }> | null = null;
    for (const { placed, at } of dated) {
      const day = isoDate(new Date(at));
      if (
        group &&
        group.section.id === placed.section.id &&
        group.items[0].courseId === placed.courseId &&
        isoDate(new Date(group.at)) === day
      ) {
        group.items.push(placed);
        continue;
      }
      group = {
        kind: 'materials',
        key: `materials:${placed.courseId}:${placed.section.id}:${placed.item.id}`,
        at,
        section: placed.section,
        course: courseLabels.get(placed.courseId) ?? null,
        items: [placed],
      };
      events.push(group);
    }
    events.sort((a, b) => b.at - a.at);
    pinned.sort((a, b) => a.at - b.at);

    const sections: FeedSection[] = [];
    if (pinned.length > 0) {
      sections.push({
        key: 'pinned',
        title: 'Due this week',
        caption: null,
        fresh: false,
        data: pinned,
      });
    }
    const seen = lastSeen ? Date.parse(lastSeen) : null;
    const weekStart = startOfWeek(new Date(now)).getTime();
    const termStart = new Date(`${termRange(new Date(now)).start}T00:00:00`).getTime();
    for (const event of events) {
      const bucket = bucketOf(event.at, seen, weekStart, termStart);
      const last = sections[sections.length - 1];
      if (last && last.key === bucket.key) {
        last.data.push(event);
      } else {
        sections.push({ ...bucket, data: [event] });
      }
    }
    const undated = items.filter(({ item }) => !item.modified_at && isVisibleItem(item)).length;
    return { sections, count: events.length + pinned.length, undated };
  }, [items, posts, assignments, moodle, lastSeen, findAssignment, now]);
}

function bucketOf(at: number, seen: number | null, weekStart: number, termStart: number) {
  if (seen !== null && at > seen) {
    return {
      key: 'fresh',
      title: 'Since your last visit',
      caption: `after ${formatShortDate(new Date(seen))}`,
      fresh: true,
    };
  }
  if (at >= weekStart) return { key: 'week', title: 'This week', caption: null, fresh: false };
  if (at >= weekStart - 7 * DAY)
    return {
      key: 'last-week',
      title: 'Last week',
      caption: null,
      fresh: false,
    };
  if (at >= termStart)
    return {
      key: 'term',
      title: 'Earlier this semester',
      caption: null,
      fresh: false,
    };
  const month = MONTH.format(new Date(at));
  return { key: `month:${month}`, title: month, caption: null, fresh: false };
}

function useShelves(data: CourseData) {
  const { moodle } = data;
  return useMemo(() => {
    const sections: ShelfSection[] = moodle.flatMap((course) =>
      course.sections
        .map((section) => ({
          key: `${course.courseId}:${section.id}`,
          title: section.title,
          caption: moodle.length > 1 ? (course.detail ?? course.title) : null,
          data: section.items.filter(isVisibleItem).map((item) => ({ item, section, courseId: course.courseId })),
        }))
        .filter((section) => section.data.length > 0),
    );
    return {
      sections,
      count: sections.reduce((sum, section) => sum + section.data.length, 0),
    };
  }, [moodle]);
}

function Pill({
  label,
  count,
  selected,
  tint,
  onPress,
}: {
  label: string;
  count: number;
  selected: boolean;
  tint: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={[styles.pill, selected ? { backgroundColor: tinted(tint, 0.14) } : styles.pillIdle]}
    >
      {selected ? <MaterialCommunityIcons name="check" size={16} color={tint} /> : null}
      <Text style={[styles.pillLabel, selected && { color: tint }]}>{label}</Text>
      {count > 0 ? <Text style={[styles.pillCount, selected && { color: tint }]}>{count}</Text> : null}
    </Pressable>
  );
}

function UpdatesList({
  data,
  sections,
  undated,
  now,
  openers,
  onBrowse,
}: {
  data: CourseData;
  sections: FeedSection[];
  undated: number;
  now: number;
  openers: Openers;
  onBrowse: (() => void) | null;
}) {
  const tint = data.look.tint;
  return (
    <SectionList
      sections={sections}
      keyExtractor={(event) => event.key}
      stickySectionHeadersEnabled
      contentContainerStyle={sections.length === 0 ? styles.grow : styles.content}
      refreshControl={
        <RefreshControl refreshing={data.refreshing} onRefresh={data.refresh} colors={[tint]} tintColor={tint} />
      }
      renderSectionHeader={({ section }) => <BucketHeader section={section} tint={tint} />}
      renderItem={({ item, index, section }) => (
        <TimelineRow
          event={item}
          tint={tint}
          fresh={section.fresh}
          first={index === 0}
          last={index === section.data.length - 1}
          now={now}
          openers={openers}
        />
      )}
      ListEmptyComponent={<UpdatesEmpty undated={undated} tint={tint} onBrowse={onBrowse} />}
      ListFooterComponent={
        sections.length > 0 && undated > 0 && onBrowse ? (
          <Pressable onPress={onBrowse} style={({ pressed }) => [styles.footer, pressed && styles.pressed]}>
            <MaterialCommunityIcons name="calendar-question" size={20} color={colors.muted} />
            <Text style={[type.caption, styles.grow]}>
              {undated} {undated === 1 ? 'material has' : 'materials have'} no date, so{' '}
              {undated === 1 ? 'it is' : 'they are'} only in the full course structure
            </Text>
            <Text style={[styles.footerAction, { color: tint }]}>Everything</Text>
          </Pressable>
        ) : null
      }
    />
  );
}

function UpdatesEmpty({ undated, tint, onBrowse }: { undated: number; tint: string; onBrowse: (() => void) | null }) {
  const browsable = undated > 0 && onBrowse;
  return (
    <View style={styles.empty}>
      <View style={[styles.emptyIcon, { backgroundColor: tinted(tint, 0.12) }]}>
        <MaterialCommunityIcons name="timeline-clock-outline" size={32} color={tint} />
      </View>
      <Text style={[type.titleLarge, styles.center]}>{browsable ? 'No dated updates' : 'Nothing here yet'}</Text>
      <Text style={[type.body, styles.emptyHint]}>
        {browsable
          ? `This course has ${undated} ${undated === 1 ? 'material' : 'materials'}, but Moodle doesn't say when they were added, so they can't go on the timeline.`
          : 'Announcements, new assignments and materials appear here, newest first, as teachers publish them.'}
      </Text>
      {browsable ? (
        <Pressable
          onPress={onBrowse}
          style={({ pressed }) => [styles.emptyButton, { backgroundColor: tint }, pressed && styles.dim]}
        >
          <Text style={styles.emptyButtonLabel}>Browse everything</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function BucketHeader({ section, tint }: { section: FeedSection; tint: string }) {
  const pinned = section.key === 'pinned';
  return (
    <View style={styles.bucket}>
      <View style={styles.bucketRail}>
        {section.fresh || pinned ? (
          <MaterialCommunityIcons
            name={pinned ? 'pin' : 'star-four-points'}
            size={14}
            color={pinned ? colors.danger : tint}
          />
        ) : (
          <View style={styles.bucketTick} />
        )}
      </View>
      <Text style={[styles.bucketTitle, section.fresh && { color: tint }, pinned && { color: colors.danger }]}>
        {section.title}
      </Text>
      {section.caption ? <Text style={type.caption}>{section.caption}</Text> : null}
      <Text style={[type.caption, styles.bucketCount]}>{section.data.length}</Text>
    </View>
  );
}

function TimelineRow({
  event,
  tint,
  fresh,
  first,
  last,
  now,
  openers,
}: {
  event: FeedEvent;
  tint: string;
  fresh: boolean;
  first: boolean;
  last: boolean;
  now: number;
  openers: Openers;
}) {
  const node = nodeOf(event, tint, now);
  return (
    <View style={styles.row}>
      <View style={styles.rail}>
        <View
          style={[
            styles.line,
            first && styles.lineFirst,
            last && styles.lineLast,
            { backgroundColor: tinted(tint, 0.25) },
          ]}
        />
        <View style={[styles.node, { backgroundColor: fresh ? node.color : tinted(node.color, 0.14) }]}>
          <MaterialCommunityIcons name={node.icon as never} size={15} color={fresh ? colors.background : node.color} />
        </View>
      </View>
      <View style={styles.body}>
        {event.kind === 'post' ? <PostEvent post={event.post} tint={tint} at={event.at} now={now} /> : null}
        {event.kind === 'opened' || event.kind === 'due' ? (
          <AssignmentEvent event={event} tint={tint} now={now} />
        ) : null}
        {event.kind === 'materials' ? <MaterialsEvent event={event} tint={tint} now={now} openers={openers} /> : null}
      </View>
    </View>
  );
}

function nodeOf(event: FeedEvent, tint: string, now: number) {
  if (event.kind === 'post') return { icon: 'bullhorn-outline', color: tint };
  if (event.kind === 'due')
    return {
      icon: 'flag-outline',
      color: event.at - now < DAY && event.pinned ? colors.danger : tint,
    };
  if (event.kind === 'opened') return { icon: 'clipboard-plus-outline', color: tint };
  const kinds = new Set(event.items.map(({ item }) => itemFileKind(item) ?? item.kind));
  if (kinds.size === 1)
    return {
      icon: itemGlyph(event.items[0].item),
      color: itemColor(event.items[0].item, tint),
    };
  return { icon: 'file-multiple-outline', color: tint };
}

function whenLabel(at: number, now: number) {
  return now - at < 7 * DAY ? WEEKDAY_TIME.format(new Date(at)) : formatShortDate(new Date(at));
}

function EventMeta({ label, at, now }: { label: string; at: number; now: number }) {
  return (
    <View style={styles.meta}>
      <Text style={[type.label, styles.grow]} numberOfLines={1}>
        {label}
      </Text>
      <Text style={type.caption}>{whenLabel(at, now)}</Text>
    </View>
  );
}

function PostEvent({ post, tint, at, now }: { post: Post; tint: string; at: number; now: number }) {
  const [open, setOpen] = useState(false);
  const [clipped, setClipped] = useState(false);
  const excerpt = useMemo(() => plainText(post.body_html), [post.body_html]);
  const author = post.author ?? sourceNames[post.source];
  return (
    <View style={styles.post}>
      <EventMeta label={`${author} posted`} at={at} now={now} />
      {post.title ? <Text style={type.title}>{post.title}</Text> : null}
      {open ? (
        <LinkedText html={post.body_html} />
      ) : (
        <Text
          style={type.body}
          numberOfLines={EXCERPT_LINES}
          onTextLayout={(layout) => setClipped(layout.nativeEvent.lines.length >= EXCERPT_LINES)}
        >
          {excerpt}
        </Text>
      )}
      {open ? <Attachments source={post.source} attachments={post.attachments} /> : null}
      <View style={styles.postFooter}>
        {post.attachments.length > 0 && !open ? (
          <View style={styles.inline}>
            <MaterialCommunityIcons name="paperclip" size={14} color={colors.muted} />
            <Text style={type.caption}>{post.attachments.length}</Text>
          </View>
        ) : null}
        {post.replies.length > 0 ? (
          <View style={styles.inline}>
            <MaterialCommunityIcons name="comment-outline" size={14} color={colors.muted} />
            <Text style={type.caption}>{post.replies.length}</Text>
          </View>
        ) : null}
        <View style={styles.grow} />
        {clipped || open || post.attachments.length > 0 ? (
          <Pressable onPress={() => setOpen(!open)} hitSlop={12} style={styles.more}>
            <Text style={[styles.moreLabel, { color: tint }]}>{open ? 'Show less' : 'Show more'}</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

function AssignmentEvent({
  event,
  tint,
  now,
}: {
  event: Extract<FeedEvent, { kind: 'opened' | 'due' }>;
  tint: string;
  now: number;
}) {
  const { assignment } = event;
  const due = assignment.due_at ? Date.parse(assignment.due_at) : null;
  const urgent = due !== null && due > now && due - now < DAY;
  const done = assignment.status === 'submitted' || assignment.status === 'graded';
  const status =
    assignment.status === 'graded' && assignment.grade
      ? `Graded · ${assignment.grade}`
      : STATUS_LABELS[assignment.status];
  const pinned = event.kind === 'due' && event.pinned;
  const label =
    event.kind === 'opened'
      ? `New ${assignment.kind === 'quiz' ? 'quiz' : 'assignment'}`
      : pinned
        ? `Due ${WEEKDAY_TIME.format(new Date(event.at))}`
        : 'Deadline passed';
  const accent = urgent && !done ? colors.danger : tint;
  return (
    <Pressable
      onPress={() =>
        router.push({
          pathname: '/assignment/[id]',
          params: { id: assignment.id, source: assignment.source },
        })
      }
      style={({ pressed }) => [
        styles.task,
        pinned
          ? {
              backgroundColor: tinted(accent, 0.08),
              borderColor: tinted(accent, 0.3),
            }
          : null,
        pressed && styles.dim,
      ]}
      accessibilityRole="button"
      accessibilityLabel={assignment.title}
    >
      {pinned ? (
        <View style={styles.meta}>
          <Text style={[type.label, styles.grow, { color: accent }]}>{label}</Text>
          <Text style={type.caption}>{sourceNames[assignment.source]}</Text>
        </View>
      ) : (
        <EventMeta label={label} at={event.at} now={now} />
      )}
      <Text style={type.title} numberOfLines={2}>
        {assignment.title}
      </Text>
      <View style={styles.chips}>
        {due !== null && !done ? (
          <View style={[styles.chip, { backgroundColor: tinted(accent, 0.12) }]}>
            <MaterialCommunityIcons name="clock-outline" size={14} color={accent} />
            <Text style={[styles.chipLabel, { color: accent }]}>
              {due > now
                ? `due ${relativeDue(assignment.due_at!, new Date(now))}`
                : `was due ${formatShortDate(new Date(due))}`}
            </Text>
          </View>
        ) : null}
        {status ? (
          <View style={[styles.chip, done ? { backgroundColor: tinted(colors.success, 0.12) } : styles.chipNeutral]}>
            {done ? <MaterialCommunityIcons name="check" size={14} color={colors.success} /> : null}
            <Text style={[styles.chipLabel, { color: done ? colors.success : colors.muted }]}>{status}</Text>
          </View>
        ) : null}
        {due !== null && !pinned ? <Text style={type.caption}>{formatTime(assignment.due_at!)}</Text> : null}
      </View>
    </Pressable>
  );
}

function MaterialsEvent({
  event,
  tint,
  now,
  openers,
}: {
  event: Extract<FeedEvent, { kind: 'materials' }>;
  tint: string;
  now: number;
  openers: Openers;
}) {
  const [expanded, setExpanded] = useState(false);
  const { items } = event;
  const allFiles = items.every(({ item }) => item.kind === 'file');
  const noun = allFiles ? (items.length === 1 ? 'file' : 'files') : items.length === 1 ? 'material' : 'materials';
  const where = [event.course, event.section.title].filter(Boolean).join(' · ');
  const shown = expanded ? items : items.slice(0, PREVIEW_ITEMS);
  const hidden = items.length - shown.length;
  return (
    <View style={styles.materials}>
      <EventMeta label={items.length === 1 ? `New ${noun}` : `${items.length} ${noun} added`} at={event.at} now={now} />
      <Text style={type.caption} numberOfLines={1}>
        in <Text style={styles.where}>{where || 'Course'}</Text>
      </Text>
      <View style={styles.tiles}>
        {shown.map((placed) => (
          <MaterialTile key={`${placed.courseId}:${placed.item.id}`} placed={placed} tint={tint} openers={openers} />
        ))}
      </View>
      {hidden > 0 || expanded ? (
        <Pressable onPress={() => setExpanded(!expanded)} hitSlop={8} style={styles.more}>
          <Text style={[styles.moreLabel, { color: tint }]}>{expanded ? 'Show less' : `Show ${hidden} more`}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function MaterialTile({ placed, tint, openers }: { placed: PlacedItem; tint: string; openers: Openers }) {
  const { item } = placed;
  const color = itemColor(item, tint);
  const multiple = item.kind === 'folder' || item.attachments.length > 1;
  return (
    <View>
      <Pressable
        onPress={() => openers.openItem(placed)}
        style={({ pressed }) => [styles.tile, { borderColor: tinted(color, 0.22) }, pressed && styles.pressed]}
        accessibilityRole="button"
        accessibilityLabel={item.title}
      >
        <View style={[styles.tileGlyph, { backgroundColor: color }]}>
          <MaterialCommunityIcons name={itemGlyph(item) as never} size={20} color={colors.background} />
        </View>
        <View style={styles.grow}>
          <Text style={styles.tileTitle} numberOfLines={2}>
            {item.title}
          </Text>
          <Text style={type.caption} numberOfLines={1}>
            {itemCaption(item)}
          </Text>
        </View>
        <MaterialCommunityIcons
          name={multiple ? 'folder-open-outline' : 'chevron-right'}
          size={20}
          color={colors.muted}
        />
      </Pressable>
      {multiple && item.attachments.length > 0 ? (
        <AttachmentChips attachments={item.attachments} onOpen={openers.openAttachment} />
      ) : null}
    </View>
  );
}

function AttachmentChips({ attachments, onOpen }: { attachments: Attachment[]; onOpen: Openers['openAttachment'] }) {
  return (
    <View style={styles.attachmentChips}>
      {attachments.slice(0, 6).map((attachment) => (
        <Pressable
          key={attachment.url}
          onPress={() => onOpen(attachment).catch(() => undefined)}
          style={({ pressed }) => [styles.attachmentChip, pressed && styles.dim]}
        >
          <Text style={styles.attachmentChipLabel} numberOfLines={1}>
            {attachment.name}
          </Text>
        </Pressable>
      ))}
      {attachments.length > 6 ? <Text style={type.caption}>+{attachments.length - 6}</Text> : null}
    </View>
  );
}

function EverythingList({ data, sections, openers }: { data: CourseData; sections: ShelfSection[]; openers: Openers }) {
  const tint = data.look.tint;
  return (
    <SectionList
      sections={sections}
      keyExtractor={(placed) => `${placed.courseId}:${placed.item.id}`}
      stickySectionHeadersEnabled
      contentContainerStyle={sections.length === 0 ? styles.grow : styles.content}
      refreshControl={
        <RefreshControl refreshing={data.refreshing} onRefresh={data.refresh} colors={[tint]} tintColor={tint} />
      }
      renderSectionHeader={({ section }) => (
        <View style={styles.shelfHeader}>
          <View style={[styles.shelfMark, { backgroundColor: tint }]} />
          <View style={styles.grow}>
            {section.caption ? <Text style={type.label}>{section.caption}</Text> : null}
            <Text style={type.title} numberOfLines={2}>
              {section.title}
            </Text>
          </View>
          <Text style={type.caption}>{section.data.length}</Text>
        </View>
      )}
      renderItem={({ item: placed }) => (
        <ItemRow
          placed={placed}
          tint={tint}
          isNew={isNewSince(placed.item, data.lastSeen)}
          caption={
            placed.item.modified_at
              ? `${itemCaption(placed.item)} · ${formatShortDate(placed.item.modified_at)}`
              : itemCaption(placed.item)
          }
          onOpen={openers.openItem}
          onOpenAttachment={(attachment) => openers.openAttachment(attachment).catch(() => undefined)}
        />
      )}
      renderSectionFooter={() => <View style={styles.shelfGap} />}
      ListEmptyComponent={
        <View style={styles.empty}>
          <Text style={[type.titleLarge, styles.center]}>No materials yet</Text>
          <Text style={[type.body, styles.emptyHint]}>
            Materials appear here when the teacher publishes them on Moodle.
          </Text>
        </View>
      }
    />
  );
}

const RAIL = 48;

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  grow: { flexGrow: 1, flexShrink: 1 },
  content: { paddingBottom: spacing.xl },
  center: { textAlign: 'center' },
  pressed: { backgroundColor: colors.surface },
  dim: { opacity: 0.7 },
  pills: {
    flexDirection: 'row',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    paddingBottom: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs + 2,
    minHeight: 40,
    paddingHorizontal: spacing.md,
    borderRadius: radii.pill,
  },
  pillIdle: { borderWidth: 1, borderColor: colors.border },
  pillLabel: { fontSize: 14, fontWeight: '600', color: colors.text },
  pillCount: { fontSize: 13, color: colors.muted },
  bucket: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingRight: spacing.md,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
    backgroundColor: colors.background,
  },
  bucketRail: { width: RAIL, alignItems: 'center' },
  bucketTick: {
    width: 10,
    height: 2,
    borderRadius: 1,
    backgroundColor: colors.border,
  },
  bucketTitle: {
    ...type.label,
    fontSize: 13,
    textTransform: 'uppercase',
    color: colors.text,
  },
  bucketCount: { marginLeft: 'auto' },
  row: { flexDirection: 'row', paddingRight: spacing.md },
  rail: { width: RAIL, alignItems: 'center' },
  line: { position: 'absolute', top: 0, bottom: 0, width: 2 },
  lineFirst: { top: 14 },
  lineLast: { bottom: undefined, height: 14 },
  node: {
    marginTop: 2,
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 3,
    borderColor: colors.background,
  },
  body: { flex: 1, paddingBottom: spacing.lg },
  meta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: 32,
  },
  inline: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  post: {
    gap: spacing.xs + 2,
    padding: spacing.md,
    paddingTop: spacing.xs,
    borderRadius: radii.lg,
    backgroundColor: colors.surface,
  },
  postFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: 32,
  },
  more: { minHeight: 36, justifyContent: 'center' },
  moreLabel: { ...type.label, fontSize: 13 },
  task: {
    gap: spacing.xs + 2,
    padding: spacing.md,
    paddingTop: spacing.xs,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: 2,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: spacing.sm + 2,
    paddingVertical: 4,
    borderRadius: radii.pill,
  },
  chipNeutral: { backgroundColor: colors.surface },
  chipLabel: { fontSize: 13, fontWeight: '600' },
  materials: { gap: 2 },
  where: { color: colors.text, fontWeight: '600' },
  tiles: { gap: spacing.sm, marginTop: spacing.sm },
  tile: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: 56,
    paddingHorizontal: spacing.sm + 2,
    paddingVertical: spacing.sm,
    borderRadius: radii.md,
    borderWidth: 1,
  },
  tileGlyph: {
    width: 36,
    height: 36,
    borderRadius: radii.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tileTitle: {
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '500',
    color: colors.text,
  },
  attachmentChips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: spacing.xs + 2,
    marginTop: spacing.xs + 2,
  },
  attachmentChip: {
    maxWidth: '48%',
    minHeight: 32,
    justifyContent: 'center',
    paddingHorizontal: spacing.sm + 2,
    borderRadius: radii.pill,
    backgroundColor: colors.surface,
  },
  attachmentChipLabel: { fontSize: 13, color: colors.text },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginHorizontal: spacing.md,
    marginTop: spacing.sm,
    padding: spacing.md,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border,
    borderStyle: 'dashed',
  },
  footerAction: { ...type.label, fontSize: 13 },
  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
    gap: spacing.sm,
  },
  emptyIcon: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.sm,
  },
  emptyHint: { color: colors.muted, textAlign: 'center' },
  emptyButton: {
    marginTop: spacing.md,
    minHeight: 48,
    paddingHorizontal: spacing.lg,
    borderRadius: radii.pill,
    justifyContent: 'center',
  },
  emptyButtonLabel: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.background,
  },
  shelfHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
    backgroundColor: colors.background,
  },
  shelfMark: { width: 4, alignSelf: 'stretch', borderRadius: 2 },
  shelfGap: { height: spacing.sm },
});
