import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import { router } from "expo-router";
import { useMemo, useState } from "react";
import {
  LayoutAnimation,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

import type {
  Assignment,
  ClassSession,
  CourseSection,
  Grade,
} from "@/api/types";
import { PostCard } from "@/components/PostCard";
import {
  type CourseLayoutProps,
  type MoodleCourse,
  type PlacedItem,
  useOpeners,
} from "@/course/data";
import { ItemRow } from "@/course/ItemRow";
import { isNewSince, isVisibleItem } from "@/course/items";
import {
  addDays,
  courseTitle,
  formatShortDate,
  formatTime,
  isoDate,
  plainText,
  relativeDue,
  termLabel,
} from "@/format";
import { useNow } from "@/useNow";
import { colors, radii, sourceNames, spacing, tinted, type } from "@/theme";

const WEEKDAY_SHORT = new Intl.DateTimeFormat("en-GB", {
  weekday: "short",
  day: "numeric",
  month: "short",
});
const HOUR = 3_600_000;

const STATUS_LABELS: Record<Assignment["status"], string> = {
  new: "To do",
  draft: "Draft",
  submitted: "Submitted",
  graded: "Graded",
  unknown: "",
};

type Points = { earned: number; max: number; count: number };

function parseNumber(value: string) {
  const parsed = Number(value.replace(",", ".").trim());
  return Number.isFinite(parsed) ? parsed : null;
}

function pointsOf(grades: Grade[]): Points | null {
  let earned = 0;
  let max = 0;
  let count = 0;
  for (const grade of grades) {
    if (grade.category === "semester") continue;
    const [rawValue, rawMax] = grade.value.includes("/")
      ? grade.value.split("/")
      : [grade.value, grade.max_value];
    const value = parseNumber(rawValue);
    const limit = rawMax ? parseNumber(rawMax) : null;
    if (value === null || limit === null || limit <= 0) continue;
    earned += value;
    max += limit;
    count += 1;
  }
  return count > 0 ? { earned, max, count } : null;
}

function trimNumber(value: number) {
  return String(Number(value.toFixed(1)));
}

function dayLabel(iso: string, now: number) {
  const day = isoDate(new Date(iso));
  if (day === isoDate(new Date(now))) return "Today";
  if (day === isoDate(addDays(new Date(now), 1))) return "Tomorrow";
  return WEEKDAY_SHORT.format(new Date(iso));
}

function placeOf(session: ClassSession) {
  return [session.room, session.building].filter(Boolean).join(", ");
}

function sectionKey(courseId: string, section: CourseSection) {
  return `${courseId}:${section.id}`;
}

export function DashboardLayout({ data }: CourseLayoutProps) {
  const { look, moodle, posts, assignments, grades, upcoming, lastSeen } = data;
  const tint = look.tint;
  const now = useNow();
  const [allPosts, setAllPosts] = useState(false);

  const nextClass = upcoming[0] ?? null;
  const nextDeadline = useMemo(
    () =>
      assignments
        .filter(
          (assignment) =>
            !!assignment.due_at &&
            new Date(assignment.due_at).getTime() > now &&
            (assignment.status === "new" || assignment.status === "draft"),
        )
        .sort((a, b) => (a.due_at ?? "").localeCompare(b.due_at ?? ""))[0] ??
      null,
    [assignments, now],
  );
  const points = useMemo(() => pointsOf(grades), [grades]);
  const semester = useMemo(
    () =>
      grades
        .filter((grade) => grade.category === "semester")
        .sort((a, b) =>
          (b.graded_at ?? "").localeCompare(a.graded_at ?? ""),
        )[0] ?? null,
    [grades],
  );
  const otherAssignments = useMemo(
    () =>
      assignments
        .filter(
          (assignment) => assignment.source !== "moodle" || moodle.length === 0,
        )
        .sort((a, b) => {
          const openA = a.status === "new" || a.status === "draft" ? 0 : 1;
          const openB = b.status === "new" || b.status === "draft" ? 0 : 1;
          if (openA !== openB) return openA - openB;
          return openA === 0
            ? (a.due_at ?? "9999").localeCompare(b.due_at ?? "9999")
            : (b.due_at ?? "").localeCompare(a.due_at ?? "");
        }),
    [assignments, moodle.length],
  );

  const visiblePosts = allPosts ? posts : posts.slice(0, 1);

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl
          refreshing={data.refreshing}
          onRefresh={data.refresh}
          colors={[tint]}
          tintColor={tint}
        />
      }
    >
      <View style={[styles.hero, { backgroundColor: tinted(tint, 0.08) }]}>
        <NextClassTile session={nextClass} tint={tint} now={now} />
        <View style={styles.heroRow}>
          <DeadlineTile assignment={nextDeadline} tint={tint} now={now} />
          {semester || points ? (
            <PointsTile semester={semester} points={points} tint={tint} />
          ) : null}
        </View>
      </View>

      <View style={styles.block}>
        <BlockHeader
          title={allPosts ? "Announcements" : "Latest announcement"}
          action={
            posts.length > 1
              ? allPosts
                ? "Show latest"
                : `All posts · ${posts.length}`
              : null
          }
          tint={tint}
          onAction={() => {
            LayoutAnimation.configureNext(
              LayoutAnimation.create(200, "easeInEaseOut", "opacity"),
            );
            setAllPosts(!allPosts);
          }}
        />
        {posts.length === 0 ? (
          <Hint text="No announcements yet. Posts from teachers on Moodle and Teams will show up here." />
        ) : (
          visiblePosts.map((post) => (
            <PostCard
              key={`${post.source}:${post.id}`}
              post={post}
              tint={tint}
              compact
            />
          ))
        )}
      </View>

      {otherAssignments.length > 0 ? (
        <View style={styles.block}>
          <BlockHeader title="Assignments" tint={tint} />
          <View style={styles.card}>
            {otherAssignments.map((assignment, position) => (
              <AssignmentRow
                key={`${assignment.source}:${assignment.id}`}
                assignment={assignment}
                tint={tint}
                now={now}
                divided={position > 0}
              />
            ))}
          </View>
        </View>
      ) : null}

      {moodle.length > 0 ? (
        <Materials
          courses={moodle}
          data={data}
          tint={tint}
          lastSeen={lastSeen}
        />
      ) : otherAssignments.length === 0 && posts.length === 0 ? (
        <Hint text="This subject has no Moodle course. Link one from the edit screen to see materials here." />
      ) : null}
    </ScrollView>
  );
}

function BlockHeader({
  title,
  action,
  tint,
  onAction,
}: {
  title: string;
  action?: string | null;
  tint: string;
  onAction?: () => void;
}) {
  return (
    <View style={styles.blockHeader}>
      <Text style={[type.label, styles.upper]}>{title}</Text>
      {action && onAction ? (
        <Pressable
          onPress={onAction}
          hitSlop={12}
          style={styles.blockAction}
          accessibilityRole="button"
        >
          <Text style={[type.label, { color: tint }]}>{action}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function Hint({ text }: { text: string }) {
  return <Text style={[type.caption, styles.hint]}>{text}</Text>;
}

function TileLabel({
  icon,
  text,
  tint,
}: {
  icon: string;
  text: string;
  tint: string;
}) {
  return (
    <View style={styles.tileLabel}>
      <MaterialCommunityIcons name={icon as never} size={16} color={tint} />
      <Text style={[type.label, styles.upper]}>{text}</Text>
    </View>
  );
}

function NextClassTile({
  session,
  tint,
  now,
}: {
  session: ClassSession | null;
  tint: string;
  now: number;
}) {
  if (!session) {
    return (
      <View style={styles.tile}>
        <TileLabel
          icon="calendar-blank-outline"
          text="Next class"
          tint={tint}
        />
        <Text style={type.title}>No classes in the next 2 weeks</Text>
      </View>
    );
  }
  const live = new Date(session.starts_at).getTime() <= now;
  const when = live
    ? `Now · until ${formatTime(session.ends_at)}`
    : `${dayLabel(session.starts_at, now)} · ${formatTime(session.starts_at)}–${formatTime(session.ends_at)}`;
  const place = placeOf(session);
  return (
    <View style={styles.tile}>
      <TileLabel
        icon={live ? "circle-slice-8" : "calendar-clock-outline"}
        text={live ? "In progress" : "Next class"}
        tint={tint}
      />
      <View style={styles.classLine}>
        <Text style={[type.titleLarge, styles.flex]} numberOfLines={1}>
          {when}
        </Text>
        {session.kind_code ? (
          <View style={[styles.code, { backgroundColor: tinted(tint, 0.14) }]}>
            <Text style={[styles.codeText, { color: tint }]}>
              {session.kind_code}
            </Text>
          </View>
        ) : null}
      </View>
      <Text style={type.caption} numberOfLines={1}>
        {[session.kind, place].filter(Boolean).join(" · ")}
      </Text>
    </View>
  );
}

function DeadlineTile({
  assignment,
  tint,
  now,
}: {
  assignment: Assignment | null;
  tint: string;
  now: number;
}) {
  if (!assignment?.due_at) {
    return (
      <View style={[styles.tile, styles.flex]}>
        <TileLabel
          icon="check-circle-outline"
          text="Next deadline"
          tint={tint}
        />
        <Text style={type.title}>Nothing due</Text>
        <Text style={type.caption}>You are all caught up</Text>
      </View>
    );
  }
  const left = new Date(assignment.due_at).getTime() - now;
  const urgency =
    left < 24 * HOUR
      ? colors.danger
      : left < 72 * HOUR
        ? colors.warning
        : colors.text;
  return (
    <Pressable
      onPress={() =>
        router.push({
          pathname: "/assignment/[id]",
          params: { id: assignment.id, source: assignment.source },
        })
      }
      style={({ pressed }) => [
        styles.tile,
        styles.flex,
        pressed && styles.tilePressed,
      ]}
      accessibilityRole="button"
      accessibilityLabel={`Next deadline: ${assignment.title}`}
    >
      <TileLabel icon="flag-outline" text="Next deadline" tint={tint} />
      <Text style={[type.titleLarge, { color: urgency }]}>
        {relativeDue(assignment.due_at, new Date(now))}
      </Text>
      <Text style={type.body} numberOfLines={2}>
        {assignment.title}
      </Text>
      <Text style={type.caption}>
        {formatShortDate(assignment.due_at)} · {formatTime(assignment.due_at)}
      </Text>
    </Pressable>
  );
}

function PointsTile({
  semester,
  points,
  tint,
}: {
  semester: Grade | null;
  points: Points | null;
  tint: string;
}) {
  if (semester) {
    const caption = [
      semester.passed === false ? "Not passed" : "Final grade",
      semester.term ? termLabel(semester.term) : null,
    ].filter(Boolean);
    return (
      <View style={[styles.tile, styles.flex]}>
        <TileLabel icon="school-outline" text="Grade" tint={tint} />
        <Text
          style={[
            type.display,
            semester.passed === false && { color: colors.danger },
          ]}
        >
          {semester.value}
        </Text>
        <Text style={type.caption}>{caption.join(" · ")}</Text>
        {points ? (
          <Text style={type.caption}>
            {trimNumber(points.earned)} / {trimNumber(points.max)} points
          </Text>
        ) : null}
      </View>
    );
  }
  if (!points) return null;
  const share = Math.min(1, points.earned / points.max);
  return (
    <View style={[styles.tile, styles.flex]}>
      <TileLabel icon="chart-donut" text="Points" tint={tint} />
      <Text style={type.titleLarge}>
        {trimNumber(points.earned)}
        <Text style={styles.pointsMax}> / {trimNumber(points.max)}</Text>
      </Text>
      <View style={[styles.track, { backgroundColor: tinted(tint, 0.16) }]}>
        <View
          style={[
            styles.bar,
            { width: `${share * 100}%`, backgroundColor: tint },
          ]}
        />
      </View>
      <Text style={type.caption}>
        {Math.round(share * 100)}% · {points.count} graded
      </Text>
    </View>
  );
}

function AssignmentRow({
  assignment,
  tint,
  now,
  divided,
}: {
  assignment: Assignment;
  tint: string;
  now: number;
  divided: boolean;
}) {
  const open = assignment.status === "new" || assignment.status === "draft";
  const overdue =
    open && !!assignment.due_at && new Date(assignment.due_at).getTime() < now;
  const status =
    assignment.status === "graded" && assignment.grade
      ? assignment.grade
      : STATUS_LABELS[assignment.status];
  const caption = [
    sourceNames[assignment.source],
    assignment.due_at
      ? `Due ${formatShortDate(assignment.due_at)} ${formatTime(assignment.due_at)}`
      : "No due date",
  ].join(" · ");
  const chipColor = overdue ? colors.danger : open ? tint : colors.success;
  return (
    <Pressable
      onPress={() =>
        router.push({
          pathname: "/assignment/[id]",
          params: { id: assignment.id, source: assignment.source },
        })
      }
      style={({ pressed }) => [
        styles.assignment,
        divided && styles.divided,
        pressed && styles.rowPressed,
      ]}
      accessibilityRole="button"
      accessibilityLabel={assignment.title}
    >
      <View
        style={[
          styles.glyph,
          { backgroundColor: tinted(open ? tint : colors.muted, 0.12) },
        ]}
      >
        <MaterialCommunityIcons
          name={
            assignment.kind === "quiz"
              ? "help-circle-outline"
              : "clipboard-check-outline"
          }
          size={22}
          color={open ? tint : colors.muted}
        />
      </View>
      <View style={styles.flex}>
        <Text style={[type.body, !open && styles.dim]} numberOfLines={2}>
          {assignment.title}
        </Text>
        <Text style={type.caption} numberOfLines={1}>
          {caption}
        </Text>
      </View>
      {status ? (
        <View
          style={[styles.chip, { backgroundColor: tinted(chipColor, 0.12) }]}
        >
          <Text style={[styles.chipText, { color: chipColor }]}>
            {overdue ? "Overdue" : status}
          </Text>
        </View>
      ) : null}
    </Pressable>
  );
}

function Materials({
  courses,
  data,
  tint,
  lastSeen,
}: {
  courses: MoodleCourse[];
  data: CourseLayoutProps["data"];
  tint: string;
  lastSeen: string | null;
}) {
  const [selected, setSelected] = useState(courses[0].courseId);
  const [toggled, setToggled] = useState<Record<string, boolean>>({});
  const { openItem, openAttachment, findAssignment } = useOpeners(
    data.assignments,
  );
  const course =
    courses.find((entry) => entry.courseId === selected) ?? courses[0];

  const sections = useMemo(
    () =>
      course.sections.map((section) => {
        const items = section.items.filter(isVisibleItem);
        const fresh = items.filter((item) => isNewSince(item, lastSeen)).length;
        return { section, items, fresh };
      }),
    [course.sections, lastSeen],
  );
  const firstFilled =
    sections.find((entry) => entry.items.length > 0)?.section.id ?? null;

  const toggle = (key: string, open: boolean) => {
    LayoutAnimation.configureNext(
      LayoutAnimation.create(200, "easeInEaseOut", "opacity"),
    );
    setToggled((current) => ({ ...current, [key]: !open }));
  };

  const caption = (placed: PlacedItem) => {
    const match = findAssignment(placed);
    if (!match) return null;
    const parts = [
      match.due_at
        ? `Due ${formatShortDate(match.due_at)} ${formatTime(match.due_at)}`
        : null,
      match.status === "graded" && match.grade
        ? match.grade
        : STATUS_LABELS[match.status] || null,
    ];
    return parts.filter(Boolean).join(" · ") || null;
  };

  return (
    <View style={styles.block}>
      <BlockHeader title="Materials" tint={tint} />
      {courses.length > 1 ? (
        <View style={styles.pills}>
          {courses.map((entry) => {
            const active = entry.courseId === course.courseId;
            return (
              <Pressable
                key={entry.courseId}
                onPress={() => setSelected(entry.courseId)}
                style={[
                  styles.pill,
                  active ? { backgroundColor: tint } : styles.pillIdle,
                ]}
                accessibilityRole="tab"
                accessibilityState={{ selected: active }}
              >
                <Text
                  style={[
                    styles.pillText,
                    { color: active ? colors.background : colors.text },
                  ]}
                  numberOfLines={1}
                >
                  {entry.detail ?? courseTitle(entry.title)}
                </Text>
              </Pressable>
            );
          })}
        </View>
      ) : null}
      {data.isLoading && course.sections.length === 0 ? (
        <View style={styles.skeletons}>
          {[0, 1, 2].map((key) => (
            <View
              key={key}
              style={[styles.skeleton, { backgroundColor: tinted(tint, 0.06) }]}
            />
          ))}
        </View>
      ) : sections.length === 0 ? (
        <Hint text="Nothing here yet — materials appear when the teacher publishes them." />
      ) : (
        sections.map(({ section, items, fresh }) => {
          const key = sectionKey(course.courseId, section);
          const empty = items.length === 0;
          const defaultOpen = section.id === firstFilled || fresh > 0;
          const open =
            !empty && (toggled[key] === undefined ? defaultOpen : toggled[key]);
          const summary = plainText(section.summary_html);
          return (
            <View
              key={key}
              style={[styles.section, open && styles.sectionOpen]}
            >
              <Pressable
                onPress={() => toggle(key, open)}
                disabled={empty}
                style={({ pressed }) => [
                  styles.sectionHeader,
                  pressed && styles.rowPressed,
                ]}
                accessibilityRole="button"
                accessibilityState={{ expanded: open, disabled: empty }}
                accessibilityLabel={section.title}
              >
                <View
                  style={[
                    styles.sectionMark,
                    { backgroundColor: empty ? colors.border : tint },
                  ]}
                />
                <View style={styles.flex}>
                  <Text
                    style={[type.title, empty && styles.dim]}
                    numberOfLines={2}
                  >
                    {section.title || "Untitled section"}
                  </Text>
                  <Text style={type.caption}>
                    {empty
                      ? "Empty"
                      : `${items.length} ${items.length === 1 ? "item" : "items"}`}
                  </Text>
                </View>
                {fresh > 0 ? (
                  <View
                    style={[
                      styles.chip,
                      { backgroundColor: tinted(tint, 0.14) },
                    ]}
                  >
                    <Text style={[styles.chipText, { color: tint }]}>
                      {fresh} new
                    </Text>
                  </View>
                ) : null}
                {empty ? null : (
                  <MaterialCommunityIcons
                    name={open ? "chevron-up" : "chevron-down"}
                    size={22}
                    color={colors.muted}
                  />
                )}
              </Pressable>
              {open ? (
                <View style={styles.sectionBody}>
                  {summary ? (
                    <Text
                      style={[type.caption, styles.summary]}
                      numberOfLines={4}
                    >
                      {summary}
                    </Text>
                  ) : null}
                  {items.map((item) => {
                    const placed = { item, section, courseId: course.courseId };
                    return (
                      <ItemRow
                        key={item.id}
                        placed={placed}
                        tint={tint}
                        isNew={isNewSince(item, lastSeen)}
                        caption={caption(placed)}
                        onOpen={openItem}
                        onOpenAttachment={(attachment) =>
                          openAttachment(attachment).catch(() => undefined)
                        }
                      />
                    );
                  })}
                </View>
              ) : null}
            </View>
          );
        })
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { paddingTop: spacing.sm, paddingBottom: spacing.xl * 2 },
  flex: { flex: 1 },
  upper: { textTransform: "uppercase" },
  dim: { color: colors.muted },
  hero: {
    marginHorizontal: spacing.md,
    padding: spacing.sm,
    borderRadius: radii.lg + 4,
    gap: spacing.sm,
  },
  heroRow: { flexDirection: "row", gap: spacing.sm },
  tile: {
    backgroundColor: colors.background,
    borderRadius: radii.lg - 4,
    padding: spacing.md,
    gap: spacing.xs,
  },
  tilePressed: { opacity: 0.7 },
  tileLabel: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs + 2,
    marginBottom: 2,
  },
  classLine: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  code: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    borderRadius: radii.sm,
  },
  codeText: { fontSize: 12, fontWeight: "700", letterSpacing: 0.6 },
  pointsMax: { fontSize: 15, fontWeight: "500", color: colors.muted },
  track: {
    height: 4,
    borderRadius: 2,
    overflow: "hidden",
    marginVertical: spacing.xs,
  },
  bar: { height: 4, borderRadius: 2 },
  block: { marginTop: spacing.lg },
  blockHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    minHeight: 40,
    paddingHorizontal: spacing.md + 4,
    marginBottom: spacing.xs,
  },
  blockAction: { minHeight: 40, justifyContent: "center" },
  hint: { paddingHorizontal: spacing.md + 4, paddingVertical: spacing.sm },
  card: {
    marginHorizontal: spacing.md,
    borderRadius: radii.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    overflow: "hidden",
  },
  assignment: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 4,
    minHeight: 64,
  },
  divided: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  rowPressed: { backgroundColor: colors.surface },
  glyph: {
    width: 40,
    height: 40,
    borderRadius: radii.md,
    alignItems: "center",
    justifyContent: "center",
  },
  chip: {
    paddingHorizontal: spacing.sm + 2,
    paddingVertical: 4,
    borderRadius: radii.pill,
  },
  chipText: { fontSize: 12, fontWeight: "600" },
  pills: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    marginBottom: spacing.md,
  },
  pill: {
    minHeight: 40,
    paddingHorizontal: spacing.md,
    borderRadius: radii.pill,
    justifyContent: "center",
    maxWidth: "100%",
  },
  pillIdle: { backgroundColor: colors.surface },
  pillText: { fontSize: 14, fontWeight: "600" },
  skeletons: { gap: spacing.sm, paddingHorizontal: spacing.md },
  skeleton: { height: 64, borderRadius: radii.lg },
  section: {
    marginHorizontal: spacing.md,
    marginBottom: spacing.sm,
    borderRadius: radii.lg,
    backgroundColor: colors.surface,
    overflow: "hidden",
  },
  sectionOpen: {
    backgroundColor: colors.background,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 4,
    minHeight: 64,
  },
  sectionMark: { width: 4, alignSelf: "stretch", borderRadius: 2 },
  sectionBody: { paddingBottom: spacing.sm },
  summary: { paddingHorizontal: spacing.md, paddingBottom: spacing.sm },
});
