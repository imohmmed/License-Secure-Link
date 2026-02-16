import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { testSSHConnection, deployLicenseToServer } from "./ssh-service";
import { insertServerSchema, insertLicenseSchema } from "@shared/schema";
import { signLicensePayload, buildLicensePayload, getPublicKey } from "./rsa-service";

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

    const payload = buildLicensePayload(
      license.licenseId,
      hardware_id,
      new Date(license.expiresAt),
      license.maxUsers,
      license.maxSites,
      "active"
    );

    const signature = signLicensePayload(payload);

    await storage.updateLicense(license.id, { signature });

    await storage.createActivityLog({
      licenseId: license.id,
      serverId: license.serverId,
      action: "provision_license",
      details: `تم تفعيل الترخيص ${license_id} على الجهاز ${hardware_id.substring(0, 16)}...`,
    });

    res.json({
      license: payload,
      signature,
      public_key: getPublicKey(),
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

    const payload = buildLicensePayload(
      license.licenseId,
      hardware_id,
      new Date(license.expiresAt),
      license.maxUsers,
      license.maxSites,
      license.status
    );

    const signature = signLicensePayload(payload);

    res.json({
      valid: true,
      status: "active",
      license: payload,
      signature,
    });
  });

  // ─── Public Key Endpoint ─────────────────────────────────
  app.get("/api/public-key", (_req, res) => {
    res.type("text/plain").send(getPublicKey());
  });

  // ─── Provision Script Download ───────────────────────────
  app.get("/api/provision-script/:licenseId", async (req, res) => {
    const license = await storage.getLicenseByLicenseId(req.params.licenseId);
    if (!license) return res.status(404).json({ message: "الترخيص غير موجود" });

    const serverHost = req.get("host") || "localhost:5000";
    const protocol = req.get("x-forwarded-proto") || req.protocol;
    const baseUrl = `${protocol === "https" ? "https" : (process.env.NODE_ENV === "production" ? "https" : "http")}://${serverHost}`;

    const script = `#!/bin/bash
# provision.sh - License Provisioning Script
# License ID: ${license.licenseId}
# Generated: $(date)

set -e

LICENSE_ID="${license.licenseId}"
SERVER_URL="${baseUrl}"
INSTALL_DIR="/opt/license"
VERIFY_INTERVAL=21600  # 6 hours in seconds

echo "======================================"
echo "  License Provisioning System"
echo "  License: $LICENSE_ID"
echo "======================================"

# Collect Hardware ID
echo "[1/5] Collecting hardware fingerprint..."
MACHINE_ID=$(cat /etc/machine-id 2>/dev/null || echo "")
PRODUCT_UUID=$(cat /sys/class/dmi/id/product_uuid 2>/dev/null || echo "")
MAC_ADDR=$(ip link show 2>/dev/null | grep -m1 'link/ether' | awk '{print $2}' || echo "")

HWID_RAW="\${MACHINE_ID}:\${PRODUCT_UUID}:\${MAC_ADDR}"
HARDWARE_ID=$(echo -n "$HWID_RAW" | sha256sum | awk '{print $1}')
echo "  Hardware ID: $HARDWARE_ID"

# Request license from server
echo "[2/5] Requesting license from server..."
RESPONSE=$(curl -s -X POST "$SERVER_URL/api/provision" \\
  -H "Content-Type: application/json" \\
  -d "{\\"license_id\\": \\"$LICENSE_ID\\", \\"hardware_id\\": \\"$HARDWARE_ID\\"}")

# Check for errors
if echo "$RESPONSE" | grep -q '"error"'; then
  ERROR=$(echo "$RESPONSE" | grep -o '"error":"[^"]*"' | cut -d'"' -f4)
  echo "ERROR: $ERROR"
  exit 1
fi

# Install license
echo "[3/5] Installing license..."
mkdir -p "$INSTALL_DIR"

echo "$RESPONSE" | python3 -c "
import sys, json
data = json.load(sys.stdin)
with open('$INSTALL_DIR/license.json', 'w') as f:
    json.dump(data['license'], f, indent=2)
with open('$INSTALL_DIR/license.sig', 'w') as f:
    f.write(data['signature'])
with open('$INSTALL_DIR/public.pem', 'w') as f:
    f.write(data['public_key'])
"

echo "  License installed to $INSTALL_DIR/"

# Create verification script
echo "[4/5] Setting up periodic verification..."
cat > "$INSTALL_DIR/verify.sh" << 'VERIFY_EOF'
#!/bin/bash
LICENSE_ID="${license.licenseId}"
SERVER_URL="${baseUrl}"

MACHINE_ID=$(cat /etc/machine-id 2>/dev/null || echo "")
PRODUCT_UUID=$(cat /sys/class/dmi/id/product_uuid 2>/dev/null || echo "")
MAC_ADDR=$(ip link show 2>/dev/null | grep -m1 'link/ether' | awk '{print $2}' || echo "")
HWID_RAW="\${MACHINE_ID}:\${PRODUCT_UUID}:\${MAC_ADDR}"
HARDWARE_ID=$(echo -n "$HWID_RAW" | sha256sum | awk '{print $1}')

RESULT=$(curl -s -X POST "$SERVER_URL/api/verify" \\
  -H "Content-Type: application/json" \\
  -d "{\\"license_id\\": \\"$LICENSE_ID\\", \\"hardware_id\\": \\"$HARDWARE_ID\\"}")

VALID=$(echo "$RESULT" | grep -o '"valid":true' || echo "")

if [ -z "$VALID" ]; then
  STATUS=$(echo "$RESULT" | grep -o '"status":"[^"]*"' | cut -d'"' -f4)
  echo "$(date): License verification FAILED - Status: $STATUS" >> /var/log/license-verify.log
  # Stop the protected service
  systemctl stop sas_systemmanager 2>/dev/null || true
  exit 1
else
  echo "$(date): License verification OK" >> /var/log/license-verify.log
fi
VERIFY_EOF
chmod +x "$INSTALL_DIR/verify.sh"

# Setup systemd timer for periodic verification
cat > /etc/systemd/system/license-verify.service << 'SVC_EOF'
[Unit]
Description=License Verification Service

[Service]
Type=oneshot
ExecStart=/opt/license/verify.sh
SVC_EOF

cat > /etc/systemd/system/license-verify.timer << 'TMR_EOF'
[Unit]
Description=License Verification Timer (every 6 hours)

[Timer]
OnBootSec=60
OnUnitActiveSec=6h
Persistent=true

[Install]
WantedBy=timers.target
TMR_EOF

systemctl daemon-reload
systemctl enable license-verify.timer
systemctl start license-verify.timer

echo "[5/5] Running initial verification..."
bash "$INSTALL_DIR/verify.sh"

echo ""
echo "======================================"
echo "  Provisioning Complete!"
echo "  License: $LICENSE_ID"
echo "  Hardware: $HARDWARE_ID"
echo "  Verify every 6 hours: ENABLED"
echo "======================================"
`;

    res.setHeader("Content-Type", "text/plain");
    res.setHeader("Content-Disposition", `attachment; filename="provision_${license.licenseId}.sh"`);
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
