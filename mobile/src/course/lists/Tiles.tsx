import { MaterialCommunityIcons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useMemo } from "react";
import {
  Pressable,
  RefreshControl,
  SectionList,
  StyleSheet,
  Text,
  View,
} from "react-native";

import type { Assignment, ClassSession } from "@/api/types";
import { EmptyState } from "@/components/EmptyState";
import {
  type CourseEntry,
  type CourseListProps,
  editEntry,
  entryCaption,
  entryKey,
  openEntry,
} from "@/course/list";
import { formatTime } from "@/format";
import { colors, radii, spacing, tinted, type } from "@/theme";
import { useNow } from "@/useNow";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const TILE_HEIGHT = 168;
const WEEKDAY = new Intl.DateTimeFormat("en-GB", { weekday: "short" });

type Urgent =
  | { kind: "class"; at: number; entry: CourseEntry; session: ClassSession }
  | {
      kind: "deadline";
      at: number;
      entry: CourseEntry;
      assignment: Assignment;
    };

function startOfDay(ms: number) {
  const date = new Date(ms);
  return new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
  ).getTime();
}

function classWhen(session: ClassSession, now: number) {
  const start = new Date(session.starts_at).getTime();
  if (start <= now) {
    return "Now";
  }
  if (start - now < 2 * HOUR) {
    return `in ${Math.max(1, Math.round((start - now) / MINUTE))} min`;
  }
  const days = Math.round((startOfDay(start) - startOfDay(now)) / DAY);
  const time = formatTime(session.starts_at);
  if (days === 0) {
    return `Today ${time}`;
  }
  if (days === 1) {
    return `Tomorrow ${time}`;
  }
  return `${WEEKDAY.format(new Date(start))} ${time}`;
}

function classLine(session: ClassSession, now: number) {
  return [classWhen(session, now), session.kind_code || session.kind]
    .filter(Boolean)
    .join(" · ");
}

function dueIn(dueAt: string, now: number) {
  const left = new Date(dueAt).getTime() - now;
  if (left < HOUR) {
    return `Due in ${Math.max(1, Math.round(left / MINUTE))} min`;
  }
  if (left < DAY) {
    return `Due in ${Math.round(left / HOUR)} h`;
  }
  return `Due in ${Math.round(left / DAY)} d`;
}

function isHot(entry: CourseEntry, now: number) {
  const classSoon =
    !!entry.nextClass &&
    new Date(entry.nextClass.starts_at).getTime() - now < 2 * DAY;
  const dueSoon =
    !!entry.nextDeadline?.due_at &&
    new Date(entry.nextDeadline.due_at).getTime() - now < 2 * DAY;
  return classSoon || dueSoon;
}

function findUrgent(entries: CourseEntry[], now: number) {
  const candidates: Urgent[] = [];
  for (const entry of entries) {
    if (entry.nextClass) {
      const at = new Date(entry.nextClass.starts_at).getTime();
      if (at - now < 2 * HOUR) {
        candidates.push({ kind: "class", at, entry, session: entry.nextClass });
      }
    }
    if (entry.nextDeadline?.due_at) {
      const at = new Date(entry.nextDeadline.due_at).getTime();
      if (at - now < DAY) {
        candidates.push({
          kind: "deadline",
          at,
          entry,
          assignment: entry.nextDeadline,
        });
      }
    }
  }
  return candidates.sort((a, b) => a.at - b.at)[0] ?? null;
}

function chunk(entries: CourseEntry[]) {
  const rows: CourseEntry[][] = [];
  for (let index = 0; index < entries.length; index += 2) {
    rows.push(entries.slice(index, index + 2));
  }
  return rows;
}

function openUrgent(urgent: Urgent) {
  if (urgent.kind === "deadline") {
    router.push({
      pathname: "/assignment/[id]",
      params: { id: urgent.assignment.id, source: urgent.assignment.source },
    });
    return;
  }
  openEntry(urgent.entry);
}

export function TilesLayout({
  sections,
  refreshing,
  onRefresh,
}: CourseListProps) {
  const now = useNow();
  const rows = useMemo(
    () =>
      sections.map((section) => ({
        title: section.title,
        data: chunk(section.data),
      })),
    [sections],
  );
  const urgent = useMemo(
    () =>
      findUrgent(
        sections.flatMap((section) => section.data),
        now,
      ),
    [sections, now],
  );

  return (
    <SectionList
      sections={rows}
      keyExtractor={(row) => row.map(entryKey).join("|")}
      stickySectionHeadersEnabled={false}
      style={styles.list}
      contentContainerStyle={rows.length ? styles.content : styles.emptyContent}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
      }
      ListHeaderComponent={urgent ? <UpNext urgent={urgent} now={now} /> : null}
      renderSectionHeader={({ section }) => (
        <Text style={styles.sectionTitle}>{section.title}</Text>
      )}
      renderItem={({ item }) => (
        <View style={styles.row}>
          {item.map((entry) => (
            <Tile key={entryKey(entry)} entry={entry} now={now} />
          ))}
          {item.length === 1 ? <View style={styles.filler} /> : null}
        </View>
      )}
      ListEmptyComponent={
        <EmptyState
          title="No courses"
          hint="Connect Moodle or Teams in sources."
        />
      }
    />
  );
}

function Tile({ entry, now }: { entry: CourseEntry; now: number }) {
  const { look } = entry;
  const hot = isHot(entry, now);
  const ink = hot ? "#FFFFFF" : colors.text;
  const soft = hot ? tinted("#FFFFFF", 0.85) : colors.muted;
  const dueAt = entry.nextDeadline?.due_at ?? null;
  const urgentDue = !!dueAt && new Date(dueAt).getTime() - now < DAY;
  const chipLabel = dueAt
    ? dueIn(dueAt, now)
    : entry.openTasks
      ? `${entry.openTasks} open tasks`
      : null;
  const chipInk = urgentDue ? colors.danger : look.tint;
  const chipFill = hot
    ? "#FFFFFF"
    : urgentDue
      ? tinted(colors.danger, 0.12)
      : tinted(look.tint, 0.16);
  const status = entry.nextClass
    ? classLine(entry.nextClass, now)
    : entryCaption(entry);

  return (
    <Pressable
      onPress={() => openEntry(entry)}
      onLongPress={() => editEntry(entry)}
      accessibilityRole="button"
      accessibilityLabel={[
        look.name,
        status,
        chipLabel,
        entry.updates.length ? "new updates" : null,
      ]
        .filter(Boolean)
        .join(", ")}
      android_ripple={{
        color: tinted(hot ? "#FFFFFF" : look.tint, 0.2),
        borderless: false,
      }}
      style={({ pressed }) => [
        styles.tile,
        { backgroundColor: hot ? look.tint : tinted(look.tint, 0.12) },
        pressed && styles.pressed,
      ]}
    >
      <View style={styles.tileTop}>
        <MaterialCommunityIcons
          name={look.glyph as never}
          size={30}
          color={hot ? "#FFFFFF" : look.tint}
        />
        {entry.updates.length ? (
          <View
            style={[
              styles.dot,
              { backgroundColor: hot ? "#FFFFFF" : look.tint },
            ]}
          />
        ) : null}
      </View>
      <Text style={[styles.name, { color: ink }]} numberOfLines={2}>
        {look.name}
      </Text>
      <View style={styles.statusRow}>
        <MaterialCommunityIcons
          name={entry.nextClass ? "clock-outline" : "school-outline"}
          size={14}
          color={soft}
        />
        <Text style={[styles.status, { color: soft }]} numberOfLines={1}>
          {status}
        </Text>
      </View>
      {chipLabel ? (
        <View style={[styles.chip, { backgroundColor: chipFill }]}>
          <Text style={[styles.chipText, { color: chipInk }]} numberOfLines={1}>
            {chipLabel}
          </Text>
        </View>
      ) : (
        <View style={styles.chipSpace} />
      )}
    </Pressable>
  );
}

function UpNext({ urgent, now }: { urgent: Urgent; now: number }) {
  const { look } = urgent.entry;
  const isClass = urgent.kind === "class";
  const headline = isClass
    ? classWhen(urgent.session, now)
    : dueIn(urgent.assignment.due_at!, now);
  const detail = isClass
    ? [urgent.session.kind, urgent.session.room, urgent.session.building]
        .filter(Boolean)
        .join(" · ")
    : urgent.assignment.title;

  return (
    <Pressable
      onPress={() => openUrgent(urgent)}
      onLongPress={() => editEntry(urgent.entry)}
      accessibilityRole="button"
      accessibilityLabel={["Up next", headline, look.name, detail]
        .filter(Boolean)
        .join(", ")}
      android_ripple={{ color: tinted("#FFFFFF", 0.2) }}
      style={({ pressed }) => [
        styles.upNext,
        { backgroundColor: look.tint },
        pressed && styles.pressed,
      ]}
    >
      <View style={styles.upNextGlyph}>
        <MaterialCommunityIcons
          name={(isClass ? "clock-fast" : "flag-checkered") as never}
          size={28}
          color="#FFFFFF"
        />
      </View>
      <View style={styles.upNextBody}>
        <Text style={styles.upNextLabel}>
          {isClass ? "UP NEXT · CLASS" : "UP NEXT · DEADLINE"}
        </Text>
        <Text style={styles.upNextHeadline} numberOfLines={1}>
          {headline}
        </Text>
        <Text style={styles.upNextName} numberOfLines={1}>
          {look.name}
        </Text>
        {detail ? (
          <Text style={styles.upNextDetail} numberOfLines={1}>
            {detail}
          </Text>
        ) : null}
      </View>
      <MaterialCommunityIcons
        name="chevron-right"
        size={24}
        color={tinted("#FFFFFF", 0.85)}
      />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  list: { flex: 1, backgroundColor: colors.background },
  content: { paddingHorizontal: spacing.md, paddingBottom: spacing.xl },
  emptyContent: { flexGrow: 1 },
  sectionTitle: {
    ...type.label,
    textTransform: "uppercase",
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
    marginHorizontal: spacing.xs,
  },
  row: {
    flexDirection: "row",
    gap: spacing.sm + spacing.xs,
    marginBottom: spacing.sm + spacing.xs,
  },
  filler: { flex: 1 },
  tile: {
    flex: 1,
    height: TILE_HEIGHT,
    borderRadius: radii.lg,
    padding: 14,
    overflow: "hidden",
  },
  pressed: { opacity: 0.88, transform: [{ scale: 0.97 }] },
  tileTop: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: radii.pill,
    marginTop: spacing.xs,
  },
  name: {
    fontSize: 17,
    lineHeight: 22,
    fontWeight: "700",
    marginTop: spacing.sm,
    flex: 1,
  },
  statusRow: { flexDirection: "row", alignItems: "center", gap: spacing.xs },
  status: { ...type.caption, flex: 1, fontWeight: "500" },
  chip: {
    alignSelf: "flex-start",
    marginTop: spacing.xs + 2,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radii.pill,
    maxWidth: "100%",
  },
  chipText: { fontSize: 12, lineHeight: 18, fontWeight: "700" },
  chipSpace: { height: 20 + spacing.xs + 2 },
  upNext: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    marginTop: spacing.md,
    padding: spacing.md,
    borderRadius: radii.lg,
    overflow: "hidden",
  },
  upNextGlyph: {
    width: 52,
    height: 52,
    borderRadius: radii.md,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: tinted("#FFFFFF", 0.18),
  },
  upNextBody: { flex: 1 },
  upNextLabel: { ...type.label, color: tinted("#FFFFFF", 0.8) },
  upNextHeadline: { ...type.headline, color: "#FFFFFF" },
  upNextName: { ...type.title, color: "#FFFFFF" },
  upNextDetail: { ...type.caption, color: tinted("#FFFFFF", 0.85) },
});
