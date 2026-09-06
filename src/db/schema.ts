import { index, sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

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
