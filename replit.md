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
  ssh-service.ts      - SSH connection, emulator generation, deployment
  sas4-service.ts     - SAS4 XOR encryption/decryption service
  seed.ts             - Seed data

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

## Security
- HWID bound on first provision, verified on every check
- Passwords masked in all API responses (********)
- Verification required - unprovisioned licenses cannot be verified
- Systemd timer runs verification every 6 hours
- Failed verification stops the sas_systemmanager service

## Recent Changes (Feb 16, 2026)
- Replaced RSA digital signatures with SAS4 XOR encryption
- Updated provisioning to return SAS4-compatible encrypted blobs
- Updated provision script to deploy SAS4 emulator with systemd
- Added license-blob endpoint for direct encrypted blob access
- Removed RSA key pair system (.keys/ directory)
