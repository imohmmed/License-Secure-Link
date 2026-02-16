# License Manager - نظام إدارة التراخيص

## Overview
A license management system that acts as an external server to manage licenses for internal servers via SSH connections. The system deploys license files locked to hardware IDs, manages license expiry, user limits, and site limits.

## Architecture
- **Frontend**: React + Vite + Tailwind CSS + shadcn/ui (RTL Arabic interface)
- **Backend**: Express.js with TypeScript
- **Database**: PostgreSQL with Drizzle ORM
- **SSH**: ssh2 library for remote server connections
- **Language**: Arabic (Iraqi dialect) UI

## Key Features
- License CRUD (create, activate, suspend, extend, transfer, delete)
- Server management with SSH credentials
- SSH connection testing with Hardware ID detection
- License deployment to remote servers via SSH
- Hardware ID locking (prevents license copying)
- Activity logging for all operations
- Dashboard with statistics overview

## Project Structure
```
client/src/
  pages/
    dashboard.tsx      - Main dashboard with stats
    licenses.tsx       - License management page
    servers.tsx        - Server management page  
    activity.tsx       - Activity log page
  components/
    app-sidebar.tsx    - Navigation sidebar (RTL)
    theme-toggle.tsx   - Dark/light mode toggle
  lib/
    theme-provider.tsx - Theme context provider

server/
  index.ts            - Express server entry
  routes.ts           - API routes
  storage.ts          - Database storage layer
  db.ts               - Database connection
  ssh-service.ts      - SSH connection and deployment logic
  seed.ts             - Seed data

shared/
  schema.ts           - Drizzle schemas (servers, licenses, activity_logs)
```

## Database Schema
- **servers**: SSH connection details (host, port, username, password, hardwareId)
- **licenses**: License records (licenseId, serverId, hardwareId, status, expiresAt, maxUsers, maxSites)
- **activity_logs**: Audit trail for all operations

## API Routes
- `GET/POST /api/servers` - List/create servers
- `PATCH/DELETE /api/servers/:id` - Update/delete server
- `POST /api/servers/:id/test` - Test SSH connection
- `GET/POST /api/licenses` - List/create licenses
- `PATCH /api/licenses/:id/status` - Update license status
- `POST /api/licenses/:id/extend` - Extend license duration
- `POST /api/licenses/:id/transfer` - Transfer to another server
- `POST /api/licenses/:id/deploy` - Deploy license file via SSH
- `DELETE /api/licenses/:id` - Delete license
- `GET /api/activity-logs` - Get activity logs
