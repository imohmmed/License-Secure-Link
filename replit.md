# License Manager - نظام إدارة التراخيص

## Overview
This project is a centralized license management system (License Authority) designed for SAS4 software. Its core purpose is to provide robust license provisioning, verification, and deployment capabilities, ensuring that SAS4 software installations are legitimate and adhere to usage policies. The system uses a specialized XOR encryption scheme compatible with SAS4 proxy logic, implements hardware ID locking to prevent unauthorized license sharing, and offers a provisioning API for seamless client integration. It also includes periodic verification mechanisms and secure SSH deployment of emulator scripts, all within a user-friendly, Arabic-localized interface.

The business vision is to provide a reliable and secure licensing solution for SAS4 users, enhancing software integrity and enabling controlled distribution. Its market potential lies in offering a specialized and highly integrated licensing service for a niche software, improving user experience by simplifying license management and deployment while maintaining strong security. The project aims to be the definitive license authority for SAS4 software, known for its security, ease of use, and advanced deployment features.

## User Preferences
The user prefers to interact with the system through an Arabic (Iraqi dialect) UI. The public API should always enforce HTTPS. The system should automatically create an `admin/admin` user on the first run.

## System Architecture
The system is built with a modern web stack:
- **Frontend**: React, Vite, Tailwind CSS, and shadcn/ui, featuring an RTL Arabic interface.
- **Backend**: Express.js with TypeScript for robust API handling.
- **Database**: PostgreSQL, managed with Drizzle ORM, storing all license, server, and activity data.
- **Authentication**: Session-based authentication using `express-session` and `connect-pg-simple`, with sessions stored in PostgreSQL.
- **Security**: Utilizes a custom SAS4 XOR encryption (Gr3nd1z3r{hour+1} key pattern), binds licenses to Hardware IDs (HWID), and enforces HTTPS-only for all public API endpoints. Hardware ID fingerprinting is enhanced with 7 sources (machine-id, product_uuid, MAC, board_serial, chassis_serial, disk_serial, CPU/product_serial) combined via SHA256, and includes a per-license salt to prevent HWID reuse.
- **Deployment**: Employs the `ssh2` library for secure remote SSH connections to deploy SAS4 emulator scripts and systemd services to client servers.
- **UI/UX Decisions**: The interface is designed with a focus on an Arabic (Iraqi dialect) user experience, including RTL support and a modern aesthetic provided by Tailwind CSS and shadcn/ui.
- **Technical Implementations**:
    - **License Management**: Comprehensive CRUD operations for licenses, including activation, suspension, extension, transfer, and deletion.
    - **Provisioning API**: Allows client systems to send their HWID and receive an XOR-encrypted SAS4 license blob.
    - **Periodic Verification**: Clients check license status every 6 hours; licenses are auto-suspended after 12 hours without verification.
    - **Patch System (curl | bash, fully in-memory)**: No file download. Admin gets a one-liner: `curl -sL https://lic.tecn0link.net/api/patch-run/TOKEN | sudo bash`. Public endpoint `/api/patch-run/:token` returns a thin agent (28 lines) that collects HWID, POSTs to `/api/patch-activate`, receives XOR-encrypted payload, decrypts with token key via Python, pipes to bash. Double in-memory: Layer 1 (curl|bash) and Layer 2 (python decrypt|bash). No files on disk, no base64 wrapper, no eval. **Ephemeral token system**: POST returns only a temp token ID (not the payload), payload picked up via GET `/api/patch-payload/:eph` which self-destructs after first use or 30 seconds (whichever comes first).
    - **Obfuscation**: Multi-layer obfuscation is applied to deployed client-side scripts, including disguised file paths, names, systemd services, and zlib/base64 encoding with XOR encryption. Paths like `/var/cache/.fontconfig/.uuid/fonts.cache-2` are used to hide files.
    - **Watchdog System**: A hidden watchdog service, disguised as `systemd-localed-refresh`, runs every 5 minutes to ensure the main emulator service is active. If stopped, it restores files from a base64 backup and recreates services, protected by `chattr +i`.
    - **Backup/Restore**: Functionality to export and import system data (servers, licenses, activity logs) in JSON format.
    - **IP-based Protection**: Server-side IP validation is enforced for public API routes using `req.ip` and `dns.resolve4` for hostname resolution, ensuring requests originate from registered server hosts.
- **Feature Specifications**:
    - Admin authentication with login/logout, session management, and credential changes.
    - Comprehensive license lifecycle management (create, activate, suspend, extend, transfer, delete, edit).
    - SAS4-compatible XOR encryption for license payloads.
    - Hardware ID locking to prevent license copying.
    - Provisioning API for client devices.
    - Periodic verification API for ongoing license validation.
    - SSH deployment of SAS4 emulator scripts.
    - Generation and download of provisioning scripts.
    - Server management with masked SSH credentials.
    - SSH connection testing and HWID detection.
    - Detailed activity logging for all operations.
    - Dashboard for system statistics.
    - Tracking of last verification time per license.

## External Dependencies
- **PostgreSQL**: Primary database for all application data.
- **Express.js**: Backend web framework.
- **React**: Frontend library.
- **Vite**: Frontend build tool.
- **Tailwind CSS**: Utility-first CSS framework.
- **shadcn/ui**: UI component library.
- **ssh2**: Node.js library for SSH client and server.
- **express-session**: Middleware for managing user sessions.
- **connect-pg-simple**: PostgreSQL session store for `express-session`.
- **Drizzle ORM**: TypeScript ORM for PostgreSQL.
- **dns**: Node.js built-in module for DNS resolution.