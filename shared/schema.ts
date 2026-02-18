import { sql } from "drizzle-orm";
import { pgTable, text, varchar, integer, boolean, timestamp, pgEnum } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const licenseStatusEnum = pgEnum("license_status", ["active", "inactive", "suspended", "expired", "disabled"]);

export const servers = pgTable("servers", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  host: text("host").notNull(),
  port: integer("port").notNull().default(22),
  username: text("username").notNull(),
  password: text("password").notNull(),
  isConnected: boolean("is_connected").notNull().default(false),
  lastChecked: timestamp("last_checked"),
  hardwareId: text("hardware_id"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const licenses = pgTable("licenses", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  licenseId: text("license_id").notNull().unique(),
  serverId: varchar("server_id").references(() => servers.id),
  hardwareId: text("hardware_id"),
  hwidSalt: text("hwid_salt"),
  status: licenseStatusEnum("status").notNull().default("inactive"),
  expiresAt: timestamp("expires_at").notNull(),
  maxUsers: integer("max_users").notNull().default(100),
  maxSites: integer("max_sites").notNull().default(1),
  clientId: text("client_id"),
  notes: text("notes"),
  signature: text("signature"),
  lastVerifiedAt: timestamp("last_verified_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const activityLogs = pgTable("activity_logs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  licenseId: varchar("license_id").references(() => licenses.id),
  serverId: varchar("server_id").references(() => servers.id),
  action: text("action").notNull(),
  details: text("details"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertServerSchema = createInsertSchema(servers).omit({
  id: true,
  isConnected: true,
  lastChecked: true,
  hardwareId: true,
  createdAt: true,
});

export const insertLicenseSchema = createInsertSchema(licenses).omit({
  id: true,
  hardwareId: true,
  status: true,
  createdAt: true,
  updatedAt: true,
});

export const insertLicenseWithHwidSchema = createInsertSchema(licenses).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertActivityLogSchema = createInsertSchema(activityLogs).omit({
  id: true,
  createdAt: true,
});

export type InsertServer = z.infer<typeof insertServerSchema>;
export type Server = typeof servers.$inferSelect;
export type InsertLicense = z.infer<typeof insertLicenseSchema>;
export type License = typeof licenses.$inferSelect;
export type InsertActivityLog = z.infer<typeof insertActivityLogSchema>;
export type ActivityLog = typeof activityLogs.$inferSelect;

export const patchStatusEnum = pgEnum("patch_status", ["pending", "used", "revoked"]);

export const patchTokens = pgTable("patch_tokens", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  token: text("token").notNull().unique(),
  personName: text("person_name").notNull(),
  maxUsers: integer("max_users").notNull().default(100),
  maxSites: integer("max_sites").notNull().default(1),
  durationDays: integer("duration_days").notNull().default(30),
  status: patchStatusEnum("status").notNull().default("pending"),
  licenseId: varchar("license_id"),
  serverId: varchar("server_id"),
  notes: text("notes"),
  targetIp: text("target_ip"),
  activatedHostname: text("activated_hostname"),
  activatedIp: text("activated_ip"),
  hardwareId: text("hardware_id"),
  hwidSalt: text("hwid_salt"),
  rawHwidFingerprint: text("raw_hwid_fingerprint"),
  usedAt: timestamp("used_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertPatchTokenSchema = createInsertSchema(patchTokens).omit({
  id: true,
  token: true,
  status: true,
  licenseId: true,
  activatedHostname: true,
  activatedIp: true,
  hardwareId: true,
  hwidSalt: true,
  usedAt: true,
  createdAt: true,
});

export type InsertPatchToken = z.infer<typeof insertPatchTokenSchema>;
export type PatchToken = typeof patchTokens.$inferSelect;

export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  username: text("username").notNull().unique(),
  password: text("password").notNull(),
});

export const insertUserSchema = createInsertSchema(users).pick({
  username: true,
  password: true,
});

export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;
