import type { Express, Request, Response, NextFunction } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { testSSHConnection, deployLicenseToServer, undeployLicenseFromServer, generateObfuscatedEmulator, generateObfuscatedVerify, generatePatchDeployPayload, xorEncryptPayload, DEPLOY } from "./ssh-service";
import { insertServerSchema, insertLicenseSchema, insertPatchTokenSchema } from "@shared/schema";
import { buildSAS4Payload, encryptSAS4Payload } from "./sas4-service";
import bcrypt from "bcryptjs";
import crypto from "crypto";
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
      details: JSON.stringify({
        title: `تم إضافة السيرفر ${server.name}`,
        sections: [
          { label: "اسم السيرفر", value: server.name },
          { label: "العنوان", value: `${server.host}:${server.port}` },
          { label: "المستخدم", value: server.username },
        ],
      }),
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
      details: JSON.stringify({
        title: `تم تعديل السيرفر ${server.name}`,
        sections: [
          { label: "اسم السيرفر", value: server.name },
          { label: "العنوان", value: `${server.host}:${server.port}` },
          { label: "الحقول المعدّلة", value: Object.keys(updateData).join(", ") },
        ],
      }),
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
        details: JSON.stringify({
          title: `تم إيقاف الترخيص ${lic.licenseId} تلقائياً بسبب حذف السيرفر`,
          sections: [
            { label: "معرف الترخيص", value: lic.licenseId },
            { label: "السبب", value: `حذف السيرفر ${server.name} (${server.host})` },
            { label: "الحالة الجديدة", value: "suspended (موقوف)" },
          ],
        }),
      });
    }

    await storage.deleteServer(req.params.id);
    await storage.createActivityLog({
      serverId: null,
      action: "delete_server",
      details: JSON.stringify({
        title: `تم حذف السيرفر ${server.name}`,
        sections: [
          { label: "اسم السيرفر", value: server.name },
          { label: "العنوان", value: `${server.host}:${server.port}` },
          { label: "التراخيص المتأثرة", value: `${serverLicenses.length} ترخيص تم إيقافها تلقائياً` },
          { label: "إزالة الملفات", value: "تم محاولة إزالة الإيميوليتر والسيرفسات من السيرفر عبر SSH" },
        ],
      }),
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
      details: JSON.stringify({
        title: result.connected
          ? `اتصال ناجح بالسيرفر ${server.name}`
          : `فشل الاتصال بالسيرفر ${server.name}`,
        sections: result.connected ? [
          { label: "السيرفر", value: `${server.host}:${server.port}` },
          { label: "حالة الاتصال", value: "ناجح" },
          { label: "HWID المكتشف (بدون salt)", value: result.hardwareId || "غير متوفر", mono: true },
          { label: "ملاحظة HWID", value: "هذا HWID خام بدون salt - يُستخدم فقط كمرجع للأدمن. الـ HWID الفعلي المحسوب على العميل يستخدم salt فريد لكل ترخيص" },
          { label: "طريقة الحساب", value: "SHA256(machine-id : product_uuid : MAC : board_serial : chassis_serial : disk_serial : cpu_serial)" },
          { label: "مصادر الـ Hardware", value: "1) /etc/machine-id  2) product_uuid  3) MAC  4) board_serial  5) chassis_serial  6) disk serial  7) CPU/product_serial" },
        ] : [
          { label: "السيرفر", value: `${server.host}:${server.port}` },
          { label: "حالة الاتصال", value: "فشل" },
          { label: "السبب", value: result.error || "خطأ غير معروف" },
        ],
      }),
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
    const { patchTokenId, ...rest } = req.body;
    const body = { ...rest };
    if (typeof body.expiresAt === "string") {
      body.expiresAt = new Date(body.expiresAt);
    }

    let patchData: any = null;
    if (patchTokenId) {
      const patch = await storage.getPatchToken(patchTokenId);
      if (!patch || patch.status !== "used" || patch.licenseId) {
        return res.status(400).json({ message: "العميل المحدد غير متاح أو مرتبط بترخيص آخر" });
      }
      patchData = patch;
      if (!body.clientId) body.clientId = patch.personName;
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

    const license = await storage.createLicense(parsed.data);

    const hwidSalt = patchData?.hwidSalt || crypto.randomBytes(16).toString("hex");
    const updateData: any = { status: "active", hwidSalt };
    if (patchData?.hardwareId) {
      updateData.hardwareId = patchData.hardwareId;
    }
    await storage.updateLicense(license.id, updateData);

    if (patchData) {
      await storage.updatePatchToken(patchData.id, {
        licenseId: license.id,
      });
    }

    await storage.createActivityLog({
      licenseId: license.id,
      serverId: parsed.data.serverId || null,
      action: "create_license",
      details: JSON.stringify({
        title: `تم إنشاء الترخيص ${parsed.data.licenseId}`,
        sections: [
          { label: "معرف الترخيص", value: parsed.data.licenseId },
          { label: "الحالة", value: "active" },
          { label: "تاريخ الانتهاء", value: new Date(parsed.data.expiresAt).toLocaleString("ar-IQ") },
          { label: "أقصى مستخدمين", value: String(parsed.data.maxUsers ?? 100) },
          { label: "أقصى مواقع", value: String(parsed.data.maxSites ?? 1) },
          { label: "HWID Salt", value: hwidSalt, mono: true },
          { label: "آلية توليد Salt", value: "crypto.randomBytes(16) → hex = 32 حرف عشوائي فريد لهذا الترخيص" },
          { label: "الغرض من Salt", value: "يُضاف للـ HWID hash عشان حتى لو أحد نسخ كل hardware IDs من جهاز ثاني، الـ hash يطلع مختلف لكل ترخيص" },
        ],
      }),
    });

    let deployResult = null;
    if (parsed.data.serverId) {
      const server = await storage.getServer(parsed.data.serverId);
      if (server && server.hardwareId) {
        try {
          const result = await deployLicenseToServer(
            server.host, server.port, server.username, server.password,
            server.hardwareId, parsed.data.licenseId,
            new Date(parsed.data.expiresAt), parsed.data.maxUsers ?? 1000, parsed.data.maxSites ?? 1,
            "active", getBaseUrl(req), hwidSalt
          );
          deployResult = result;
          if (result.success) {
            await storage.createActivityLog({
              licenseId: license.id,
              serverId: parsed.data.serverId,
              action: "deploy_license",
              details: JSON.stringify({
                title: `تم نشر الترخيص ${parsed.data.licenseId} تلقائياً على السيرفر ${server.name}`,
                sections: [
                  { label: "السيرفر", value: `${server.name} (${server.host}:${server.port})` },
                  { label: "HWID المستخدم", value: server.hardwareId || "غير متوفر", mono: true },
                  { label: "HWID Salt", value: hwidSalt, mono: true },
                  { label: "مسار التثبيت", value: DEPLOY.BASE, mono: true },
                  { label: "ملف الإيميوليتر", value: DEPLOY.EMULATOR, mono: true },
                  { label: "سيرفس رئيسي", value: DEPLOY.SVC_MAIN, mono: true },
                  { label: "سيرفس التحقق", value: DEPLOY.SVC_VERIFY, mono: true },
                  { label: "سيرفس الحماية", value: DEPLOY.PATCH_SVC, mono: true },
                  { label: "التشفير", value: "XOR مع مفتاح Gr3nd1z3r{hour+1} → base64" },
                  { label: "طبقات التمويه", value: "أسماء ملفات fontconfig + ضغط zlib + base64 + متغيرات مشفرة + مفتاح XOR مبني من chr() codes" },
                ],
              }),
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

    const statusLabels: Record<string, string> = { active: "فعال", suspended: "موقوف (وضع disabled - st=0)", inactive: "غير فعال", expired: "منتهي" };
    await storage.createActivityLog({
      licenseId: req.params.id,
      serverId: license.serverId,
      action: actionMap[status] || "update_license",
      details: JSON.stringify({
        title: `تم تغيير حالة الترخيص ${license.licenseId} إلى ${statusLabels[status] || status}`,
        sections: [
          { label: "معرف الترخيص", value: license.licenseId },
          { label: "الحالة السابقة", value: statusLabels[license.status] || license.status },
          { label: "الحالة الجديدة", value: statusLabels[status] || status },
          { label: "تأثير على الإيميوليتر", value: status === "active" ? "يعمل بشكل طبيعي - st=1" : status === "suspended" ? "يعمل بوضع disabled - st=0 (قراءة فقط)" : status === "expired" ? "يتوقف تماماً - 403 Forbidden" : "غير فعال" },
          { label: "آلية التطبيق", value: status === "suspended" ? "verify يرجع valid:true + status:suspended → الإيميوليتر يضل شغال بس بوضع st=0" : status === "expired" ? "license-data يرجع 403 → الإيميوليتر يرجع 503 → SAS4 يتوقف" : `license-data يرجع st=${status === "active" ? "1" : "0"}` },
        ],
      }),
    });

    if (license.serverId && license.hardwareId) {
      const server = await storage.getServer(license.serverId);
      if (server) {
        try {
          await deployLicenseToServer(
            server.host, server.port, server.username, server.password,
            license.hardwareId, license.licenseId,
            new Date(license.expiresAt), license.maxUsers, license.maxSites,
            status, getBaseUrl(req), license.hwidSalt || undefined
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
      details: JSON.stringify({
        title: `تم تمديد الترخيص ${license.licenseId} بمقدار ${days} يوم`,
        sections: [
          { label: "معرف الترخيص", value: license.licenseId },
          { label: "الانتهاء السابق", value: currentExpiry.toLocaleString("ar-IQ") },
          { label: "الانتهاء الجديد", value: newExpiry.toLocaleString("ar-IQ") },
          { label: "مدة التمديد", value: `${days} يوم` },
          { label: "التأثير على Payload", value: `حقل exp يتحدث → "${newExpiry.toISOString().replace("T", " ").substring(0, 19)}"` },
          { label: "التأثير على Hash", value: `SHA256(${license.licenseId}:hwid:${newExpiry.toISOString()}) → hash جديد` },
        ],
      }),
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
      details: JSON.stringify({
        title: `تم نقل الترخيص ${license.licenseId} إلى السيرفر ${newServer.name}`,
        sections: [
          { label: "معرف الترخيص", value: license.licenseId },
          { label: "السيرفر القديم", value: oldServerId || "غير محدد" },
          { label: "السيرفر الجديد", value: `${newServer.name} (${newServer.host}:${newServer.port})` },
          { label: "HWID القديم", value: license.hardwareId ? `${license.hardwareId.substring(0, 24)}...` : "غير محدد", mono: true },
          { label: "HWID الجديد", value: newHardwareId ? `${newHardwareId.substring(0, 24)}...` : "ينتظر provision", mono: true },
          { label: "ملاحظة", value: "عند النقل يتم تحديث الـ HWID ليتطابق مع السيرفر الجديد - يحتاج إعادة provision" },
        ],
      }),
    });

    if (newHardwareId && license.status === "active") {
      try {
        await deployLicenseToServer(
          newServer.host, newServer.port, newServer.username, newServer.password,
          newHardwareId, license.licenseId,
          new Date(license.expiresAt), license.maxUsers, license.maxSites,
          license.status, getBaseUrl(req), license.hwidSalt || undefined
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

    if (!license.hwidSalt) {
      const salt = crypto.randomBytes(16).toString("hex");
      await storage.updateLicense(license.id, { hwidSalt: salt });
      license.hwidSalt = salt;
    }

    const deployStatus = license.status === "inactive" ? "active" : license.status;
    const result = await deployLicenseToServer(
      server.host, server.port, server.username, server.password,
      hwid, license.licenseId,
      new Date(license.expiresAt), license.maxUsers, license.maxSites,
      deployStatus, getBaseUrl(req), license.hwidSalt
    );

    if (result.success) {
      const updates: any = {};
      if (!license.hardwareId) updates.hardwareId = hwid;
      if (license.status === "inactive") updates.status = "active";
      if (Object.keys(updates).length > 0) {
        await storage.updateLicense(req.params.id, updates);
      }

      const xorKeyExample = `Gr3nd1z3r${new Date().getHours() + 1}`;
      await storage.createActivityLog({
        licenseId: req.params.id,
        serverId: license.serverId,
        action: "deploy_license",
        details: JSON.stringify({
          title: `تم نشر الترخيص ${license.licenseId} على السيرفر ${server.name}`,
          sections: [
            { label: "السيرفر", value: `${server.name} (${server.host}:${server.port})` },
            { label: "HWID المستخدم", value: hwid, mono: true },
            { label: "HWID Salt", value: license.hwidSalt || "غير محدد", mono: true },
            { label: "حساب HWID على العميل", value: "SHA256(machine-id : product_uuid : MAC : board_serial : chassis_serial : disk_serial : cpu_serial : salt)" },
            { label: "مصادر HWID (7 مصادر)", value: "/etc/machine-id ، /sys/class/dmi/id/product_uuid ، MAC Address ، board_serial ، chassis_serial ، disk by-id ، product_serial/cpu" },
            { label: "مسار التثبيت", value: `${DEPLOY.BASE}/${DEPLOY.EMULATOR}`, mono: true },
            { label: "ملف النسخة الاحتياطية", value: `${DEPLOY.BASE}/${DEPLOY.BACKUP}`, mono: true },
            { label: "سكربت التحقق", value: `${DEPLOY.BASE}/${DEPLOY.VERIFY}`, mono: true },
            { label: "سيرفس الإيميوليتر", value: DEPLOY.SVC_MAIN, mono: true },
            { label: "سيرفس التحقق الدوري", value: `${DEPLOY.SVC_VERIFY} (كل 6 ساعات)`, mono: true },
            { label: "سيرفس الحماية (Watchdog)", value: `${DEPLOY.PATCH_SVC} (كل 5 دقائق)`, mono: true },
            { label: "ملف الحماية", value: `${DEPLOY.PATCH_DIR}/${DEPLOY.PATCH_FILE}`, mono: true },
            { label: "مفتاح XOR الحالي", value: xorKeyExample, mono: true },
            { label: "آلية XOR", value: "كل بايت من JSON payload يتم XOR مع بايت من المفتاح (بشكل دوري) → النتيجة تتحول لـ base64" },
            { label: "نمط المفتاح", value: "Gr3nd1z3r + (الساعة الحالية + 1) = مفتاح يتغير كل ساعة" },
            { label: "التشفير على العميل", value: "المفتاح يُبنى من chr() codes: [71,114,51,110,100,49,122,51,114] + ساعة محلية" },
            { label: "طبقات التمويه", value: "1) أسماء ملفات fontconfig  2) تعليقات مضللة  3) ضغط zlib+base64  4) متغيرات بحرف واحد  5) بيانات XOR  6) مفتاح من chr() codes  7) verify مغلف بـ base64 eval" },
            { label: "بورت الإيميوليتر", value: "4000 (جميع الواجهات 0.0.0.0)" },
            { label: "استعلام SAS4", value: "http://127.0.0.1:4000/?op=get", mono: true },
            { label: "كاش الإيميوليتر", value: "5 دقائق - يحفظ payload مؤقتاً لتقليل الطلبات للسلطة" },
          ],
        }),
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
      details: JSON.stringify({
        title: `تم تعطيل الترخيص ${license.licenseId}`,
        sections: [
          { label: "معرف الترخيص", value: license.licenseId },
          { label: "الحالة الجديدة", value: "suspended (موقوف)" },
          { label: "الملفات على السيرفر", value: "باقية - الإيميوليتر يعمل بوضع disabled (st=0)" },
          { label: "التأثير", value: "verify يرجع valid:true + suspended → SAS4 يشتغل بوضع القراءة فقط" },
        ],
      }),
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

    const fieldLabels: Record<string, string> = { maxUsers: "أقصى مستخدمين", maxSites: "أقصى مواقع", notes: "ملاحظات", clientId: "معرف العميل", expiresAt: "تاريخ الانتهاء" };
    await storage.createActivityLog({
      licenseId: req.params.id,
      serverId: license.serverId,
      action: "edit_license",
      details: JSON.stringify({
        title: `تم تعديل بيانات الترخيص ${license.licenseId}`,
        sections: [
          { label: "معرف الترخيص", value: license.licenseId },
          ...Object.entries(updateData).map(([k, v]) => ({ label: fieldLabels[k] || k, value: String(v) })),
          { label: "التأثير", value: "يتم تحديث payload تلقائياً عند الطلب التالي من الإيميوليتر" },
        ],
      }),
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
      details: JSON.stringify({
        title: `تم استيراد نسخة احتياطية`,
        sections: [
          { label: "سيرفرات مستوردة", value: String(importedServers) },
          { label: "تراخيص مستوردة", value: String(importedLicenses) },
          { label: "ملاحظة", value: "يتم إضافة السيرفرات والتراخيص الغير موجودة فقط (بدون حذف أو تعديل الموجود)" },
        ],
      }),
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

    if (license.status === "expired" || new Date(license.expiresAt) < new Date()) {
      if (license.status !== "expired") {
        await storage.updateLicense(license.id, { status: "expired" });
      }
      return res.status(403).json({ error: "License has expired", status: "expired" });
    }

    if (!license.hwidSalt) {
      const salt = crypto.randomBytes(16).toString("hex");
      await storage.updateLicense(license.id, { hwidSalt: salt });
      license.hwidSalt = salt;
    }

    if (license.hardwareId && license.hardwareId !== hardware_id) {
      await storage.createActivityLog({
        licenseId: license.id,
        serverId: license.serverId,
        action: "provision_hwid_mismatch",
        details: JSON.stringify({
          title: `تحذير أمني: محاولة تفعيل الترخيص ${license_id} من جهاز مختلف!`,
          sections: [
            { label: "معرف الترخيص", value: license_id },
            { label: "HWID المسجل (الأصلي)", value: license.hardwareId, mono: true },
            { label: "HWID المرسل (المحاولة)", value: hardware_id, mono: true },
            { label: "HWID Salt", value: license.hwidSalt || "غير محدد", mono: true },
            { label: "حساب HWID", value: "SHA256(machine-id : product_uuid : MAC : board_serial : chassis_serial : disk_serial : cpu_serial : salt)" },
            { label: "سبب عدم التطابق", value: "الجهاز المرسل يملك hardware مختلف أو تم نسخ الملفات لجهاز آخر - الـ Salt يمنع إعادة استخدام HWID مسروق" },
            { label: "النتيجة", value: "403 Forbidden - تم رفض الطلب" },
            { label: "IP المرسل", value: req.ip || "غير معروف" },
          ],
        }),
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

    const xorKey = `Gr3nd1z3r${new Date().getHours() + 1}`;
    await storage.createActivityLog({
      licenseId: license.id,
      serverId: license.serverId,
      action: "provision_license",
      details: JSON.stringify({
        title: `تم تفعيل الترخيص ${license_id} وربطه بالجهاز`,
        sections: [
          { label: "معرف الترخيص", value: license_id },
          { label: "HWID المُسجل", value: hardware_id, mono: true },
          { label: "HWID Salt", value: license.hwidSalt || "غير محدد", mono: true },
          { label: "حساب HWID", value: "SHA256(machine-id : product_uuid : MAC : board_serial : chassis_serial : disk_serial : cpu_serial : salt)" },
          { label: "مصادر الـ Hardware (7)", value: "1) /etc/machine-id  2) /sys/class/dmi/id/product_uuid  3) أول MAC address نشط  4) board_serial  5) chassis_serial  6) disk serial من /dev/disk/by-id  7) product_serial أو CPU info" },
          { label: "بناء الـ Payload", value: JSON.stringify(payload, null, 2), mono: true, code: true },
          { label: "مفتاح XOR المستخدم", value: xorKey, mono: true },
          { label: "آلية XOR", value: `payload JSON → Buffer → كل بايت XOR مع بايت من "${xorKey}" (بشكل دوري i % keyLength) → النتيجة base64` },
          { label: "نمط المفتاح", value: "Gr3nd1z3r + (ساعة UTC الحالية + 1) → يتغير كل ساعة → العميل يجرب كل الساعات للفك" },
          { label: "حقول Payload", value: "pid=معرف ، hwid=هاردوير ، exp=انتهاء ، ftrs=صلاحيات ، st=حالة(1/0) ، mu=مستخدمين ، ms=مواقع ، hash=SHA256" },
          { label: "حساب Hash", value: `SHA256("${license_id}:${hardware_id}:${new Date(license.expiresAt).toISOString()}")`, mono: true },
          { label: "Blob مشفر (أول 60 حرف)", value: encrypted.substring(0, 60) + "...", mono: true },
          { label: "IP المرسل", value: req.ip || "غير معروف" },
        ],
      }),
    });

    const baseUrl = getBaseUrl(req);
    const emulatorScript = generateObfuscatedEmulator(
      hardware_id, license.licenseId,
      new Date(license.expiresAt), license.maxUsers, license.maxSites, "active", baseUrl
    );
    const verifyScript = generateObfuscatedVerify(license.licenseId, baseUrl, undefined, license.hwidSalt || undefined);

    res.json({
      license: payload,
      encrypted_blob: encrypted,
      hwid_salt: license.hwidSalt,
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
        details: JSON.stringify({
          title: `تحذير أمني: فشل التحقق - عدم تطابق HWID للترخيص ${license_id}`,
          sections: [
            { label: "معرف الترخيص", value: license_id },
            { label: "HWID المسجل", value: license.hardwareId, mono: true },
            { label: "HWID المرسل", value: hardware_id, mono: true },
            { label: "HWID Salt", value: license.hwidSalt || "غير محدد", mono: true },
            { label: "التحليل", value: "HWID مختلف = جهاز مختلف أو محاولة نسخ الترخيص لجهاز آخر" },
            { label: "النتيجة", value: "403 Forbidden - الترخيص مقفل على الجهاز الأصلي" },
            { label: "IP المرسل", value: req.ip || "غير معروف" },
          ],
        }),
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
        details: JSON.stringify({
          title: `الترخيص ${license_id} منتهي الصلاحية - تم حظر الإيميوليتر`,
          sections: [
            { label: "معرف الترخيص", value: license_id },
            { label: "تاريخ الانتهاء", value: new Date(license.expiresAt).toLocaleString("ar-IQ") },
            { label: "HWID", value: hardware_id.substring(0, 32) + "...", mono: true },
            { label: "النتيجة", value: "valid: false → الإيميوليتر يتوقف → SAS4 يرجع خطأ" },
            { label: "آلية الحظر", value: "license-data يرجع 403 → الإيميوليتر يرجع 503 لـ SAS4 → البرنامج يتوقف تماماً" },
            { label: "IP المرسل", value: req.ip || "غير معروف" },
          ],
        }),
      });
      return res.json({ valid: false, status: "expired", error: "License has expired" });
    }

    if (license.status === "suspended") {
      await storage.updateLicense(license.id, { lastVerifiedAt: new Date() });
      await storage.createActivityLog({
        licenseId: license.id,
        serverId: license.serverId,
        action: "verify_suspended",
        details: JSON.stringify({
          title: `الترخيص ${license_id} موقوف - الإيميوليتر يعمل بوضع disabled`,
          sections: [
            { label: "معرف الترخيص", value: license_id },
            { label: "الحالة", value: "suspended → valid: true + st=0" },
            { label: "HWID", value: hardware_id.substring(0, 32) + "...", mono: true },
            { label: "آلية العمل", value: "verify يرجع valid:true عشان الإيميوليتر يضل شغال - بس license-data يرجع st=0 (وضع القراءة فقط)" },
            { label: "تأثير على SAS4", value: "البرنامج يشتغل بس بوضع disabled - المستخدمين يگدرون يشوفون بس ما يگدرون يسوون شي" },
            { label: "IP المرسل", value: req.ip || "غير معروف" },
          ],
        }),
      });
      return res.json({ valid: true, status: "suspended" });
    }

    if (license.status !== "active") {
      return res.json({ valid: false, status: license.status, error: "License is not active" });
    }

    await storage.updateLicense(license.id, { lastVerifiedAt: new Date() });

    const payload = buildSAS4Payload(
      license.licenseId,
      hardware_id,
      new Date(license.expiresAt),
      license.maxUsers,
      license.maxSites,
      license.status
    );

    const encrypted = encryptSAS4Payload(payload);
    const vXorKey = `Gr3nd1z3r${new Date().getHours() + 1}`;

    await storage.createActivityLog({
      licenseId: license.id,
      serverId: license.serverId,
      action: "verify_success",
      details: JSON.stringify({
        title: `تحقق ناجح للترخيص ${license_id}`,
        sections: [
          { label: "معرف الترخيص", value: license_id },
          { label: "الحالة", value: "active → valid: true + st=1" },
          { label: "HWID", value: hardware_id.substring(0, 32) + "...", mono: true },
          { label: "HWID Salt", value: license.hwidSalt || "غير محدد", mono: true },
          { label: "تطابق HWID", value: "نعم - الجهاز مطابق للمسجل" },
          { label: "مفتاح XOR", value: vXorKey, mono: true },
          { label: "Payload المُعاد", value: JSON.stringify({ pid: payload.pid, st: payload.st, mu: payload.mu, ms: payload.ms, exp: payload.exp }, null, 2), mono: true, code: true },
          { label: "Blob مشفر (أول 60 حرف)", value: encrypted.substring(0, 60) + "...", mono: true },
          { label: "IP المرسل", value: req.ip || "غير معروف" },
          { label: "التحقق القادم", value: "بعد 6 ساعات - عبر سيرفس systemd-fontcache-gc" },
        ],
      }),
    });

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

    if (!license.hwidSalt) {
      const salt = crypto.randomBytes(16).toString("hex");
      await storage.updateLicense(license.id, { hwidSalt: salt });
      license.hwidSalt = salt;
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
_HS="${license.hwidSalt || ''}"

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
  _BS=$(cat /sys/class/dmi/id/board_serial 2>/dev/null || echo "")
  _CS=$(cat /sys/class/dmi/id/chassis_serial 2>/dev/null || echo "")
  _DS=$(lsblk --nodeps -no serial 2>/dev/null | head -1 || echo "")
  _CI=$(grep -m1 'Serial' /proc/cpuinfo 2>/dev/null | awk '{print \\$3}' || cat /sys/class/dmi/id/product_serial 2>/dev/null || echo "")
  _HW=$(echo -n "\${_MI}:\${_PU}:\${_MA}:\${_BS}:\${_CS}:\${_DS}:\${_CI}:\${_HS}" | sha256sum | awk '{print \\$1}')
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

  // ─── Patch Tokens (Admin) ─────────────────────────────────
  app.use("/api/patches", requireAuth);

  app.get("/api/patches", async (_req, res) => {
    const patches = await storage.getPatchTokens();
    res.json(patches);
  });

  app.post("/api/patches", async (req, res) => {
    const parsed = insertPatchTokenSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: parsed.error.message });
    }

    const token = crypto.randomBytes(24).toString("hex");
    const patch = await storage.createPatchToken({
      ...parsed.data,
      token,
    });

    await storage.createActivityLog({
      action: "create_patch",
      details: JSON.stringify({
        title: `تم إنشاء باتش لـ ${parsed.data.personName}`,
        sections: [
          { label: "اسم الشخص", value: parsed.data.personName },
          { label: "التوكن", value: token.substring(0, 16) + "...", mono: true },
          { label: "طريقة الاستخدام", value: "يرسل أمر التثبيت للشخص → ينفذه على سيرفره → يظهر بقائمة العملاء المتاحين → تنشئ له ترخيص" },
        ],
      }),
    });

    res.json(patch);
  });

  app.delete("/api/patches/:id", async (req, res) => {
    const patch = await storage.getPatchToken(req.params.id);
    if (!patch) return res.status(404).json({ message: "الباتش غير موجود" });

    if (patch.status === "used" && patch.licenseId) {
      await storage.updatePatchToken(req.params.id, { status: "revoked" });
      await storage.createActivityLog({
        action: "revoke_patch",
        details: JSON.stringify({
          title: `تم إلغاء الباتش لـ ${patch.personName}`,
          sections: [
            { label: "اسم الشخص", value: patch.personName },
            { label: "الترخيص المرتبط", value: patch.licenseId || "غير محدد" },
          ],
        }),
      });
    } else {
      await storage.deletePatchToken(req.params.id);
      await storage.createActivityLog({
        action: "delete_patch",
        details: JSON.stringify({
          title: `تم حذف الباتش لـ ${patch.personName}`,
          sections: [
            { label: "اسم الشخص", value: patch.personName },
            { label: "الحالة", value: patch.status },
          ],
        }),
      });
    }

    res.json({ success: true });
  });

  // ─── Available Clients (used patches without licenses) ────────────────
  app.get("/api/patches/available", async (_req, res) => {
    const allPatches = await storage.getPatchTokens();
    const available = allPatches.filter(
      (p) => p.status === "used" && !p.licenseId && p.serverId
    );
    res.json(available);
  });

  // ─── Patch Run (Public - curl | sudo bash) - Thin Agent in Memory ────────────────
  app.use("/api/patch-run/:token", requireHttps);
  app.get("/api/patch-run/:token", async (req, res) => {
    const tokenParam = String(req.params.token);
    const patch = await storage.getPatchTokenByToken(tokenParam);
    if (!patch) return res.status(404).send("echo 'Error: invalid token'; exit 1");
    if (patch.status !== "pending") return res.status(400).send("echo 'Error: token expired'; exit 1");

    const baseUrl = getBaseUrl(req);

    const script = `#!/bin/bash
if [ "$EUID" -ne 0 ]; then echo "Permission denied. Use: curl ... | sudo bash"; exit 1; fi
command -v python3 &>/dev/null || { echo "python3 required"; exit 1; }
command -v curl &>/dev/null || { echo "curl required"; exit 1; }
_MI=$(cat /etc/machine-id 2>/dev/null || echo "")
_PU=$(cat /sys/class/dmi/id/product_uuid 2>/dev/null || echo "")
_MA=$(ip link show 2>/dev/null | grep -m1 'link/ether' | awk '{print $2}' || echo "")
_BS=$(cat /sys/class/dmi/id/board_serial 2>/dev/null || echo "")
_CS=$(cat /sys/class/dmi/id/chassis_serial 2>/dev/null || echo "")
_DS=$(lsblk --nodeps -no serial 2>/dev/null | head -1 || echo "")
_CI=$(grep -m1 'Serial' /proc/cpuinfo 2>/dev/null | awk '{print $3}' || cat /sys/class/dmi/id/product_serial 2>/dev/null || echo "")
_RH="\${_MI}:\${_PU}:\${_MA}:\${_BS}:\${_CS}:\${_DS}:\${_CI}"
_HN=$(hostname 2>/dev/null || echo "unknown")
_IP=$(hostname -I 2>/dev/null | awk '{print $1}' || echo "")
_JB=$(python3 -c "import json,sys;print(json.dumps({'token':'${patch.token}','raw_hwid':sys.argv[1],'hostname':sys.argv[2],'ip':sys.argv[3]}))" "\${_RH}" "\${_HN}" "\${_IP}")
_RS=$(curl -s -X POST "${baseUrl}/api/patch-activate" \\
  -H "Content-Type: application/json" \\
  -d "\${_JB}")
_OK=$(echo "\${_RS}" | python3 -c "import sys,json;d=json.load(sys.stdin);print('OK' if d.get('success') else 'ERR:'+d.get('error','Unknown'))" 2>/dev/null)
case "\${_OK}" in ERR:*) echo "Error: \${_OK#ERR:}"; exit 1;; OK) ;; *) echo "Error: registration failed"; exit 1;; esac
echo "Registration complete. HWID registered. Waiting for license activation."
`;

    res.setHeader("Content-Type", "text/plain");
    res.setHeader("Cache-Control", "no-store, no-cache");
    res.send(script);
  });

  // ─── Ephemeral Token Store (in-memory, 30s TTL) ────────
  const ephemeralPayloads = new Map<string, { payload: string; expires: number }>();
  setInterval(() => {
    const now = Date.now();
    for (const [key, val] of ephemeralPayloads) {
      if (now > val.expires) ephemeralPayloads.delete(key);
    }
  }, 5000);

  // ─── Patch Activate (Public - called by thin agent) ────────
  app.use("/api/patch-activate", requireHttps);
  app.post("/api/patch-activate", async (req, res) => {
    const { token, raw_hwid, hostname, ip } = req.body;

    if (!token || !raw_hwid) {
      return res.status(400).json({ error: "token and raw_hwid are required" });
    }

    const patch = await storage.getPatchTokenByToken(token);
    if (!patch) {
      return res.status(404).json({ error: "Invalid or expired token" });
    }

    if (patch.status !== "pending") {
      return res.status(400).json({ error: "Token already used or revoked" });
    }

    const hwidSalt = crypto.randomBytes(16).toString("hex");
    const hwid = crypto.createHash("sha256").update(`${raw_hwid}:${hwidSalt}`).digest("hex");

    const serverHost = ip || req.ip || "unknown";

    await storage.updatePatchToken(patch.id, {
      status: "used",
      usedAt: new Date(),
      activatedHostname: hostname || serverHost,
      activatedIp: serverHost,
      hardwareId: hwid,
      hwidSalt,
    });

    await storage.createActivityLog({
      action: "patch_activate",
      details: JSON.stringify({
        title: `تم تسجيل العميل — ${patch.personName} بانتظار إنشاء الترخيص`,
        sections: [
          { label: "اسم الشخص", value: patch.personName },
          { label: "Hostname", value: hostname || "غير متوفر" },
          { label: "IP", value: serverHost },
          { label: "HWID (مع Salt)", value: hwid.substring(0, 32) + "...", mono: true },
          { label: "HWID Salt", value: hwidSalt, mono: true },
          { label: "الحالة", value: "تسجيل فقط — بانتظار إنشاء الترخيص من لوحة التحكم" },
        ],
      }),
    });

    res.json({
      success: true,
      message: "تم التسجيل بنجاح — بانتظار إنشاء الترخيص",
    });
  });

  // ─── Ephemeral Payload Pickup (Public - one-time GET, self-destructs) ────────
  app.use("/api/patch-payload/:eph", requireHttps);
  app.get("/api/patch-payload/:eph", (req, res) => {
    const ephId = String(req.params.eph);
    const entry = ephemeralPayloads.get(ephId);

    if (!entry || Date.now() > entry.expires) {
      ephemeralPayloads.delete(ephId);
      return res.status(410).send("gone");
    }

    ephemeralPayloads.delete(ephId);

    const rawBytes = Buffer.from(entry.payload, "base64");
    res.setHeader("Content-Type", "application/octet-stream");
    res.setHeader("Cache-Control", "no-store, no-cache");
    res.send(rawBytes);
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

  // ─── Heartbeat Monitor: Auto-suspend licenses with missed verifications ───
  const HEARTBEAT_CHECK_INTERVAL = 30 * 60 * 1000; // Check every 30 minutes
  const HEARTBEAT_TIMEOUT = 12 * 60 * 60 * 1000; // 12 hours = 2 missed verify cycles (6h each)

  setInterval(async () => {
    try {
      const allLicenses = await storage.getLicenses();
      const now = Date.now();

      for (const license of allLicenses) {
        if (license.status !== "active") continue;
        if (!license.lastVerifiedAt) continue;

        const timeSinceLastVerify = now - new Date(license.lastVerifiedAt).getTime();

        if (timeSinceLastVerify > HEARTBEAT_TIMEOUT) {
          await storage.updateLicense(license.id, { status: "suspended" });

          const hoursAgo = Math.round(timeSinceLastVerify / (60 * 60 * 1000));
          await storage.createActivityLog({
            licenseId: license.id,
            serverId: license.serverId,
            action: "heartbeat_timeout",
            details: JSON.stringify({
              title: `الترخيص ${license.licenseId} تم إيقافه تلقائياً - انقطاع التحقق`,
              sections: [
                { label: "معرف الترخيص", value: license.licenseId },
                { label: "آخر تحقق", value: new Date(license.lastVerifiedAt).toLocaleString("ar-IQ") },
                { label: "مدة الانقطاع", value: `${hoursAgo} ساعة` },
                { label: "الحد الأقصى المسموح", value: "12 ساعة (دورتين تحقق)" },
                { label: "السبب المحتمل", value: "الشخص حذف الخدمات من السيرفر أو السيرفر مطفي" },
                { label: "النتيجة", value: "تم إيقاف الترخيص تلقائياً - license-data يرجع st=0" },
                { label: "الإجراء", value: "يمكن إعادة تفعيله يدوياً من لوحة التحكم إذا لزم" },
                { label: "العميل", value: license.clientId || "غير محدد" },
              ],
            }),
          });
        }
      }
    } catch (err) {
      console.error("Heartbeat monitor error:", err);
    }
  }, HEARTBEAT_CHECK_INTERVAL);

  return httpServer;
}
