#!/bin/bash
# SAS4 Activator - Official Proxy Logic
# ------------------------------------

BIN_DIR="/opt/sas4/bin"
SSPD_BIN="$BIN_DIR/sas_sspd"
SSPD_BAK="$BIN_DIR/sas_sspd.bak"
EMULATOR_PY="$BIN_DIR/sas_emulator.py"
SERVICE_FILE="/etc/systemd/system/sas_systemmanager.service"

if [ "$EUID" -ne 0 ]; then echo "Please run as root (sudo)"; exit 1; fi

# 1. Stop Services
systemctl stop sas_systemmanager 2>/dev/null
killall sas_sspd python3 2>/dev/null
sleep 1

# 2. Backup Binary
if [ ! -f "$SSPD_BAK" ]; then
    cp "$SSPD_BIN" "$SSPD_BAK" && chmod +x "$SSPD_BAK"
fi

# 3. Capture Real HWID (Using Official Method)
"$SSPD_BAK" > /dev/null 2>&1 &
PID=$!
sleep 5
BLOB=$(curl -s "http://127.0.0.1:4000/?op=get")
kill $PID 2>/dev/null

# 4. Decrypt HWID (Official XOR Logic)
HWID=$(python3 -c "
import base64, json, time
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

echo "Captured HWID: $HWID"

# 5. Generate Emulator (Strict Official Logic)
cat <<EOF > "$EMULATOR_PY"
import http.server, socketserver, json, time, base64

def get_current_key():
    # Official Logic: hour + 1
    current_hour = time.localtime().tm_hour
    return f"Gr3nd1z3r{current_hour + 1}"

def xor_crypt(data, key):
    k = key.encode()
    d = data.encode() if isinstance(data, str) else data
    return bytes(d[i] ^ k[i % len(k)] for i in range(len(d)))

class H(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        payload = {
            "pid": "100",
            "hwid": "$HWID",
            "exp": "2050-07-27 17:00:00",
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
            "mu": "10000000",
            "ms": "10000000",
            "id": "123456",
            "hash": "bypassed_by_antigravity"
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

# 6. Deploy Service
cat <<EOF > "$SERVICE_FILE"
[Unit]
Description=SAS4 System Manager Emulator
[Service]
ExecStart=/usr/bin/python3 $EMULATOR_PY
Restart=always
[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable sas_systemmanager
systemctl start sas_systemmanager
echo "Panel Active"

