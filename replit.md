# License Manager - نظام إدارة التراخيص

## Overview
A centralized license management system (License Authority) for SAS4 software. Uses XOR encryption (Gr3nd1z3r key pattern) compatible with SAS4 proxy logic, hardware ID locking, provisioning API, periodic verification, and SSH deployment of emulator scripts.

## Architecture
- **Frontend**: React + Vite + Tailwind CSS + shadcn/ui (RTL Arabic interface)
- **Backend**: Express.js with TypeScript
- **Database**: PostgreSQL with Drizzle ORM
- **SSH**: ssh2 library for remote server connections
- **Security**: SAS4 XOR encryption (Gr3nd1z3r{hour+1} key), HWID binding
- **Language**: Arabic (Iraqi dialect) UI

## Key Features
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

## Project Structure
```
client/src/
  pages/
    dashboard.tsx      - Main dashboard with stats
    licenses.tsx       - License management page (create, edit, deploy, provision)
    servers.tsx        - Server management page
    activity.tsx       - Activity log page
  components/
    app-sidebar.tsx    - Navigation sidebar (RTL)
    theme-toggle.tsx   - Dark/light mode toggle
  lib/
    theme-provider.tsx - Theme context provider

server/
  index.ts            - Express server entry
  routes.ts           - API routes (admin + public provisioning/verify)
  storage.ts          - Database storage layer
  db.ts               - Database connection
  ssh-service.ts      - SSH connection, obfuscated emulator/verify generation, deployment
  sas4-service.ts     - SAS4 XOR encryption/decryption service

shared/
  schema.ts           - Drizzle schemas (servers, licenses, activity_logs)
```

## Database Schema
- **servers**: SSH connection details (host, port, username, password, hardwareId)
- **licenses**: License records (licenseId, serverId, hardwareId, status, expiresAt, maxUsers, maxSites, signature, lastVerifiedAt)
- **activity_logs**: Audit trail for all operations

## API Routes

### Admin Routes (Dashboard UI)
- `GET/POST /api/servers` - List/create servers
- `PATCH/DELETE /api/servers/:id` - Update/delete server
- `POST /api/servers/:id/test` - Test SSH connection
- `GET/POST /api/licenses` - List/create licenses
- `PATCH /api/licenses/:id` - Edit license (maxUsers, maxSites, etc.)
- `PATCH /api/licenses/:id/status` - Update license status
- `POST /api/licenses/:id/extend` - Extend license duration
- `POST /api/licenses/:id/transfer` - Transfer to another server
- `POST /api/licenses/:id/deploy` - Deploy SAS4 emulator via SSH
- `DELETE /api/licenses/:id` - Delete license
- `GET /api/activity-logs` - Get activity logs
- `GET /api/stats` - Dashboard statistics

### Public API (Client Servers)
- `POST /api/provision` - Provision license (sends HWID, gets SAS4 encrypted blob)
- `POST /api/verify` - Periodic verification (sends license_id + HWID, checks status)
- `GET /api/license-blob/:licenseId` - Get XOR-encrypted SAS4 license blob
- `GET /api/provision-script/:licenseId` - Download SAS4 activator script

## SAS4 Encryption Model
- XOR encryption with time-based key: `Gr3nd1z3r{hour+1}`
- Payload format: {pid, hwid, exp, ftrs, st, mu, ms, id, hash}
- Encrypted payload is base64 encoded
- Emulator serves encrypted blob on port 4000 (localhost)
- SAS4 software queries `http://127.0.0.1:4000/?op=get`
- HWID captured from original sas_sspd binary or system fingerprint
- Hash generated with SHA256 from license+hwid+expiry

## Security & Obfuscation
- HWID bound on first provision, verified on every check
- Passwords masked in all API responses (********)
- Verification required - unprovisioned licenses cannot be verified
- Database is internal-only (Replit built-in PostgreSQL, no external exposure)
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

## Recent Changes (Feb 16, 2026)
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
- Removed seed.ts (no more test data)
