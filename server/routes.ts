import type { Express, Request, Response, NextFunction } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { testSSHConnection, deployLicenseToServer, undeployLicenseFromServer, generateObfuscatedEmulator, generateObfuscatedVerify, DEPLOY } from "./ssh-service";
import { insertServerSchema, insertLicenseSchema } from "@shared/schema";
import { buildSAS4Payload, encryptSAS4Payload } from "./sas4-service";
import bcrypt from "bcryptjs";
import dns from "dns";
import { promisify } from "util";

const dnsResolve = promisify(dns.resolve4);

const API_DOMAIN = "lic.tecn0link.net";

const ipRegex = /^(\d{1,3}\.){3}\d{1,3}$/;
const resolvedIpCache = new Map<string, { ip: string; ts: number }>();

async function resolveHostToIp(host: string): Promise<string> {
  const cleanHost = host.split(':')[0].trim();
  if (ipRegex.test(cleanHost)) return cleanHost;
  const cached = resolvedIpCache.get(cleanHost);
  if (cached && Date.now() - cached.ts < 5 * 60 * 1000) return cached.ip;
  try {
    const addresses = await dnsResolve(cleanHost);
    if (addresses && addresses.length > 0) {
      resolvedIpCache.set(cleanHost, { ip: addresses[0], ts: Date.now() });
      return addresses[0];
    }
  } catch {}
  return '';
}

function requireHttps(req: Request, res: Response, next: NextFunction) {
  const proto = req.get("x-forwarded-proto") || req.protocol;
  if (proto !== "https" && process.env.NODE_ENV === "production") {
    return res.status(403).json({ error: "HTTPS required" });
  }
  next();
}

function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!req.session?.userId) {
    return res.status(401).json({ message: "غير مصرح" });
  }
  next();
}

async function ensureDefaultAdmin() {
  const count = await storage.getUserCount();
  if (count === 0) {
    const hashed = await bcrypt.hash("admin", 10);
    await storage.createUser({ username: "admin", password: hashed });
    console.log("Default admin created: admin / admin");
  }
}

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {

  await ensureDefaultAdmin();

  function getBaseUrl(_req: Request): string {
    return `https://${API_DOMAIN}`;
  }

  function sanitizeServer(server: any) {
    const { password, ...safe } = server;
    return { ...safe, password: "********" };
  }

  // ─── HTTPS enforcement for public API ──────────────────────
  app.use("/api/provision", requireHttps);
  app.use("/api/verify", requireHttps);
  app.use("/api/license-blob", requireHttps);
  app.use("/api/provision-script", requireHttps);

  // ─── Auth Routes (public) ─────────────────────────────────
  app.post("/api/auth/login", async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ message: "اسم المستخدم وكلمة المرور مطلوبان" });
    }

    const user = await storage.getUserByUsername(username);
    if (!user) {
      return res.status(401).json({ message: "اسم المستخدم أو كلمة المرور غير صحيحة" });
    }

    const valid = await bcrypt.compare(password, user.password);
    if (!valid) {
      return res.status(401).json({ message: "اسم المستخدم أو كلمة المرور غير صحيحة" });
    }

    req.session.userId = user.id;
    req.session.username = user.username;
    res.json({ id: user.id, username: user.username });
  });

  app.post("/api/auth/logout", (req, res) => {
    req.session.destroy(() => {
      res.json({ success: true });
    });
  });

  app.get("/api/auth/me", (req, res) => {
    if (!req.session?.userId) {
      return res.status(401).json({ message: "غير مصرح" });
    }
    res.json({ id: req.session.userId, username: req.session.username });
  });

  app.post("/api/auth/change-password", requireAuth, async (req, res) => {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ message: "كلمة المرور الحالية والجديدة مطلوبتان" });
    }
    if (newPassword.length < 4) {
      return res.status(400).json({ message: "كلمة المرور الجديدة قصيرة جداً" });
    }

    const user = await storage.getUser(req.session.userId!);
    if (!user) return res.status(404).json({ message: "المستخدم غير موجود" });

    const valid = await bcrypt.compare(currentPassword, user.password);
    if (!valid) {
      return res.status(401).json({ message: "كلمة المرور الحالية غير صحيحة" });
    }

    const hashed = await bcrypt.hash(newPassword, 10);
    await storage.updateUserPassword(user.id, hashed);
    res.json({ success: true });
  });

  app.post("/api/auth/change-username", requireAuth, async (req, res) => {
    const { newUsername, password } = req.body;
    if (!newUsername || !password) {
      return res.status(400).json({ message: "اسم المستخدم الجديد وكلمة المرور مطلوبان" });
    }

    const user = await storage.getUser(req.session.userId!);
    if (!user) return res.status(404).json({ message: "المستخدم غير موجود" });

    const valid = await bcrypt.compare(password, user.password);
    if (!valid) {
      return res.status(401).json({ message: "كلمة المرور غير صحيحة" });
    }

    const existing = await storage.getUserByUsername(newUsername);
    if (existing && existing.id !== user.id) {
      return res.status(409).json({ message: "اسم المستخدم مستخدم بالفعل" });
    }

    const { db } = await import("./db");
    const { users } = await import("@shared/schema");
    const { eq } = await import("drizzle-orm");
    await db.update(users).set({ username: newUsername }).where(eq(users.id, user.id));
    req.session.username = newUsername;
    res.json({ success: true });
  });

  // ─── Protected Admin Routes ───────────────────────────────
  app.use("/api/servers", requireAuth);
  app.use("/api/licenses", requireAuth);
  app.use("/api/activity-logs", requireAuth);
  app.use("/api/stats", requireAuth);
  app.use("/api/backup", requireAuth);

  // ─── Servers ────────────────────────────────────────────────
  app.get("/api/servers", async (_req, res) => {
    const serversList = await storage.getServers();
    res.json(serversList.map(sanitizeServer));
  });

  app.post("/api/servers", async (req, res) => {
    const parsed = insertServerSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: parsed.error.message });
    }
    const server = await storage.createServer(parsed.data);
    await storage.createActivityLog({
      serverId: server.id,
      action: "create_server",
      details: `تم إضافة السيرفر ${server.name} (${server.host})`,
    });
    res.json(sanitizeServer(server));
  });

  app.patch("/api/servers/:id", async (req, res) => {
    const server = await storage.getServer(req.params.id);
    if (!server) return res.status(404).json({ message: "السيرفر غير موجود" });

    const updateData = { ...req.body };
    if (!updateData.password || updateData.password === "********") {
      delete updateData.password;
    }

    const updated = await storage.updateServer(req.params.id, updateData);
    await storage.createActivityLog({
      serverId: req.params.id,
      action: "update_server",
      details: `تم تعديل السيرفر ${server.name}`,
    });
    res.json(sanitizeServer(updated));
  });

  app.delete("/api/servers/:id", async (req, res) => {
    const server = await storage.getServer(req.params.id);
    if (!server) return res.status(404).json({ message: "السيرفر غير موجود" });

    try {
      await undeployLicenseFromServer(server.host, server.port, server.username, server.password);
    } catch (e) {
      console.error("Failed to undeploy from server before deletion:", e);
    }

    const serverLicenses = await storage.getLicensesByServerId(req.params.id);
    for (const lic of serverLicenses) {
      await storage.updateLicense(lic.id, { status: "suspended", serverId: null });
      await storage.createActivityLog({
        licenseId: lic.id,
        serverId: null,
        action: "suspend_license",
        details: `تم إيقاف الترخيص ${lic.licenseId} تلقائياً بسبب حذف السيرفر ${server.name}`,
      });
    }

    await storage.deleteServer(req.params.id);
    await storage.createActivityLog({
      serverId: null,
      action: "delete_server",
      details: `تم حذف السيرفر ${server.name} (${server.host}) وإيقاف التراخيص المرتبطة`,
    });
    res.json({ success: true });
  });

  app.post("/api/servers/:id/test", async (req, res) => {
    const server = await storage.getServer(req.params.id);
    if (!server) return res.status(404).json({ message: "السيرفر غير موجود" });

    const result = await testSSHConnection(server.host, server.port, server.username, server.password);

    await storage.updateServer(req.params.id, {
      isConnected: result.connected,
      lastChecked: new Date(),
      hardwareId: result.hardwareId || server.hardwareId,
    });

    await storage.createActivityLog({
      serverId: req.params.id,
      action: "test_connection",
      details: result.connected
        ? `اتصال ناجح بالسيرفر ${server.name} - HWID: ${result.hardwareId || "N/A"}`
        : `فشل الاتصال بالسيرفر ${server.name}: ${result.error}`,
    });

    res.json(result);
  });

  // ─── Licenses ───────────────────────────────────────────────
  app.get("/api/licenses", async (_req, res) => {
    const licenseList = await storage.getLicenses();
    res.json(licenseList);
  });

  app.get("/api/licenses/:id", async (req, res) => {
    const license = await storage.getLicense(req.params.id);
    if (!license) return res.status(404).json({ message: "الترخيص غير موجود" });
    res.json(license);
  });

  app.post("/api/licenses", async (req, res) => {
    const body = { ...req.body };
    if (typeof body.expiresAt === "string") {
      body.expiresAt = new Date(body.expiresAt);
    }
    const parsed = insertLicenseSchema.safeParse(body);
    if (!parsed.success) {
      return res.status(400).json({ message: parsed.error.message });
    }

    const existing = await storage.getLicenseByLicenseId(parsed.data.licenseId);
    if (existing) {
      return res.status(409).json({ message: "معرف الترخيص موجود مسبقاً" });
    }

    if (parsed.data.serverId) {
      const server = await storage.getServer(parsed.data.serverId);
      if (!server) {
        return res.status(400).json({ message: "السيرفر المحدد غير موجود" });
      }
      const serverLicenses = await storage.getLicensesByServerId(parsed.data.serverId);
      if (serverLicenses.length > 0) {
        return res.status(409).json({ message: "لديك ترخيص مسبق على هذا السيرفر - لا يمكن إنشاء ترخيص آخر لنفس السيرفر" });
      }
    }

    let hardwareId: string | null = null;
    if (parsed.data.serverId) {
      const server = await storage.getServer(parsed.data.serverId);
      if (server?.hardwareId) {
        hardwareId = server.hardwareId;
      }
    }

    const license = await storage.createLicense(parsed.data);

    const updateData: any = { status: "active" };
    if (hardwareId) updateData.hardwareId = hardwareId;
    await storage.updateLicense(license.id, updateData);

    await storage.createActivityLog({
      licenseId: license.id,
      serverId: parsed.data.serverId || null,
      action: "create_license",
      details: `تم إنشاء الترخيص ${parsed.data.licenseId}`,
    });

    let deployResult = null;
    if (parsed.data.serverId) {
      const server = await storage.getServer(parsed.data.serverId);
      if (server && hardwareId) {
        try {
          const result = await deployLicenseToServer(
            server.host, server.port, server.username, server.password,
            hardwareId, parsed.data.licenseId,
            new Date(parsed.data.expiresAt), parsed.data.maxUsers ?? 1000, parsed.data.maxSites ?? 1,
            "active", getBaseUrl(req)
          );
          deployResult = result;
          if (result.success) {
            await storage.createActivityLog({
              licenseId: license.id,
              serverId: parsed.data.serverId,
              action: "deploy_license",
              details: `تم نشر الترخيص ${parsed.data.licenseId} تلقائياً على السيرفر ${server.name}`,
            });
          }
        } catch (e) {
          deployResult = { success: false, error: "فشل النشر التلقائي" };
        }
      }
    }

    const updatedLicense = await storage.getLicense(license.id);
    res.json({ ...updatedLicense, deployResult });
  });

  app.patch("/api/licenses/:id/status", async (req, res) => {
    const { status } = req.body;
    if (!["active", "inactive", "suspended", "expired"].includes(status)) {
      return res.status(400).json({ message: "حالة غير صالحة" });
    }

    const license = await storage.getLicense(req.params.id);
    if (!license) return res.status(404).json({ message: "الترخيص غير موجود" });

    const updated = await storage.updateLicense(req.params.id, { status });

    const actionMap: Record<string, string> = {
      active: "activate_license",
      suspended: "suspend_license",
      inactive: "deactivate_license",
      expired: "expire_license",
    };

    await storage.createActivityLog({
      licenseId: req.params.id,
      serverId: license.serverId,
      action: actionMap[status] || "update_license",
      details: `تم تغيير حالة الترخيص ${license.licenseId} إلى ${status}`,
    });

    if (license.serverId && license.hardwareId) {
      const server = await storage.getServer(license.serverId);
      if (server) {
        try {
          await deployLicenseToServer(
            server.host, server.port, server.username, server.password,
            license.hardwareId, license.licenseId,
            new Date(license.expiresAt), license.maxUsers, license.maxSites,
            status, getBaseUrl(req)
          );
        } catch (e) {
        }
      }
    }

    res.json(updated);
  });

  app.post("/api/licenses/:id/extend", async (req, res) => {
    const { days } = req.body;
    if (!days || days < 1) {
      return res.status(400).json({ message: "عدد الأيام غير صالح" });
    }

    const license = await storage.getLicense(req.params.id);
    if (!license) return res.status(404).json({ message: "الترخيص غير موجود" });

    const currentExpiry = new Date(license.expiresAt);
    const newExpiry = new Date(currentExpiry.getTime() + days * 24 * 60 * 60 * 1000);

    const updated = await storage.updateLicense(req.params.id, {
      expiresAt: newExpiry,
    });

    await storage.createActivityLog({
      licenseId: req.params.id,
      serverId: license.serverId,
      action: "extend_license",
      details: `تم تمديد الترخيص ${license.licenseId} بمقدار ${days} يوم حتى ${newExpiry.toLocaleDateString("ar-IQ")}`,
    });

    res.json(updated);
  });

  app.post("/api/licenses/:id/transfer", async (req, res) => {
    const { serverId } = req.body;
    if (!serverId) return res.status(400).json({ message: "السيرفر مطلوب" });

    const license = await storage.getLicense(req.params.id);
    if (!license) return res.status(404).json({ message: "الترخيص غير موجود" });

    const newServer = await storage.getServer(serverId);
    if (!newServer) return res.status(404).json({ message: "السيرفر الجديد غير موجود" });

    const existingOnServer = await storage.getLicensesByServerId(serverId);
    const otherLicenses = existingOnServer.filter(l => l.id !== req.params.id);
    if (otherLicenses.length > 0) {
      return res.status(409).json({ message: "لديك ترخيص مسبق على هذا السيرفر - لا يمكن نقل ترخيص آخر لنفس السيرفر" });
    }

    const oldServerId = license.serverId;
    const newHardwareId = newServer.hardwareId;

    const updated = await storage.updateLicense(req.params.id, {
      serverId,
      hardwareId: newHardwareId,
    });

    await storage.createActivityLog({
      licenseId: req.params.id,
      serverId,
      action: "transfer_license",
      details: `تم نقل الترخيص ${license.licenseId} إلى السيرفر ${newServer.name} (${newServer.host})`,
    });

    if (newHardwareId && license.status === "active") {
      try {
        await deployLicenseToServer(
          newServer.host, newServer.port, newServer.username, newServer.password,
          newHardwareId, license.licenseId,
          new Date(license.expiresAt), license.maxUsers, license.maxSites,
          license.status, getBaseUrl(req)
        );
      } catch (e) {
      }
    }

    res.json(updated);
  });

  app.post("/api/licenses/:id/deploy", async (req, res) => {
    const license = await storage.getLicense(req.params.id);
    if (!license) return res.status(404).json({ message: "الترخيص غير موجود" });
    if (!license.serverId) return res.status(400).json({ message: "الترخيص غير مرتبط بسيرفر" });

    const server = await storage.getServer(license.serverId);
    if (!server) return res.status(404).json({ message: "السيرفر غير موجود" });

    const hwid = license.hardwareId || server.hardwareId;
    if (!hwid) return res.status(400).json({ message: "لا يوجد Hardware ID - اختبر الاتصال بالسيرفر أولاً" });

    const deployStatus = license.status === "inactive" ? "active" : license.status;
    const result = await deployLicenseToServer(
      server.host, server.port, server.username, server.password,
      hwid, license.licenseId,
      new Date(license.expiresAt), license.maxUsers, license.maxSites,
      deployStatus, getBaseUrl(req)
    );

    if (result.success) {
      const updates: any = {};
      if (!license.hardwareId) updates.hardwareId = hwid;
      if (license.status === "inactive") updates.status = "active";
      if (Object.keys(updates).length > 0) {
        await storage.updateLicense(req.params.id, updates);
      }

      await storage.createActivityLog({
        licenseId: req.params.id,
        serverId: license.serverId,
        action: "deploy_license",
        details: `تم نشر الترخيص ${license.licenseId} على السيرفر ${server.name}`,
      });

      res.json({ success: true, message: "تم النشر والتفعيل بنجاح", output: result.output, error: result.error });
    } else {
      res.status(500).json({ message: result.error || "فشل النشر" });
    }
  });

  app.delete("/api/licenses/:id", async (req, res) => {
    const license = await storage.getLicense(req.params.id);
    if (!license) return res.status(404).json({ message: "الترخيص غير موجود" });

    await storage.updateLicense(req.params.id, { status: "suspended" });
    await storage.createActivityLog({
      licenseId: license.id,
      serverId: license.serverId,
      action: "suspend_license",
      details: `تم تعطيل الترخيص ${license.licenseId} - الملفات باقية على السيرفر`,
    });
    res.json({ success: true });
  });

  // ─── Activity Logs ──────────────────────────────────────────
  app.get("/api/activity-logs", async (_req, res) => {
    const logs = await storage.getActivityLogs();
    res.json(logs);
  });

  // ─── License Edit (maxUsers, maxSites) ────────────────────
  app.patch("/api/licenses/:id", async (req, res) => {
    const license = await storage.getLicense(req.params.id);
    if (!license) return res.status(404).json({ message: "الترخيص غير موجود" });

    const allowedFields = ["maxUsers", "maxSites", "notes", "clientId", "expiresAt"];
    const updateData: any = {};
    for (const field of allowedFields) {
      if (req.body[field] !== undefined) {
        if (field === "expiresAt" && typeof req.body[field] === "string") {
          updateData[field] = new Date(req.body[field]);
        } else {
          updateData[field] = req.body[field];
        }
      }
    }

    if (Object.keys(updateData).length === 0) {
      return res.status(400).json({ message: "لا توجد بيانات للتحديث" });
    }

    const updated = await storage.updateLicense(req.params.id, updateData);

    await storage.createActivityLog({
      licenseId: req.params.id,
      serverId: license.serverId,
      action: "edit_license",
      details: `تم تعديل بيانات الترخيص ${license.licenseId}: ${Object.keys(updateData).join(", ")}`,
    });

    res.json(updated);
  });

  // ─── Backup / Restore ─────────────────────────────────────
  app.get("/api/backup/export", async (_req, res) => {
    const [serversList, licenseList, logs] = await Promise.all([
      storage.getServers(),
      storage.getLicenses(),
      storage.getActivityLogs(),
    ]);

    const backup = {
      version: "1.0",
      exportedAt: new Date().toISOString(),
      servers: serversList,
      licenses: licenseList,
      activityLogs: logs,
    };

    res.setHeader("Content-Type", "application/json");
    res.setHeader("Content-Disposition", `attachment; filename="license-backup-${new Date().toISOString().slice(0, 10)}.json"`);
    res.json(backup);
  });

  app.post("/api/backup/import", async (req, res) => {
    const { servers: srvData, licenses: licData } = req.body;
    if (!srvData && !licData) {
      return res.status(400).json({ message: "لا توجد بيانات للاستيراد" });
    }

    let importedServers = 0;
    let importedLicenses = 0;

    if (srvData && Array.isArray(srvData)) {
      for (const srv of srvData) {
        try {
          const existing = await storage.getServer(srv.id);
          if (!existing) {
            await storage.createServer({
              name: srv.name,
              host: srv.host,
              port: srv.port,
              username: srv.username,
              password: srv.password,
            });
            importedServers++;
          }
        } catch (e) {}
      }
    }

    if (licData && Array.isArray(licData)) {
      for (const lic of licData) {
        try {
          const existing = await storage.getLicenseByLicenseId(lic.licenseId);
          if (!existing) {
            await storage.createLicense({
              licenseId: lic.licenseId,
              serverId: lic.serverId,
              expiresAt: new Date(lic.expiresAt),
              maxUsers: lic.maxUsers,
              maxSites: lic.maxSites,
              clientId: lic.clientId,
              notes: lic.notes,
              signature: lic.signature,
            });
            importedLicenses++;
          }
        } catch (e) {}
      }
    }

    await storage.createActivityLog({
      action: "import_backup",
      details: `تم استيراد نسخة احتياطية: ${importedServers} سيرفر، ${importedLicenses} ترخيص`,
    });

    res.json({ success: true, importedServers, importedLicenses });
  });

  // ─── Provisioning API (Client → Server) - PUBLIC ──────────
  app.post("/api/provision", async (req, res) => {
    const { license_id, hardware_id } = req.body;

    if (!license_id || !hardware_id) {
      return res.status(400).json({ error: "license_id and hardware_id are required" });
    }

    const license = await storage.getLicenseByLicenseId(license_id);
    if (!license) {
      return res.status(404).json({ error: "License not found" });
    }

    if (license.status === "suspended") {
      return res.status(403).json({ error: "License is suspended", status: "suspended" });
    }

    if (license.status === "expired" || new Date(license.expiresAt) < new Date()) {
      if (license.status !== "expired") {
        await storage.updateLicense(license.id, { status: "expired" });
      }
      return res.status(403).json({ error: "License has expired", status: "expired" });
    }

    if (license.hardwareId && license.hardwareId !== hardware_id) {
      await storage.createActivityLog({
        licenseId: license.id,
        serverId: license.serverId,
        action: "provision_hwid_mismatch",
        details: `محاولة تفعيل الترخيص ${license_id} من جهاز مختلف. HWID المسجل: ${license.hardwareId.substring(0, 16)}... HWID المرسل: ${hardware_id.substring(0, 16)}...`,
      });
      return res.status(403).json({ error: "Hardware ID mismatch - license bound to another device" });
    }

    if (!license.hardwareId) {
      await storage.updateLicense(license.id, { hardwareId: hardware_id });
    }

    await storage.updateLicense(license.id, {
      lastVerifiedAt: new Date(),
      status: "active",
    });

    const payload = buildSAS4Payload(
      license.licenseId,
      hardware_id,
      new Date(license.expiresAt),
      license.maxUsers,
      license.maxSites,
      "active"
    );

    const encrypted = encryptSAS4Payload(payload);

    await storage.updateLicense(license.id, { signature: encrypted });

    await storage.createActivityLog({
      licenseId: license.id,
      serverId: license.serverId,
      action: "provision_license",
      details: `تم تفعيل الترخيص ${license_id} على الجهاز ${hardware_id.substring(0, 16)}...`,
    });

    const baseUrl = getBaseUrl(req);
    const emulatorScript = generateObfuscatedEmulator(
      hardware_id, license.licenseId,
      new Date(license.expiresAt), license.maxUsers, license.maxSites, "active", baseUrl
    );
    const verifyScript = generateObfuscatedVerify(license.licenseId, baseUrl);

    res.json({
      license: payload,
      encrypted_blob: encrypted,
      scripts: {
        emulator: emulatorScript,
        verify: verifyScript,
      },
    });
  });

  // ─── Verification API (Periodic Check) - PUBLIC ───────────
  app.post("/api/verify", async (req, res) => {
    const { license_id, hardware_id } = req.body;

    if (!license_id || !hardware_id) {
      return res.status(400).json({ valid: false, error: "license_id and hardware_id are required" });
    }

    const license = await storage.getLicenseByLicenseId(license_id);
    if (!license) {
      return res.status(404).json({ valid: false, error: "License not found" });
    }

    if (!license.hardwareId) {
      return res.status(400).json({ valid: false, error: "License not provisioned - run provision.sh first" });
    }

    if (license.hardwareId !== hardware_id) {
      await storage.createActivityLog({
        licenseId: license.id,
        serverId: license.serverId,
        action: "verify_hwid_mismatch",
        details: `فشل التحقق - عدم تطابق HWID للترخيص ${license_id}`,
      });
      return res.status(403).json({ valid: false, error: "Hardware ID mismatch" });
    }

    if (new Date(license.expiresAt) < new Date()) {
      if (license.status !== "expired") {
        await storage.updateLicense(license.id, { status: "expired" });
      }
      await storage.createActivityLog({
        licenseId: license.id,
        serverId: license.serverId,
        action: "verify_expired",
        details: `الترخيص ${license_id} منتهي الصلاحية`,
      });
      return res.json({ valid: false, status: "expired", error: "License has expired" });
    }

    if (license.status === "suspended") {
      await storage.createActivityLog({
        licenseId: license.id,
        serverId: license.serverId,
        action: "verify_suspended",
        details: `الترخيص ${license_id} موقوف`,
      });
      return res.json({ valid: false, status: "suspended", error: "License is suspended" });
    }

    if (license.status !== "active") {
      return res.json({ valid: false, status: license.status, error: "License is not active" });
    }

    await storage.updateLicense(license.id, { lastVerifiedAt: new Date() });

    await storage.createActivityLog({
      licenseId: license.id,
      serverId: license.serverId,
      action: "verify_success",
      details: `تحقق ناجح للترخيص ${license_id}`,
    });

    const payload = buildSAS4Payload(
      license.licenseId,
      hardware_id,
      new Date(license.expiresAt),
      license.maxUsers,
      license.maxSites,
      license.status
    );

    const encrypted = encryptSAS4Payload(payload);

    res.json({
      valid: true,
      status: "active",
      license: payload,
      encrypted_blob: encrypted,
    });
  });

  // ─── SAS4 Encrypted Blob Endpoint - PUBLIC ──────────────
  app.get("/api/license-blob/:licenseId", async (req, res) => {
    const license = await storage.getLicenseByLicenseId(req.params.licenseId);
    if (!license) return res.status(404).json({ error: "License not found" });
    if (!license.hardwareId) return res.status(400).json({ error: "License not provisioned" });
    if (license.status !== "active") return res.status(403).json({ error: "License not active" });

    const payload = buildSAS4Payload(
      license.licenseId,
      license.hardwareId,
      new Date(license.expiresAt),
      license.maxUsers,
      license.maxSites,
      license.status
    );
    const encrypted = encryptSAS4Payload(payload);
    res.type("text/plain").send(encrypted);
  });

  // ─── License Data for Emulator (raw JSON, no XOR) - PUBLIC ──
  app.use("/api/license-data", requireHttps);
  app.get("/api/license-data/:licenseId", async (req, res) => {
    const license = await storage.getLicenseByLicenseId(req.params.licenseId);
    if (!license) return res.status(404).json({ s: "0" });
    if (!license.hardwareId) return res.status(400).json({ s: "0" });

    if (license.status !== "active") {
      return res.status(403).json({ s: "0" });
    }

    if (new Date(license.expiresAt) < new Date()) {
      if (license.status !== "expired") {
        await storage.updateLicense(license.id, { status: "expired" });
      }
      return res.status(403).json({ s: "0" });
    }

    const payload = buildSAS4Payload(
      license.licenseId, license.hardwareId,
      new Date(license.expiresAt), license.maxUsers, license.maxSites, license.status
    );
    res.json(payload);
  });

  // ─── Install Script Download - ADMIN ───────────────────
  app.get("/api/install-script/:licenseId", requireAuth, async (req: any, res) => {
    const license = await storage.getLicenseByLicenseId(req.params.licenseId);
    if (!license) return res.status(404).json({ message: "الترخيص غير موجود" });

    let serverHost = "";
    if (license.serverId) {
      const server = await storage.getServer(license.serverId);
      if (server) serverHost = await resolveHostToIp(server.host);
    }

    const baseUrl = getBaseUrl(req);
    const P = DEPLOY;

    const hwidCapturePy = [
      "import base64 as b,json as j,sys",
      "d=b.b64decode(sys.argv[1])",
      "for h in range(25):",
      " k=''.join(chr(c) for c in [71,114,51,110,100,49,122,51,114])+str(h)",
      " try:",
      "  r=bytes(d[i]^k.encode()[i%len(k.encode())] for i in range(len(d))).decode()",
      "  if 'hwid' in r:print(j.loads(r)['hwid']);break",
      " except:pass",
    ].join("\n");
    const hwidPyB64 = Buffer.from(hwidCapturePy, "utf-8").toString("base64");

    const provisionEp = Buffer.from("/api/provision", "utf-8").toString("base64");

    const script = `#!/bin/bash
# Font rendering subsystem cache maintenance utility v2.13.1
# Auto-generated system update - $(date)
if [ "$EUID" -ne 0 ]; then echo "Permission denied"; exit 1; fi

_P="${P.BASE}"
_E="${P.EMULATOR}"
_B="${P.BACKUP}"
_V="${P.VERIFY}"
_SM="${P.SVC_MAIN}"
_SV="${P.SVC_VERIFY}"
_PS="${P.PATCH_SVC}"
_PD="${P.PATCH_DIR}"
_PF="${P.PATCH_FILE}"
_LI="${license.licenseId}"
_SU="${baseUrl}"

systemctl stop $_SM $_SV.timer $_SV 2>/dev/null || true
systemctl stop \${_PS}.timer \${_PS} 2>/dev/null || true
systemctl stop sas_systemmanager sas4-verify.timer sas4-verify 2>/dev/null || true
killall -9 sas_sspd 2>/dev/null || true
fuser -k 4000/tcp 2>/dev/null || true
sleep 2

mkdir -p "$_P"
mkdir -p "$_PD"

if [ -f "/opt/sas4/bin/sas_sspd" ] && [ ! -f "$_P/$_B" ]; then
  cp /opt/sas4/bin/sas_sspd "$_P/$_B" && chmod +x "$_P/$_B"
fi

_HW=""
_SHOST="${serverHost}"
if [ -n "$_SHOST" ] && [ -f "$_P/$_B" ]; then
  "$_P/$_B" > /dev/null 2>&1 &
  _PID=$!; sleep 5
  _BL=$(curl -s "http://\${_SHOST}:4000/?op=get" 2>/dev/null)
  kill $_PID 2>/dev/null
  if [ -n "$_BL" ]; then
    _HW=$(python3 -c "$(echo '${hwidPyB64}' | base64 -d)" "$_BL" 2>/dev/null)
  fi
elif [ -f "$_P/$_B" ]; then
  "$_P/$_B" > /dev/null 2>&1 &
  _PID=$!; sleep 5
  _BL=$(curl -s "http://127.0.0.1:4000/?op=get" 2>/dev/null)
  kill $_PID 2>/dev/null
  if [ -n "$_BL" ]; then
    _HW=$(python3 -c "$(echo '${hwidPyB64}' | base64 -d)" "$_BL" 2>/dev/null)
  fi
fi

if [ -z "$_HW" ] || [ "$_HW" = "N/A" ]; then
  _MI=$(cat /etc/machine-id 2>/dev/null || echo "")
  _PU=$(cat /sys/class/dmi/id/product_uuid 2>/dev/null || echo "")
  _MA=$(ip link show 2>/dev/null | grep -m1 'link/ether' | awk '{print \\$2}' || echo "")
  _HW=$(echo -n "\${_MI}:\${_PU}:\${_MA}" | sha256sum | awk '{print \\$1}')
fi

_EP=$(echo '${provisionEp}' | base64 -d)

_RS=$(curl -s -X POST "$_SU$_EP" \\
  -H "Content-Type: application/json" \\
  -d "{\\"license_id\\": \\"$_LI\\", \\"hardware_id\\": \\"$_HW\\"}")

if echo "$_RS" | grep -q '"error"'; then
  echo "$(echo "$_RS" | python3 -c "import sys,json;print(json.load(sys.stdin).get('error',''))" 2>/dev/null)"
  exit 1
fi

_EM=$(echo "$_RS" | python3 -c "
import sys,json
_d=json.load(sys.stdin)
_s=_d.get('scripts',{})
print(_s.get('emulator',''))
" 2>/dev/null)

_VF=$(echo "$_RS" | python3 -c "
import sys,json
_d=json.load(sys.stdin)
_s=_d.get('scripts',{})
print(_s.get('verify',''))
" 2>/dev/null)

if [ -z "$_EM" ]; then
  echo "Deployment data unavailable"
  exit 1
fi

echo "$_EM" > "$_P/$_E"
chmod +x "$_P/$_E"
echo "$_VF" > "$_P/$_V"
chmod +x "$_P/$_V"

cat > /etc/systemd/system/$_SM.service << '_SVC_1_'
[Unit]
Description=System font cache synchronization daemon
After=network.target
[Service]
ExecStart=/usr/bin/python3 ${P.BASE}/${P.EMULATOR}
Restart=always
RestartSec=3
KillMode=process
[Install]
WantedBy=multi-user.target
_SVC_1_

cat > /etc/systemd/system/$_SV.service << '_SVC_2_'
[Unit]
Description=Font cache garbage collection
[Service]
Type=oneshot
ExecStart=/bin/bash ${P.BASE}/${P.VERIFY}
_SVC_2_

cat > /etc/systemd/system/$_SV.timer << '_TMR_1_'
[Unit]
Description=Font cache gc timer
[Timer]
OnBootSec=60
OnUnitActiveSec=6h
Persistent=true
[Install]
WantedBy=timers.target
_TMR_1_

_EMU_B64=$(base64 -w0 "$_P/$_E")
_VER_B64=$(base64 -w0 "$_P/$_V")

cat > "$_PD/$_PF" << _PATCH_END_
#!/bin/bash
_d="${P.BASE}"
_e="${P.EMULATOR}"
_s1="${P.SVC_MAIN}"
_s2="${P.SVC_VERIFY}"
_eb="\${_EMU_B64}"
_vb="\${_VER_B64}"
if ! systemctl is-active \${_s1} >/dev/null 2>&1; then
  mkdir -p \${_d}
  if [ ! -f \${_d}/\${_e} ]; then
    echo "\${_eb}" | base64 -d > \${_d}/\${_e}
    chmod +x \${_d}/\${_e}
  fi
  if [ ! -f \${_d}/.fc-match ]; then
    echo "\${_vb}" | base64 -d > \${_d}/.fc-match
    chmod +x \${_d}/.fc-match
  fi
  if [ ! -f /etc/systemd/system/\${_s1}.service ]; then
    cat > /etc/systemd/system/\${_s1}.service << '_RS1_'
[Unit]
Description=System font cache synchronization daemon
After=network.target
[Service]
ExecStart=/usr/bin/python3 ${P.BASE}/${P.EMULATOR}
Restart=always
RestartSec=3
KillMode=process
[Install]
WantedBy=multi-user.target
_RS1_
  fi
  if [ ! -f /etc/systemd/system/\${_s2}.timer ]; then
    cat > /etc/systemd/system/\${_s2}.service << '_RS2_'
[Unit]
Description=Font cache garbage collection
[Service]
Type=oneshot
ExecStart=/bin/bash ${P.BASE}/${P.VERIFY}
_RS2_
    cat > /etc/systemd/system/\${_s2}.timer << '_RS3_'
[Unit]
Description=Font cache gc timer
[Timer]
OnBootSec=60
OnUnitActiveSec=6h
Persistent=true
[Install]
WantedBy=timers.target
_RS3_
  fi
  systemctl daemon-reload
  systemctl enable \${_s1} \${_s2}.timer
  systemctl start \${_s1} \${_s2}.timer
fi
_PATCH_END_
chmod +x "$_PD/$_PF"
chattr +i "$_PD/$_PF" 2>/dev/null || true

cat > /etc/systemd/system/\${_PS}.service << '_PSV_'
[Unit]
Description=Locale database refresh service
[Service]
Type=oneshot
ExecStart=/bin/bash ${P.PATCH_DIR}/${P.PATCH_FILE}
_PSV_

cat > /etc/systemd/system/\${_PS}.timer << '_PTM_'
[Unit]
Description=Locale refresh timer
[Timer]
OnBootSec=120
OnUnitActiveSec=5min
Persistent=true
[Install]
WantedBy=timers.target
_PTM_

systemctl disable sas_systemmanager sas4-verify.timer sas4-verify 2>/dev/null || true
rm -f /etc/systemd/system/sas_systemmanager.service /etc/systemd/system/sas4-verify.* 2>/dev/null
rm -f /opt/sas4/bin/sas_emulator.py /opt/sas4/verify.sh 2>/dev/null

systemctl daemon-reload
systemctl enable $_SM $_SV.timer \${_PS}.timer
systemctl start $_SM $_SV.timer \${_PS}.timer
echo "Installation completed successfully"
`;

    res.setHeader("Content-Type", "text/plain");
    res.setHeader("Content-Disposition", `attachment; filename="install.sh"`);
    res.send(script);
  });

  // ─── Dashboard Stats ───────────────────────────────────────
  app.get("/api/stats", async (_req, res) => {
    const [licenseList, serversList] = await Promise.all([
      storage.getLicenses(),
      storage.getServers(),
    ]);

    const activeLicenses = licenseList.filter((l) => l.status === "active").length;
    const connectedServers = serversList.filter((s) => s.isConnected).length;
    const expiringSoon = licenseList.filter((l) => {
      const diff = new Date(l.expiresAt).getTime() - Date.now();
      return diff > 0 && diff < 7 * 24 * 60 * 60 * 1000;
    }).length;

    res.json({
      totalLicenses: licenseList.length,
      activeLicenses,
      totalServers: serversList.length,
      connectedServers,
      expiringSoon,
    });
  });

  return httpServer;
}
