import { storage } from "./storage";
import { db } from "./db";
import { licenses, servers, activityLogs } from "@shared/schema";

export async function seedDatabase() {
  const existingLicenses = await storage.getLicenses();
  if (existingLicenses.length > 0) return;

  const server1 = await storage.createServer({
    name: "سيرفر الإنتاج الرئيسي",
    host: "185.220.101.45",
    port: 22,
    username: "root",
    password: "demo_pass_123",
  });

  const server2 = await storage.createServer({
    name: "سيرفر التطوير",
    host: "192.168.1.100",
    port: 2222,
    username: "admin",
    password: "dev_pass_456",
  });

  const server3 = await storage.createServer({
    name: "سيرفر العميل - بغداد",
    host: "91.107.200.12",
    port: 22,
    username: "root",
    password: "client_pass_789",
  });

  await storage.updateServer(server1.id, {
    hardwareId: "4LFEF-451A7-13FE3-7C17C",
    isConnected: true,
    lastChecked: new Date(),
  });

  await storage.updateServer(server2.id, {
    hardwareId: "B2A3D-892C1-45EF7-9D21A",
    isConnected: true,
    lastChecked: new Date(),
  });

  const now = new Date();

  const lic1 = await storage.createLicense({
    licenseId: "LIC-9005",
    serverId: server1.id,
    maxUsers: 1000000,
    maxSites: 2,
    expiresAt: new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000),
    clientId: "CLIENT-001",
    notes: "ترخيص الإنتاج الرئيسي - عميل VIP",
  });
  await storage.updateLicense(lic1.id, {
    hardwareId: "4LFEF-451A7-13FE3-7C17C",
    status: "active",
  });

  const lic2 = await storage.createLicense({
    licenseId: "LIC-8001",
    serverId: server2.id,
    maxUsers: 5000,
    maxSites: 1,
    expiresAt: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000),
    clientId: "CLIENT-002",
    notes: "ترخيص تجريبي للتطوير",
  });
  await storage.updateLicense(lic2.id, {
    hardwareId: "B2A3D-892C1-45EF7-9D21A",
    status: "active",
  });

  const lic3 = await storage.createLicense({
    licenseId: "LIC-7500",
    serverId: server3.id,
    maxUsers: 50000,
    maxSites: 5,
    expiresAt: new Date(now.getTime() + 5 * 24 * 60 * 60 * 1000),
    clientId: null,
    notes: "ترخيص ينتهي قريباً - يحتاج تجديد",
  });
  await storage.updateLicense(lic3.id, {
    status: "active",
  });

  const lic4 = await storage.createLicense({
    licenseId: "LIC-6200",
    serverId: null,
    maxUsers: 10000,
    maxSites: 3,
    expiresAt: new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000),
    clientId: "CLIENT-003",
    notes: "ترخيص منتهي الصلاحية",
  });
  await storage.updateLicense(lic4.id, {
    status: "expired",
  });

  await storage.createActivityLog({
    licenseId: lic1.id,
    serverId: server1.id,
    action: "create_license",
    details: "تم إنشاء الترخيص LIC-9005",
  });

  await storage.createActivityLog({
    licenseId: lic1.id,
    serverId: server1.id,
    action: "activate_license",
    details: "تم تفعيل الترخيص LIC-9005 وربطه بسيرفر الإنتاج",
  });

  await storage.createActivityLog({
    licenseId: lic1.id,
    serverId: server1.id,
    action: "deploy_license",
    details: "تم نشر الترخيص LIC-9005 على سيرفر الإنتاج بنجاح",
  });

  await storage.createActivityLog({
    serverId: server1.id,
    action: "test_connection",
    details: "اتصال ناجح بسيرفر الإنتاج - HWID: 4LFEF-451A7-13FE3-7C17C",
  });

  await storage.createActivityLog({
    licenseId: lic2.id,
    serverId: server2.id,
    action: "create_license",
    details: "تم إنشاء الترخيص LIC-8001",
  });

  console.log("Database seeded successfully");
}
