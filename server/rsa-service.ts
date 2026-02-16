import crypto from "crypto";
import fs from "fs";
import path from "path";

const KEY_DIR = path.join(process.cwd(), ".keys");
const PRIVATE_KEY_PATH = path.join(KEY_DIR, "private.pem");
const PUBLIC_KEY_PATH = path.join(KEY_DIR, "public.pem");

let cachedPrivateKey: string | null = null;
let cachedPublicKey: string | null = null;

function ensureKeyPair(): void {
  if (!fs.existsSync(KEY_DIR)) {
    fs.mkdirSync(KEY_DIR, { recursive: true });
  }

  if (!fs.existsSync(PRIVATE_KEY_PATH) || !fs.existsSync(PUBLIC_KEY_PATH)) {
    const { privateKey, publicKey } = crypto.generateKeyPairSync("rsa", {
      modulusLength: 2048,
      publicKeyEncoding: { type: "spki", format: "pem" },
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
    });

    fs.writeFileSync(PRIVATE_KEY_PATH, privateKey, { mode: 0o600 });
    fs.writeFileSync(PUBLIC_KEY_PATH, publicKey, { mode: 0o644 });

    cachedPrivateKey = privateKey;
    cachedPublicKey = publicKey;
    console.log("RSA key pair generated successfully");
  }
}

export function getPrivateKey(): string {
  if (cachedPrivateKey) return cachedPrivateKey;
  ensureKeyPair();
  cachedPrivateKey = fs.readFileSync(PRIVATE_KEY_PATH, "utf-8");
  return cachedPrivateKey;
}

export function getPublicKey(): string {
  if (cachedPublicKey) return cachedPublicKey;
  ensureKeyPair();
  cachedPublicKey = fs.readFileSync(PUBLIC_KEY_PATH, "utf-8");
  return cachedPublicKey;
}

export interface LicensePayload {
  license_id: string;
  hardware_id: string;
  expires_at: string;
  max_users: number;
  max_sites: number;
  status: string;
  issued_at: string;
}

export function signLicensePayload(payload: LicensePayload): string {
  const privateKey = getPrivateKey();
  const data = JSON.stringify(payload);
  const sign = crypto.createSign("SHA256");
  sign.update(data);
  sign.end();
  return sign.sign(privateKey, "base64");
}

export function verifyLicenseSignature(payload: LicensePayload, signature: string): boolean {
  const publicKey = getPublicKey();
  const data = JSON.stringify(payload);
  const verify = crypto.createVerify("SHA256");
  verify.update(data);
  verify.end();
  return verify.verify(publicKey, signature, "base64");
}

export function buildLicensePayload(
  licenseId: string,
  hardwareId: string,
  expiresAt: Date,
  maxUsers: number,
  maxSites: number,
  status: string
): LicensePayload {
  return {
    license_id: licenseId,
    hardware_id: hardwareId,
    expires_at: expiresAt.toISOString(),
    max_users: maxUsers,
    max_sites: maxSites,
    status,
    issued_at: new Date().toISOString(),
  };
}

ensureKeyPair();
