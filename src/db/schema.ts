import { index, uniqueIndex, sqliteTable, text, integer, real } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

export const households = sqliteTable("households", {
  id: text("id").primaryKey(),
  inviteCode: text("invite_code").notNull().unique(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
});

export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  householdId: text("household_id")
    .notNull()
    .references(() => households.id),
  name: text("name").notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
}, (table) => [
  index("idx_users_household_id").on(table.householdId),
]);

export const babies = sqliteTable("babies", {
  id: text("id").primaryKey(),
  householdId: text("household_id")
    .notNull()
    .references(() => households.id),
  name: text("name").notNull(),
  birthDate: integer("birth_date", { mode: "timestamp_ms" }),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
}, (table) => [
  index("idx_babies_household_id").on(table.householdId),
]);

export const activities = sqliteTable("activities", {
  id: text("id").primaryKey(),
  babyId: text("baby_id")
    .notNull()
    .references(() => babies.id),
  type: text("type").notNull(), // timeline types plus bankadjust | bankfreeze | bankthaw | bankdiscard ledger events
  startedAt: integer("started_at", { mode: "timestamp_ms" }).notNull(),
  endedAt: integer("ended_at", { mode: "timestamp_ms" }),
  details: text("details", { mode: "json" }),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  createdBy: text("created_by"),
}, (table) => [
  index("idx_activities_baby_started_at").on(table.babyId, table.startedAt, table.createdAt),
  index("idx_activities_baby_type_started_at").on(table.babyId, table.type, table.startedAt, table.createdAt),
]);

export const activeTimers = sqliteTable("active_timers", {
  id: text("id").primaryKey(),
  babyId: text("baby_id")
    .notNull()
    .references(() => babies.id),
  type: text("type").notNull(),
  startedAt: integer("started_at", { mode: "timestamp_ms" }).notNull(),
  currentSide: text("current_side"),
  sideSwitches: text("side_switches", { mode: "json" }),
  startedBy: text("started_by"),
}, (table) => [
  index("idx_active_timers_baby_id").on(table.babyId),
]);

export const measurements = sqliteTable("measurements", {
  id: text("id").primaryKey(),
  babyId: text("baby_id")
    .notNull()
    .references(() => babies.id),
  measuredAt: integer("measured_at", { mode: "timestamp_ms" }).notNull(),
  weightG: integer("weight_g"),
  lengthMm: integer("length_mm"),
  headMm: integer("head_mm"),
  note: text("note"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
}, (table) => [
  index("idx_measurements_baby_measured_at").on(table.babyId, table.measuredAt, table.createdAt),
]);

export const pushSubscriptions = sqliteTable("push_subscriptions", {
  id: text("id").primaryKey(),
  householdId: text("household_id")
    .notNull()
    .references(() => households.id),
  endpoint: text("endpoint").notNull(),
  p256dh: text("p256dh").notNull(),
  auth: text("auth").notNull(),
  label: text("label"),
});

export const notificationLog = sqliteTable("notification_log", {
  id: text("id").primaryKey(),
  householdId: text("household_id")
    .notNull()
    .references(() => households.id),
  kind: text("kind").notNull(),
  sentAt: integer("sent_at", { mode: "timestamp_ms" }).notNull(),
});

export const paperLogImportBatches = sqliteTable("paper_log_import_batches", {
  id: text("id").primaryKey(),
  householdId: text("household_id")
    .notNull()
    .references(() => households.id),
  babyId: text("baby_id")
    .notNull()
    .references(() => babies.id),
  status: text("status").notNull(), // staged | committed | cancelled
  sourceNote: text("source_note"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  createdBy: text("created_by"),
});

export const paperLogImportRows = sqliteTable("paper_log_import_rows", {
  id: text("id").primaryKey(),
  batchId: text("batch_id")
    .notNull()
    .references(() => paperLogImportBatches.id),
  rowIndex: integer("row_index").notNull(),
  status: text("status").notNull(), // staged | reviewed | duplicate | committed | skipped
  sourceRef: text("source_ref"),
  confidence: integer("confidence"),
  type: text("type").notNull(),
  startedAt: integer("started_at", { mode: "timestamp_ms" }).notNull(),
  endedAt: integer("ended_at", { mode: "timestamp_ms" }),
  details: text("details", { mode: "json" }),
  note: text("note"),
  rawText: text("raw_text"),
  duplicateActivityId: text("duplicate_activity_id").references(() => activities.id),
  importedActivityId: text("imported_activity_id").references(() => activities.id),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
});

export const sickModeEpisodes = sqliteTable("sick_mode_episodes", {
  id: text("id").primaryKey(),
  babyId: text("baby_id").notNull().references(() => babies.id),
  startedAt: integer("started_at", { mode: "timestamp_ms" }).notNull(),
  endedAt: integer("ended_at", { mode: "timestamp_ms" }),
  baselineDailyMl: real("baseline_daily_ml").notNull(),
  baselineKind: text("baseline_kind").notNull(),
  baselineAvailableDayCount: integer("baseline_available_day_count").notNull(),
  baselineSourceDays: text("baseline_source_days", { mode: "json" }).notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  createdBy: text("created_by"),
  endedBy: text("ended_by"),
}, (table) => [
  uniqueIndex("idx_sick_mode_episodes_one_active").on(table.babyId).where(sql`${table.endedAt} IS NULL`),
  index("idx_sick_mode_episodes_baby_started").on(table.babyId, table.startedAt, table.createdAt),
]);

export const sickModeMedications = sqliteTable("sick_mode_medications", {
  id: text("id").primaryKey(),
  episodeId: text("episode_id").notNull().references(() => sickModeEpisodes.id),
  name: text("name").notNull(),
  doseText: text("dose_text").notNull(),
  asNeeded: integer("as_needed", { mode: "boolean" }).notNull(),
  minIntervalMinutes: integer("min_interval_minutes"),
  maxIntervalMinutes: integer("max_interval_minutes"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  createdBy: text("created_by"),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  revision: integer("revision").notNull().default(1),
}, (table) => [
  index("idx_sick_mode_medications_episode").on(table.episodeId, table.createdAt, table.id),
]);

export const sickModeDoses = sqliteTable("sick_mode_doses", {
  id: text("id").primaryKey(),
  medicationId: text("medication_id").notNull().references(() => sickModeMedications.id),
  givenAt: integer("given_at", { mode: "timestamp_ms" }).notNull(),
  doseText: text("dose_text").notNull(),
  givenBy: text("given_by"),
  requestId: text("request_id").notNull().unique(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  revision: integer("revision").notNull().default(1),
  deletedAt: integer("deleted_at", { mode: "timestamp_ms" }),
  deletedBy: text("deleted_by"),
}, (table) => [
  index("idx_sick_mode_doses_medication_given").on(table.medicationId, table.givenAt, table.createdAt, table.id),
]);
