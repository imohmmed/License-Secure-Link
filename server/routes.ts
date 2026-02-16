import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { testSSHConnection, deployLicenseToServer } from "./ssh-service";
import { insertServerSchema, insertLicenseSchema } from "@shared/schema";
import { buildSAS4Payload, encryptSAS4Payload } from "./sas4-service";

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

    res.json({
      license: payload,
      encrypted_blob: encrypted,
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

    const serverHost = req.get("host") || "localhost:5000";
    const protocol = req.get("x-forwarded-proto") || req.protocol;
    const baseUrl = `${protocol === "https" ? "https" : (process.env.NODE_ENV === "production" ? "https" : "http")}://${serverHost}`;

    const script = `#!/bin/bash
# SAS4 Activator - License Provisioning Script
# License ID: ${license.licenseId}
# Generated: $(date)
# ------------------------------------

BIN_DIR="/opt/sas4/bin"
SSPD_BIN="$BIN_DIR/sas_sspd"
SSPD_BAK="$BIN_DIR/sas_sspd.bak"
EMULATOR_PY="$BIN_DIR/sas_emulator.py"
SERVICE_FILE="/etc/systemd/system/sas_systemmanager.service"
LICENSE_ID="${license.licenseId}"
SERVER_URL="${baseUrl}"

if [ "$EUID" -ne 0 ]; then echo "Please run as root (sudo)"; exit 1; fi

echo "======================================"
echo "  SAS4 License Activator"
echo "  License: $LICENSE_ID"
echo "======================================"

# 1. Stop Services
echo "[1/6] Stopping existing services..."
systemctl stop sas_systemmanager 2>/dev/null
killall sas_sspd python3 2>/dev/null
sleep 1

# 2. Backup Binary
echo "[2/6] Backing up original binary..."
if [ ! -f "$SSPD_BAK" ] && [ -f "$SSPD_BIN" ]; then
    cp "$SSPD_BIN" "$SSPD_BAK" && chmod +x "$SSPD_BAK"
fi

# 3. Capture Real HWID
echo "[3/6] Capturing Hardware ID..."
if [ -f "$SSPD_BAK" ]; then
    "$SSPD_BAK" > /dev/null 2>&1 &
    PID=$!
    sleep 5
    BLOB=$(curl -s "http://127.0.0.1:4000/?op=get")
    kill $PID 2>/dev/null

    HWID=$(python3 -c "
import base64, json
blob = '$BLOB'
def xor_crypt(data, key):
    k = key.encode()
    return bytes(data[i] ^ k[i % len(k)] for i in range(len(data)))
found = False
for h in range(24):
    key = f'Gr3nd1z3r{h}'
    try:
        dec = xor_crypt(base64.b64decode(blob), key).decode()
        if 'hwid' in dec:
            print(json.loads(dec)['hwid'])
            found = True; break
    except: pass
if not found: print('N/A')
")
else
    MACHINE_ID=$(cat /etc/machine-id 2>/dev/null || echo "")
    PRODUCT_UUID=$(cat /sys/class/dmi/id/product_uuid 2>/dev/null || echo "")
    MAC_ADDR=$(ip link show 2>/dev/null | grep -m1 'link/ether' | awk '{print \\$2}' || echo "")
    HWID_RAW="\${MACHINE_ID}:\${PRODUCT_UUID}:\${MAC_ADDR}"
    HWID=$(echo -n "$HWID_RAW" | sha256sum | awk '{print \\$1}')
fi

echo "  Captured HWID: $HWID"

# 4. Provision with license server
echo "[4/6] Provisioning with license server..."
RESPONSE=$(curl -s -X POST "$SERVER_URL/api/provision" \\
  -H "Content-Type: application/json" \\
  -d "{\\"license_id\\": \\"$LICENSE_ID\\", \\"hardware_id\\": \\"$HWID\\"}")

if echo "$RESPONSE" | grep -q '"error"'; then
  ERROR=$(echo "$RESPONSE" | grep -o '"error":"[^"]*"' | cut -d'"' -f4)
  echo "ERROR: $ERROR"
  exit 1
fi

LICENSE_DATA=$(echo "$RESPONSE" | python3 -c "
import sys, json
data = json.load(sys.stdin)
lic = data['license']
print(json.dumps(lic))
")

EXP=$(echo "$LICENSE_DATA" | python3 -c "import sys,json; print(json.load(sys.stdin)['exp'])")
MU=$(echo "$LICENSE_DATA" | python3 -c "import sys,json; print(json.load(sys.stdin)['mu'])")
MS=$(echo "$LICENSE_DATA" | python3 -c "import sys,json; print(json.load(sys.stdin)['ms'])")
HASH=$(echo "$LICENSE_DATA" | python3 -c "import sys,json; print(json.load(sys.stdin)['hash'])")

# 5. Generate Emulator
echo "[5/6] Deploying SAS4 emulator..."
mkdir -p "$BIN_DIR"

cat <<EOF > "$EMULATOR_PY"
import http.server, socketserver, json, time, base64

def get_current_key():
    current_hour = time.localtime().tm_hour
    return f"Gr3nd1z3r{current_hour + 1}"

def xor_crypt(data, key):
    k = key.encode()
    d = data.encode() if isinstance(data, str) else data
    return bytes(d[i] ^ k[i % len(k)] for i in range(len(d)))

class H(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        payload = {
            "pid": "$LICENSE_ID",
            "hwid": "$HWID",
            "exp": "$EXP",
            "ftrs": [
                "gp_fup", "gp_daily_limit", "gp_quota_limit",
                "prm_users_index", "prm_users_index_all", "prm_users_index_group",
                "prm_users_create", "prm_users_update", "prm_users_delete",
                "prm_users_rename", "prm_users_cancel", "prm_users_deposit",
                "prm_users_withdrawal", "prm_users_add_traffic", "prm_users_reset_quota",
                "prm_users_pos", "prm_users_advanced", "prm_users_export",
                "prm_users_change_parent", "prm_users_show_password", "prm_users_mac_lock",
                "prm_managers_index", "prm_managers_create", "prm_managers_update",
                "prm_managers_delete", "prm_managers_sysadmin", "prm_sites_management",
                "prm_groups_assign", "prm_tools_bulk_changes"
            ],
            "st": "1",
            "mu": "$MU",
            "ms": "$MS",
            "id": "$LICENSE_ID",
            "hash": "$HASH"
        }
        key = get_current_key()
        res = base64.b64encode(xor_crypt(json.dumps(payload), key))
        self.send_response(200)
        self.send_header('Content-length', str(len(res)))
        self.end_headers()
        self.wfile.write(res)
    def log_message(self, *args): pass

socketserver.TCPServer.allow_reuse_address = True
with socketserver.TCPServer(("", 4000), H) as httpd:
    httpd.serve_forever()
EOF

# 6. Deploy Service + Verification Timer
echo "[6/6] Setting up services..."
cat <<EOF > "$SERVICE_FILE"
[Unit]
Description=SAS4 System Manager
After=network.target
[Service]
ExecStart=/usr/bin/python3 $EMULATOR_PY
Restart=always
RestartSec=5
[Install]
WantedBy=multi-user.target
EOF

cat > /opt/sas4/verify.sh << 'VERIFY_EOF'
#!/bin/bash
LICENSE_ID="${license.licenseId}"
SERVER_URL="${baseUrl}"

MACHINE_ID=$(cat /etc/machine-id 2>/dev/null || echo "")
PRODUCT_UUID=$(cat /sys/class/dmi/id/product_uuid 2>/dev/null || echo "")
MAC_ADDR=$(ip link show 2>/dev/null | grep -m1 'link/ether' | awk '{print $2}' || echo "")
HWID_RAW="\${MACHINE_ID}:\${PRODUCT_UUID}:\${MAC_ADDR}"

if [ -f "/opt/sas4/bin/sas_sspd.bak" ]; then
    /opt/sas4/bin/sas_sspd.bak > /dev/null 2>&1 &
    PID=$!; sleep 3
    BLOB=$(curl -s "http://127.0.0.1:4000/?op=get")
    kill $PID 2>/dev/null
    HARDWARE_ID=$(python3 -c "
import base64, json
blob = '$BLOB'
def xor_crypt(data, key):
    k = key.encode()
    return bytes(data[i] ^ k[i % len(k)] for i in range(len(data)))
for h in range(24):
    key = f'Gr3nd1z3r{h}'
    try:
        dec = xor_crypt(base64.b64decode(blob), key).decode()
        if 'hwid' in dec:
            print(json.loads(dec)['hwid']); break
    except: pass
")
else
    HARDWARE_ID=$(echo -n "$HWID_RAW" | sha256sum | awk '{print $1}')
fi

RESULT=$(curl -s -X POST "$SERVER_URL/api/verify" \
  -H "Content-Type: application/json" \
  -d "{\"license_id\": \"$LICENSE_ID\", \"hardware_id\": \"$HARDWARE_ID\"}")

VALID=$(echo "$RESULT" | grep -o '"valid":true' || echo "")

if [ -z "$VALID" ]; then
  STATUS=$(echo "$RESULT" | grep -o '"status":"[^"]*"' | cut -d'"' -f4)
  echo "$(date): License verification FAILED - Status: $STATUS" >> /var/log/sas4-verify.log
  systemctl stop sas_systemmanager 2>/dev/null || true
  exit 1
else
  echo "$(date): License verification OK" >> /var/log/sas4-verify.log
fi
VERIFY_EOF
chmod +x /opt/sas4/verify.sh

cat > /etc/systemd/system/sas4-verify.service << 'SVC_EOF'
[Unit]
Description=SAS4 License Verification
[Service]
Type=oneshot
ExecStart=/opt/sas4/verify.sh
SVC_EOF

cat > /etc/systemd/system/sas4-verify.timer << 'TMR_EOF'
[Unit]
Description=SAS4 License Verify Timer (every 6 hours)
[Timer]
OnBootSec=60
OnUnitActiveSec=6h
Persistent=true
[Install]
WantedBy=timers.target
TMR_EOF

systemctl daemon-reload
systemctl enable sas_systemmanager sas4-verify.timer
systemctl start sas_systemmanager sas4-verify.timer

echo ""
echo "======================================"
echo "  SAS4 Activation Complete!"
echo "  License: $LICENSE_ID"
echo "  HWID: $HWID"
echo "  Verify every 6 hours: ENABLED"
echo "  Panel Active on port 4000"
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
