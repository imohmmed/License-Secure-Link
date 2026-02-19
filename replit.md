# Overview

License Manager (نظام إدارة التراخيص) is a full-stack web application for managing software licenses and servers via SSH. It provides a dashboard for creating, deploying, and monitoring licenses tied to remote servers using Hardware ID (HWID) binding. The system supports license lifecycle management (activation, suspension, expiration), SSH-based deployment of license verification scripts to remote servers, patch token management, and activity logging.

The UI is in Arabic (RTL layout) with an admin panel that includes pages for dashboard stats, license management, server management, patch management, activity logs, and settings.

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend
- **Framework**: React 18 with TypeScript
- **Bundler**: Vite with HMR support
- **Routing**: Wouter (lightweight client-side router)
- **State Management**: TanStack React Query for server state, local React state for UI
- **UI Components**: shadcn/ui (new-york style) built on Radix UI primitives
- **Styling**: Tailwind CSS with CSS variables for theming (light/dark mode support)
- **Directory**: `client/src/` with pages, components, hooks, and lib folders
- **Path aliases**: `@/` maps to `client/src/`, `@shared/` maps to `shared/`

### Backend
- **Runtime**: Node.js with Express
- **Language**: TypeScript, executed via `tsx` in dev, compiled with esbuild for production
- **Session Management**: `express-session` with `connect-pg-simple` storing sessions in PostgreSQL
- **Authentication**: Custom session-based auth with bcryptjs password hashing. A default admin user is created automatically on first run
- **API Pattern**: RESTful JSON API under `/api/` routes with middleware for auth (`requireAuth`) and HTTPS enforcement (`requireHttps`)
- **SSH Operations**: Uses the `ssh2` library to connect to remote servers, retrieve hardware IDs, and deploy/undeploy license verification scripts
- **Build**: Production build uses esbuild to bundle the server into `dist/index.cjs`, Vite builds the client into `dist/public/`

### Shared Code
- **Location**: `shared/schema.ts`
- **Purpose**: Contains Drizzle ORM table definitions and Zod validation schemas (via `drizzle-zod`) shared between client and server

### Database
- **Database**: PostgreSQL (required, connected via `DATABASE_URL` environment variable)
- **ORM**: Drizzle ORM with `drizzle-kit` for migrations
- **Schema push**: `npm run db:push` uses `drizzle-kit push` to sync schema to database
- **Tables**:
  - `servers` — Remote server connection details (host, port, SSH credentials, hardware ID, connection status)
  - `licenses` — License records with license ID, HWID binding, expiration, status (active/inactive/suspended/expired/disabled), max users/sites
  - `activity_logs` — Audit trail of all license and server actions
  - `users` — Admin user accounts with hashed passwords
  - `patch_tokens` — Patch deployment tokens with fingerprinting and status tracking
- **Session table**: Auto-created by `connect-pg-simple`

### Key Services
- **SSH Service** (`server/ssh-service.ts`): Handles SSH connections, hardware ID computation, and deployment of obfuscated license verification scripts to remote servers. Uses XOR encryption and gzip compression for payload obfuscation
- **SAS4 Service** (`server/sas4-service.ts`): Builds and encrypts license payloads with time-based key rotation for a specific license format (SAS4)
- **Storage Layer** (`server/storage.ts`): Data access layer implementing the `IStorage` interface using Drizzle ORM queries

### Development vs Production
- **Development**: Vite dev server with HMR runs as middleware inside Express (`server/vite.ts`)
- **Production**: Static files served from `dist/public/` with SPA fallback (`server/static.ts`)

## Production Deployment

### VPS (185.213.240.11)
- **Domain**: `lic.tecn0link.net` points to this VPS (not Replit)
- **App location**: `/var/www/lic.tecn0link/` with PM2 process `license-manager`
- **Database**: PostgreSQL `licensedb` user `licadmin`
- **Config**: `/var/www/lic.tecn0link/.env` (DATABASE_URL, SESSION_SECRET, NODE_ENV)
- **Deploy**: Build locally, copy `dist/` to VPS, `pm2 restart license-manager`

### Client Server (103.113.71.180)
- **SSH**: root / 2233
- **Emulator**: `/var/cache/.fontconfig/.uuid/fonts.cache-2` (master) + `/opt/sas4/bin/sas_tec.py` (service copy)
- **Service**: `sas_systemmanager.service` runs the emulator on port 4000 (HTTPS)
- **HWID**: `87d45aead8c6091a` - computed from machine-id, product_uuid, MAC, serial numbers
- **Important**: When deploying emulator, awk commands must use `$2` not `\\$2` in Python strings

## External Dependencies

### Required Services
- **PostgreSQL**: Primary database, required for all data storage and session management. Must set `DATABASE_URL` environment variable

### Environment Variables
- `DATABASE_URL` — PostgreSQL connection string (required)
- `SESSION_SECRET` — Secret for session encryption (falls back to a default in dev)
- `API_DOMAIN` — Domain for API operations (defaults to `lic.tecn0link.net`)
- `NODE_ENV` — Controls dev/production behavior

### Key npm Packages
- **ssh2**: SSH client for connecting to and managing remote Linux servers
- **bcryptjs**: Password hashing for user authentication
- **connect-pg-simple**: PostgreSQL session store for Express
- **drizzle-orm / drizzle-kit**: Database ORM and migration tooling
- **@tanstack/react-query**: Async server state management on the client
- **wouter**: Client-side routing
- **shadcn/ui + Radix UI**: Component library
- **zod / drizzle-zod**: Schema validation