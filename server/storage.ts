import { eq, desc } from "drizzle-orm";
import { db } from "./db";
import {
  servers,
  licenses,
  activityLogs,
  users,
  patchTokens,
  type Server,
  type InsertServer,
  type License,
  type InsertLicense,
  type ActivityLog,
  type InsertActivityLog,
  type User,
  type InsertUser,
  type PatchToken,
  type InsertPatchToken,
} from "@shared/schema";

export interface IStorage {
  getServers(): Promise<Server[]>;
  getServer(id: string): Promise<Server | undefined>;
  createServer(data: InsertServer): Promise<Server>;
  updateServer(id: string, data: Partial<InsertServer & { isConnected?: boolean; lastChecked?: Date; hardwareId?: string | null }>): Promise<Server | undefined>;
  deleteServer(id: string): Promise<void>;

  getLicenses(): Promise<License[]>;
  getLicense(id: string): Promise<License | undefined>;
  getLicenseByLicenseId(licenseId: string): Promise<License | undefined>;
  getLicensesByServerId(serverId: string): Promise<License[]>;
  createLicense(data: InsertLicense): Promise<License>;
  updateLicense(id: string, data: Partial<License>): Promise<License | undefined>;
  deleteLicense(id: string): Promise<void>;

  getActivityLogs(): Promise<ActivityLog[]>;
  createActivityLog(data: InsertActivityLog): Promise<ActivityLog>;

  getPatchTokens(): Promise<PatchToken[]>;
  getPatchToken(id: string): Promise<PatchToken | undefined>;
  getPatchTokenByToken(token: string): Promise<PatchToken | undefined>;
  findPatchByFingerprint(fingerprint: string): Promise<PatchToken | undefined>;
  createPatchToken(data: InsertPatchToken & { token: string }): Promise<PatchToken>;
  updatePatchToken(id: string, data: Partial<PatchToken>): Promise<PatchToken | undefined>;
  deletePatchToken(id: string): Promise<void>;

  getUserByUsername(username: string): Promise<User | undefined>;
  getUser(id: string): Promise<User | undefined>;
  createUser(data: InsertUser): Promise<User>;
  updateUserPassword(id: string, password: string): Promise<void>;
  getUserCount(): Promise<number>;
}

export class DatabaseStorage implements IStorage {
  async getServers(): Promise<Server[]> {
    return db.select().from(servers).orderBy(desc(servers.createdAt));
  }

  async getServer(id: string): Promise<Server | undefined> {
    const [server] = await db.select().from(servers).where(eq(servers.id, id));
    return server;
  }

  async createServer(data: InsertServer): Promise<Server> {
    const [server] = await db.insert(servers).values(data).returning();
    return server;
  }

  async updateServer(id: string, data: Partial<InsertServer & { isConnected?: boolean; lastChecked?: Date; hardwareId?: string | null }>): Promise<Server | undefined> {
    const [server] = await db.update(servers).set(data).where(eq(servers.id, id)).returning();
    return server;
  }

  async deleteServer(id: string): Promise<void> {
    await db.delete(activityLogs).where(eq(activityLogs.serverId, id));
    await db.delete(licenses).where(eq(licenses.serverId, id));
    await db.delete(servers).where(eq(servers.id, id));
  }

  async getLicenses(): Promise<License[]> {
    return db.select().from(licenses).orderBy(desc(licenses.createdAt));
  }

  async getLicense(id: string): Promise<License | undefined> {
    const [license] = await db.select().from(licenses).where(eq(licenses.id, id));
    return license;
  }

  async getLicenseByLicenseId(licenseId: string): Promise<License | undefined> {
    const [license] = await db.select().from(licenses).where(eq(licenses.licenseId, licenseId));
    return license;
  }

  async getLicensesByServerId(serverId: string): Promise<License[]> {
    return db.select().from(licenses).where(eq(licenses.serverId, serverId));
  }

  async createLicense(data: InsertLicense): Promise<License> {
    const [license] = await db.insert(licenses).values(data).returning();
    return license;
  }

  async updateLicense(id: string, data: Partial<License>): Promise<License | undefined> {
    const [license] = await db.update(licenses).set({ ...data, updatedAt: new Date() }).where(eq(licenses.id, id)).returning();
    return license;
  }

  async deleteLicense(id: string): Promise<void> {
    await db.delete(activityLogs).where(eq(activityLogs.licenseId, id));
    await db.delete(licenses).where(eq(licenses.id, id));
  }

  async getActivityLogs(): Promise<ActivityLog[]> {
    return db.select().from(activityLogs).orderBy(desc(activityLogs.createdAt)).limit(100);
  }

  async createActivityLog(data: InsertActivityLog): Promise<ActivityLog> {
    const [log] = await db.insert(activityLogs).values(data).returning();
    return log;
  }

  async getPatchTokens(): Promise<PatchToken[]> {
    return db.select().from(patchTokens).orderBy(desc(patchTokens.createdAt));
  }

  async getPatchToken(id: string): Promise<PatchToken | undefined> {
    const [token] = await db.select().from(patchTokens).where(eq(patchTokens.id, id));
    return token;
  }

  async getPatchTokenByToken(token: string): Promise<PatchToken | undefined> {
    const [pt] = await db.select().from(patchTokens).where(eq(patchTokens.token, token));
    return pt;
  }

  async findPatchByFingerprint(fingerprint: string): Promise<PatchToken | undefined> {
    const [pt] = await db.select().from(patchTokens).where(eq(patchTokens.rawHwidFingerprint, fingerprint));
    return pt;
  }

  async createPatchToken(data: InsertPatchToken & { token: string }): Promise<PatchToken> {
    const [pt] = await db.insert(patchTokens).values(data).returning();
    return pt;
  }

  async updatePatchToken(id: string, data: Partial<PatchToken>): Promise<PatchToken | undefined> {
    const [pt] = await db.update(patchTokens).set(data).where(eq(patchTokens.id, id)).returning();
    return pt;
  }

  async deletePatchToken(id: string): Promise<void> {
    await db.delete(patchTokens).where(eq(patchTokens.id, id));
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.username, username));
    return user;
  }

  async getUser(id: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user;
  }

  async createUser(data: InsertUser): Promise<User> {
    const [user] = await db.insert(users).values(data).returning();
    return user;
  }

  async updateUserPassword(id: string, password: string): Promise<void> {
    await db.update(users).set({ password }).where(eq(users.id, id));
  }

  async getUserCount(): Promise<number> {
    const result = await db.select().from(users);
    return result.length;
  }
}

export const storage = new DatabaseStorage();
