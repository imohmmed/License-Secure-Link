import crypto from "crypto";

const SAS4_FEATURES = [
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

function getCurrentKey(): string {
  const hour = new Date().getHours();
  return `Gr3nd1z3r${hour + 1}`;
}

function xorCrypt(data: Buffer, key: string): Buffer {
  const keyBytes = Buffer.from(key, "utf-8");
  const result = Buffer.alloc(data.length);
  for (let i = 0; i < data.length; i++) {
    result[i] = data[i] ^ keyBytes[i % keyBytes.length];
  }
  return result;
}

export interface SAS4Payload {
  pid: string;
  hwid: string;
  exp: string;
  ftrs: string[];
  st: string;
  mu: string;
  ms: string;
  id: string;
  hash: string;
}

export function buildSAS4Payload(
  licenseId: string,
  hardwareId: string,
  expiresAt: Date,
  maxUsers: number,
  maxSites: number,
  status: string
): SAS4Payload {
  const expStr = expiresAt.toISOString().replace("T", " ").substring(0, 19);
  const hash = crypto.createHash("sha256")
    .update(`${licenseId}:${hardwareId}:${expiresAt.toISOString()}`)
    .digest("hex");

  return {
    pid: licenseId,
    hwid: hardwareId,
    exp: expStr,
    ftrs: SAS4_FEATURES,
    st: status === "active" ? "1" : "0",
    mu: "10000000",
    ms: "10000000",
    id: licenseId,
    hash,
  };
}

export function encryptSAS4Payload(payload: SAS4Payload): string {
  const key = getCurrentKey();
  const jsonData = Buffer.from(JSON.stringify(payload), "utf-8");
  const encrypted = xorCrypt(jsonData, key);
  return encrypted.toString("base64");
}

export function decryptSAS4Blob(blob: string, keyOverride?: string): SAS4Payload | null {
  const key = keyOverride || getCurrentKey();
  try {
    const encrypted = Buffer.from(blob, "base64");
    const decrypted = xorCrypt(encrypted, key);
    const parsed = JSON.parse(decrypted.toString("utf-8"));
    if (parsed.hwid) return parsed as SAS4Payload;
    return null;
  } catch {
    return null;
  }
}

export function tryDecryptAllKeys(blob: string): SAS4Payload | null {
  for (let h = 0; h < 24; h++) {
    const key = `Gr3nd1z3r${h}`;
    const result = decryptSAS4Blob(blob, key);
    if (result) return result;
  }
  return null;
}
