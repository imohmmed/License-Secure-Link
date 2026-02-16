import { eq, desc } from "drizzle-orm";
import { db } from "./db";
import {
  servers,
  licenses,
  activityLogs,
  type Server,
  type InsertServer,
  type License,
  type InsertLicense,
  type ActivityLog,
  type InsertActivityLog,
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
  createLicense(data: InsertLicense): Promise<License>;
  updateLicense(id: string, data: Partial<License>): Promise<License | undefined>;
  deleteLicense(id: string): Promise<void>;

  getActivityLogs(): Promise<ActivityLog[]>;
  createActivityLog(data: InsertActivityLog): Promise<ActivityLog>;
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

  async createLicense(data: InsertLicense): Promise<License> {
    const [license] = await db.insert(licenses).values(data).returning();
    return license;
  }

  async updateLicense(id: string, data: Partial<License>): Promise<License | undefined> {
    const [license] = await db.update(licenses).set({ ...data, updatedAt: new Date() }).where(eq(licenses.id, id)).returning();
    return license;
  }

  async deleteLicense(id: string): Promise<void> {
    await db.delete(licenses).where(eq(licenses.id, id));
  }

  async getActivityLogs(): Promise<ActivityLog[]> {
    return db.select().from(activityLogs).orderBy(desc(activityLogs.createdAt)).limit(100);
  }

  async createActivityLog(data: InsertActivityLog): Promise<ActivityLog> {
    const [log] = await db.insert(activityLogs).values(data).returning();
    return log;
  }
}

export const storage = new DatabaseStorage();
