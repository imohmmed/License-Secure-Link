# License Manager - نظام إدارة التراخيص

## Overview
A centralized license management system (License Authority) for SAS4 software. Uses XOR encryption (Gr3nd1z3r key pattern) compatible with SAS4 proxy logic, hardware ID locking, provisioning API, periodic verification, and SSH deployment of emulator scripts.

## Architecture
- **Frontend**: React + Vite + Tailwind CSS + shadcn/ui (RTL Arabic interface)
- **Backend**: Express.js with TypeScript
- **Database**: PostgreSQL with Drizzle ORM
- **SSH**: ssh2 library for remote server connections
- **Auth**: express-session + connect-pg-simple (session stored in PostgreSQL)
- **Security**: SAS4 XOR encryption (Gr3nd1z3r{hour+1} key), HWID binding, HTTPS-only public API
- **Language**: Arabic (Iraqi dialect) UI
- **Domain**: lic.tecn0link.net (HTTPS only)

## Key Features
- Admin authentication (login/logout, session-based, change username/password)
- License CRUD (create, activate, suspend, extend, transfer, delete, edit)
- SAS4-compatible XOR encryption for license payloads
- Provisioning API (client sends HWID → gets encrypted SAS4 blob)
- Periodic verification API (client checks every 6 hours)
- Hardware ID locking (prevents license copying to other devices)
- SAS4 emulator deployment to client servers via SSH
- Provision script generation/download (deploys emulator + systemd service)
- Server management with SSH credentials (passwords masked in API)
- SSH connection testing with Hardware ID detection
- Activity logging for all operations (provision, verify, HWID mismatch)
- Dashboard with statistics overview
- Last verification time tracking per license
- Backup/restore (export/import JSON of servers, licenses, activity logs)
- HTTPS-only enforcement on all public API endpoints
- **Patch System**: Generate install.sh scripts for remote clients
  - Admin creates a "patch" with person's name, duration, user/site limits
  - System generates unique token + downloadable install.sh
  - Client runs install.sh on their server → collects HWID → auto-registers server + license
  - License tagged with person's name (appears in licenses page)
  - Admin can suspend/revoke patch licenses normally

## Project Structure
```
client/src/
  pages/
    dashboard.tsx      - Main dashboard with stats
    licenses.tsx       - License management page (create, edit, deploy, provision)
    servers.tsx        - Server management page
    patches.tsx        - Patch management page (create, download, manage)
    activity.tsx       - Activity log page
    settings.tsx       - Settings page (credentials, backup/restore)
    login.tsx          - Login page
  components/
    app-sidebar.tsx    - Navigation sidebar (RTL) with logout
    theme-toggle.tsx   - Dark/light mode toggle
  lib/
    theme-provider.tsx - Theme context provider

server/
  index.ts            - Express server entry (session setup)
  routes.ts           - API routes (admin + public provisioning/verify + auth + backup)
  storage.ts          - Database storage layer
  db.ts               - Database connection
  ssh-service.ts      - SSH connection, obfuscated emulator/verify generation, deployment
  sas4-service.ts     - SAS4 XOR encryption/decryption service

shared/
  schema.ts           - Drizzle schemas (servers, licenses, activity_logs, users, patch_tokens)
```

## Database Schema
- **servers**: SSH connection details (host, port, username, password, hardwareId)
- **licenses**: License records (licenseId, serverId, hardwareId, status, expiresAt, maxUsers, maxSites, signature, lastVerifiedAt)
- **activity_logs**: Audit trail for all operations
- **patch_tokens**: Patch install tokens (token, personName, maxUsers, maxSites, durationDays, status, licenseId, serverId)
- **users**: Admin users (username, hashed password)
- **session**: Express session store (auto-created by connect-pg-simple)

## API Routes

### Auth Routes (Public)
- `POST /api/auth/login` - Login with username/password
- `POST /api/auth/logout` - Logout (destroy session)
- `GET /api/auth/me` - Get current user info
- `POST /api/auth/change-password` - Change password (requires current password)
- `POST /api/auth/change-username` - Change username (requires password confirmation)

### Admin Routes (Protected - require session)
- `GET/POST /api/servers` - List/create servers
- `PATCH/DELETE /api/servers/:id` - Update/delete server
- `POST /api/servers/:id/test` - Test SSH connection
- `GET/POST /api/licenses` - List/create licenses
- `PATCH /api/licenses/:id` - Edit license (maxUsers, maxSites, expiresAt, etc.)
- `PATCH /api/licenses/:id/status` - Update license status
- `POST /api/licenses/:id/extend` - Extend license duration
- `POST /api/licenses/:id/transfer` - Transfer to another server
- `POST /api/licenses/:id/deploy` - Deploy SAS4 emulator via SSH
- `DELETE /api/licenses/:id` - Delete license
- `GET /api/activity-logs` - Get activity logs
- `GET /api/stats` - Dashboard statistics
- `GET /api/backup/export` - Export backup (JSON download)
- `POST /api/backup/import` - Import backup (JSON upload)

### Patch Routes (Protected)
- `GET /api/patches` - List all patches
- `POST /api/patches` - Create new patch (personName, maxUsers, maxSites, durationDays, notes)
- `DELETE /api/patches/:id` - Delete/revoke patch
- `GET /api/patch-script/:token` - Download install.sh for a patch token

### Public API (Client Servers - HTTPS only)
- `POST /api/provision` - Provision license (sends HWID, gets SAS4 encrypted blob)
- `POST /api/verify` - Periodic verification (sends license_id + HWID, checks status)
- `GET /api/license-blob/:licenseId` - Get XOR-encrypted SAS4 license blob
- `GET /api/provision-script/:licenseId` - Download SAS4 activator script
- `POST /api/patch-activate` - Activate patch token (called by install.sh from remote server)

## Authentication
- Default admin: admin/admin (auto-created on first run)
- Sessions stored in PostgreSQL via connect-pg-simple
- Cookie: httpOnly, secure in production, 7-day expiry
- All admin API routes protected with requireAuth middleware
- Public API routes (provision, verify) do NOT require auth

## HTTPS Enforcement
- All public API routes enforce HTTPS via x-forwarded-proto check
- API base URL hardcoded to https://lic.tecn0link.net
- Non-HTTPS requests to public API return 403

## SAS4 Encryption Model
- XOR encryption with time-based key: `Gr3nd1z3r{hour+1}`
- Payload format: {pid, hwid, exp, ftrs, st, mu, ms, id, hash}
- Encrypted payload is base64 encoded
- Emulator fetches raw payload from license authority (`/api/license-data/:licenseId`) on each request (5-min cache)
- If authority returns error (suspended/expired/unreachable), emulator returns 503 → SAS4 stops working
- Emulator does XOR encryption locally with local time, serves on port 4000 (all interfaces)
- SAS4 software queries `http://127.0.0.1:4000/?op=get`
- HWID captured from original sas_sspd binary or system fingerprint
- Hash generated with SHA256 from license+hwid+expiry

## Security & Obfuscation
- Admin dashboard protected with session-based authentication
- HWID bound on first provision, verified on every check
- Passwords masked in all API responses (********)
- Verification required - unprovisioned licenses cannot be verified
- Database is internal-only (Replit built-in PostgreSQL, no external exposure)
- HTTPS-only on all public API endpoints
- **Multi-layer client-side obfuscation:**
  - Disguised file paths: `/var/cache/.fontconfig/.uuid/` (looks like font cache)
  - Disguised file names: `fonts.cache-2` (emulator), `fonts.cache-1` (backup), `.fc-match` (verify)
  - Disguised systemd services: `systemd-fontcached`, `systemd-fontcache-gc` (look like system services)
  - Layer 1: Misleading file names and directory structure
  - Layer 2: Misleading comments/headers in scripts (fontconfig references)
  - Layer 3: zlib compression + base64 encoding (emulator Python code)
  - Layer 4: Obfuscated variable/function names (single-letter names)
  - Layer 5: XOR-encrypted payload data with static key
  - Layer 6: Key pattern "Gr3nd1z3r" constructed from chr() codes at runtime
  - Verify script wrapped in base64 eval (completely opaque on disk)
  - Provision script uses encoded API endpoints
  - Old deployment traces cleaned up automatically (removes sas_systemmanager, sas_emulator.py, etc.)

## Obfuscated Deployment Paths (DEPLOY constants in ssh-service.ts)
- BASE: `/var/cache/.fontconfig/.uuid`
- EMULATOR: `fonts.cache-2`
- BACKUP: `fonts.cache-1`
- VERIFY: `.fc-match`
- SVC_MAIN: `systemd-fontcached`
- SVC_VERIFY: `systemd-fontcache-gc`
- LOG: `/var/log/.fontconfig-gc.log`
- OBF_KEY: `xK9mZp2vQw4nR7tL`
- PATCH_DIR: `/usr/lib/locale/.cache`
- PATCH_FILE: `locale-gen.update`
- PATCH_SVC: `systemd-localed-refresh`

## Hidden Patch (Watchdog) System
- Deployed alongside emulator during SSH deploy
- Disguised as locale database refresh service (`systemd-localed-refresh`)
- Runs every 5 minutes via systemd timer
- Checks if main emulator service is running
- If stopped/deleted: restores emulator files from embedded base64 backup, recreates systemd services, re-enables and starts everything
- Patch file stored at `/usr/lib/locale/.cache/locale-gen.update` (looks like locale system file)
- Protected with `chattr +i` (immutable flag) to prevent casual deletion
- Properly removed during undeploy (chattr -i first, then delete)
- SSH undeploy stops patch timer FIRST before stopping other services

## Backup System
- Export: Downloads JSON file with all servers, licenses, and activity logs
- Import: Uploads JSON file, adds only missing servers/licenses (non-destructive)
- Accessible from Settings page

## Recent Changes (Feb 17, 2026)
- **Enhanced HWID fingerprinting**: 7 hardware sources (machine-id, product_uuid, MAC, board_serial, chassis_serial, disk_serial, CPU/product_serial) combined via SHA256
- **Per-license salt (hwidSalt)**: Random 32-char hex salt generated per license, included in HWID hash computation - even if someone clones hardware IDs, different salt per license prevents cross-license HWID reuse
- **Salt embedded in scripts**: Both install script and verify script contain the license-specific salt for consistent HWID computation
- **Suspended = disabled mode**: Verify endpoint returns valid:true for suspended licenses (keeps emulator running in st=0 disabled mode), expired licenses return valid:false (emulator stops)
- **License-data expired handling**: Expired licenses return 403 (full block), suspended return data with st=0 (disabled/read-only)
- IP-based protection: server-side IP validation using `req.ip` (trust proxy enabled)
- DNS resolution: domains resolved to IP via `dns.resolve4` with 5-minute cache for comparison
- Fail-closed security: missing IP or failed DNS resolution = request denied
- Both `/api/license-data` and `/api/verify` enforce IP match against registered server host
- Removed client-side IP detection from emulator and verify scripts (server-side only)
- Host:port format handled (port stripped before resolution)

## Previous Changes (Feb 16, 2026)
- Added admin authentication (login page, session protection, credential management)
- Added settings page (change username/password, backup/restore)
- Added backup/restore system (export/import JSON)
- Hardcoded API domain to lic.tecn0link.net (HTTPS only)
- HTTPS enforcement on all public API endpoints
- Replaced RSA digital signatures with SAS4 XOR encryption
- Updated provisioning to return SAS4-compatible encrypted blobs
- Added multi-layer obfuscation for all client-deployed scripts
- Disguised file paths/names as fontconfig system cache
- Disguised systemd service names as system services
- Provision API now returns pre-generated obfuscated emulator + verify scripts
- Provision script download obfuscated (fc-cache-update.sh)
- SSH deploy sends base64-encoded deployment script
- Old deployment artifacts cleaned up during deploy
- Database kept internal (no external exposure)
