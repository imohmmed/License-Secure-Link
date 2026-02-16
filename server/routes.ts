import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { testSSHConnection, deployLicenseToServer } from "./ssh-service";
import { insertServerSchema, insertLicenseSchema } from "@shared/schema";

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {

  function sanitizeServer(server: any) {
    const { password, ...safe } = server;
    return { ...safe, password: "********" };
  }

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

    await storage.deleteServer(req.params.id);
    await storage.createActivityLog({
      serverId: null,
      action: "delete_server",
      details: `تم حذف السيرفر ${server.name} (${server.host})`,
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
    const parsed = insertLicenseSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: parsed.error.message });
    }

    const existing = await storage.getLicenseByLicenseId(parsed.data.licenseId);
    if (existing) {
      return res.status(409).json({ message: "معرف الترخيص موجود مسبقاً" });
    }

    let hardwareId: string | null = null;
    if (parsed.data.serverId) {
      const server = await storage.getServer(parsed.data.serverId);
      if (server?.hardwareId) {
        hardwareId = server.hardwareId;
      }
    }

    const license = await storage.createLicense(parsed.data);

    if (hardwareId) {
      await storage.updateLicense(license.id, { hardwareId });
    }

    await storage.createActivityLog({
      licenseId: license.id,
      serverId: parsed.data.serverId || null,
      action: "create_license",
      details: `تم إنشاء الترخيص ${parsed.data.licenseId}`,
    });

    const updatedLicense = await storage.getLicense(license.id);
    res.json(updatedLicense);
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
            status
          );
        } catch (e) {
          // Log deployment error but don't fail the status update
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
          license.status
        );
      } catch (e) {
        // Deployment error logged separately
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

    const result = await deployLicenseToServer(
      server.host, server.port, server.username, server.password,
      hwid, license.licenseId,
      new Date(license.expiresAt), license.maxUsers, license.maxSites,
      license.status
    );

    if (result.success) {
      if (!license.hardwareId) {
        await storage.updateLicense(req.params.id, { hardwareId: hwid });
      }

      await storage.createActivityLog({
        licenseId: req.params.id,
        serverId: license.serverId,
        action: "deploy_license",
        details: `تم نشر الترخيص ${license.licenseId} على السيرفر ${server.name}`,
      });

      res.json({ success: true, message: "تم النشر بنجاح" });
    } else {
      res.status(500).json({ message: result.error || "فشل النشر" });
    }
  });

  app.delete("/api/licenses/:id", async (req, res) => {
    const license = await storage.getLicense(req.params.id);
    if (!license) return res.status(404).json({ message: "الترخيص غير موجود" });

    await storage.deleteLicense(req.params.id);
    await storage.createActivityLog({
      licenseId: null,
      serverId: null,
      action: "delete_license",
      details: `تم حذف الترخيص ${license.licenseId}`,
    });
    res.json({ success: true });
  });

  // ─── Activity Logs ──────────────────────────────────────────
  app.get("/api/activity-logs", async (_req, res) => {
    const logs = await storage.getActivityLogs();
    res.json(logs);
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
