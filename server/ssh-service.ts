import { Client } from "ssh2";
import crypto from "crypto";

export interface SSHConnectionResult {
  connected: boolean;
  hardwareId?: string;
  error?: string;
}

export async function testSSHConnection(
  host: string,
  port: number,
  username: string,
  password: string
): Promise<SSHConnectionResult> {
  return new Promise((resolve) => {
    const conn = new Client();
    const timeout = setTimeout(() => {
      conn.end();
      resolve({ connected: false, error: "انتهت مهلة الاتصال" });
    }, 15000);

    conn.on("ready", () => {
      conn.exec(
        "cat /sys/class/dmi/id/product_uuid 2>/dev/null || cat /etc/machine-id 2>/dev/null || hostname",
        (err, stream) => {
          if (err) {
            clearTimeout(timeout);
            conn.end();
            resolve({ connected: true, hardwareId: undefined, error: undefined });
            return;
          }

          let output = "";
          stream.on("data", (data: Buffer) => {
            output += data.toString();
          });
          stream.on("close", () => {
            clearTimeout(timeout);
            const hwid = output.trim() || undefined;
            conn.end();
            resolve({ connected: true, hardwareId: hwid });
          });
        }
      );
    });

    conn.on("error", (err: Error) => {
      clearTimeout(timeout);
      resolve({ connected: false, error: err.message });
    });

    conn.connect({ host, port, username, password, readyTimeout: 10000 });
  });
}

export async function executeSSHCommand(
  host: string,
  port: number,
  username: string,
  password: string,
  command: string
): Promise<{ success: boolean; output?: string; error?: string }> {
  return new Promise((resolve) => {
    const conn = new Client();
    const timeout = setTimeout(() => {
      conn.end();
      resolve({ success: false, error: "انتهت مهلة الاتصال" });
    }, 30000);

    conn.on("ready", () => {
      conn.exec(command, (err, stream) => {
        if (err) {
          clearTimeout(timeout);
          conn.end();
          resolve({ success: false, error: err.message });
          return;
        }

        let output = "";
        let errorOutput = "";
        stream.on("data", (data: Buffer) => {
          output += data.toString();
        });
        stream.stderr.on("data", (data: Buffer) => {
          errorOutput += data.toString();
        });
        stream.on("close", (code: number) => {
          clearTimeout(timeout);
          conn.end();
          resolve({
            success: code === 0,
            output: output.trim(),
            error: errorOutput.trim() || undefined,
          });
        });
      });
    });

    conn.on("error", (err: Error) => {
      clearTimeout(timeout);
      resolve({ success: false, error: err.message });
    });

    conn.connect({ host, port, username, password, readyTimeout: 10000 });
  });
}

export function generateLicenseFileContent(
  licenseId: string,
  hardwareId: string,
  expiresAt: Date,
  maxUsers: number,
  maxSites: number,
  status: string
): string {
  const payload = {
    pid: licenseId,
    hwid: hardwareId,
    exp: expiresAt.toISOString().replace("T", " ").substring(0, 19),
    st: status === "active" ? "1" : "0",
    mu: maxUsers.toString(),
    ms: maxSites.toString(),
    id: licenseId,
    hash: crypto.createHash("sha256").update(`${licenseId}:${hardwareId}:${expiresAt.toISOString()}`).digest("hex"),
    ftrs: [
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
  };

  return JSON.stringify(payload, null, 2);
}

export function generateEmulatorScript(
  hardwareId: string,
  licenseId: string,
  expiresAt: Date,
  maxUsers: number,
  maxSites: number,
  status: string
): string {
  const expStr = expiresAt.toISOString().replace("T", " ").substring(0, 19);
  const hash = crypto.createHash("sha256").update(`${licenseId}:${hardwareId}:${expiresAt.toISOString()}`).digest("hex");

  return `#!/usr/bin/env python3
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
            "pid": "${licenseId}",
            "hwid": "${hardwareId}",
            "exp": "${expStr}",
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
            "st": "${ status === "active" ? "1" : "0" }",
            "mu": "${maxUsers}",
            "ms": "${maxSites}",
            "id": "${licenseId}",
            "hash": "${hash}"
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
`;
}

export async function deployLicenseToServer(
  host: string,
  port: number,
  username: string,
  password: string,
  hardwareId: string,
  licenseId: string,
  expiresAt: Date,
  maxUsers: number,
  maxSites: number,
  status: string
): Promise<{ success: boolean; error?: string }> {
  const emulatorScript = generateEmulatorScript(hardwareId, licenseId, expiresAt, maxUsers, maxSites, status);

  const commands = [
    `systemctl stop sas_systemmanager 2>/dev/null; killall sas_sspd python3 2>/dev/null; sleep 1`,
    `mkdir -p /opt/sas4/bin`,
    `if [ -f /opt/sas4/bin/sas_sspd ] && [ ! -f /opt/sas4/bin/sas_sspd.bak ]; then cp /opt/sas4/bin/sas_sspd /opt/sas4/bin/sas_sspd.bak && chmod +x /opt/sas4/bin/sas_sspd.bak; fi`,
    `cat > /opt/sas4/bin/sas_emulator.py << 'EMULATOR_EOF'
${emulatorScript}
EMULATOR_EOF`,
    `chmod +x /opt/sas4/bin/sas_emulator.py`,
    `cat > /etc/systemd/system/sas_systemmanager.service << 'SERVICE_EOF'
[Unit]
Description=SAS4 System Manager Emulator
[Service]
ExecStart=/usr/bin/python3 /opt/sas4/bin/sas_emulator.py
Restart=always
[Install]
WantedBy=multi-user.target
SERVICE_EOF`,
    `systemctl daemon-reload`,
    `systemctl enable sas_systemmanager`,
    `systemctl start sas_systemmanager`,
  ];

  const fullCommand = commands.join(" && ");
  return executeSSHCommand(host, port, username, password, fullCommand);
}
