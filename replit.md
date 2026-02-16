# License Manager - نظام إدارة التراخيص

## Overview
A centralized license management system (License Authority) that manages software licenses for client servers. Features RSA digital signature, hardware ID locking, HTTPS provisioning API, periodic verification, and SSH deployment.

## Architecture
- **Frontend**: React + Vite + Tailwind CSS + shadcn/ui (RTL Arabic interface)
- **Backend**: Express.js with TypeScript
- **Database**: PostgreSQL with Drizzle ORM
- **SSH**: ssh2 library for remote server connections
- **Security**: RSA 2048-bit digital signatures, HWID binding
- **Language**: Arabic (Iraqi dialect) UI

## Key Features
- License CRUD (create, activate, suspend, extend, transfer, delete, edit)
- RSA digital signature for licenses (Private Key server-side only)
- Provisioning API (client sends HWID → gets signed license + public key)
- Periodic verification API (client checks every 6 hours)
- Hardware ID locking (prevents license copying to other devices)
- Provision script generation/download for client servers
- Server management with SSH credentials (passwords masked in API)
- SSH connection testing with Hardware ID detection
- License deployment to remote servers via SSH
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
  ssh-service.ts      - SSH connection and deployment logic
  rsa-service.ts      - RSA key pair management and license signing
  seed.ts             - Seed data

shared/
  schema.ts           - Drizzle schemas (servers, licenses, activity_logs)

.keys/                - RSA key pair (auto-generated, gitignored)
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
- `POST /api/licenses/:id/deploy` - Deploy license file via SSH
- `DELETE /api/licenses/:id` - Delete license
- `GET /api/activity-logs` - Get activity logs
- `GET /api/stats` - Dashboard statistics

### Public API (Client Servers)
- `POST /api/provision` - Provision license (sends HWID, gets signed license + public key)
- `POST /api/verify` - Periodic verification (sends license_id + HWID, checks status)
- `GET /api/public-key` - Get RSA public key
- `GET /api/provision-script/:licenseId` - Download provision.sh script

## Security Model
- RSA 2048-bit key pair auto-generated on first run
- Private key stored server-side only (.keys/private.pem)
- Public key distributed to clients during provisioning
- License payload signed with SHA256+RSA
- HWID bound on first provision, verified on every check
- Passwords masked in all API responses (********)
- Verification required - unprovisioned licenses cannot be verified

## Recent Changes (Feb 16, 2026)
- Added RSA digital signature system
- Added provisioning and verification APIs
- Added provision.sh script generation
- Added license editing (maxUsers/maxSites)
- Added lastVerifiedAt tracking
- Fixed payload signing order (sign after status update)
- Enforced HWID binding on verify (must provision first)
