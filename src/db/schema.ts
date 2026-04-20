import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

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
});

export const babies = sqliteTable("babies", {
  id: text("id").primaryKey(),
  householdId: text("household_id")
    .notNull()
    .references(() => households.id),
  name: text("name").notNull(),
  birthDate: integer("birth_date", { mode: "timestamp_ms" }),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
});

export const activities = sqliteTable("activities", {
  id: text("id").primaryKey(),
  babyId: text("baby_id")
    .notNull()
    .references(() => babies.id),
  type: text("type").notNull(), // bottlefeed | breastfeed | pump | diaper
  startedAt: integer("started_at", { mode: "timestamp_ms" }).notNull(),
  endedAt: integer("ended_at", { mode: "timestamp_ms" }),
  details: text("details", { mode: "json" }),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  createdBy: text("created_by"),
});

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
});

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
});

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
