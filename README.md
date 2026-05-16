<div align="center">

<br />

<img alt="Nimbus Cloud" src="https://raw.githubusercontent.com/panthomnexuslab/nimbus-cloud/main/.github/assets/logo-dark.svg" width="120" />

# Nimbus Cloud

### Private. Secure. Everywhere.

[![CI](https://img.shields.io/github/actions/workflow/status/panthomnexuslab/nimbus-cloud/ci.yml?branch=main&style=for-the-badge&logo=github&labelColor=0a0a0a&color=22d3ee)](https://github.com/panthomnexuslab/nimbus-cloud/actions)
[![License](https://img.shields.io/badge/license-MIT-22d3ee?style=for-the-badge&labelColor=0a0a0a)](./LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.6-3178c6?style=for-the-badge&logo=typescript&logoColor=white&labelColor=0a0a0a)](https://www.typescriptlang.org/)
[![NestJS](https://img.shields.io/badge/NestJS-10-E0234E?style=for-the-badge&logo=nestjs&logoColor=white&labelColor=0a0a0a)](https://nestjs.com/)
[![Next.js](https://img.shields.io/badge/Next.js-14-000000?style=for-the-badge&logo=next.js&logoColor=white&labelColor=0a0a0a)](https://nextjs.org/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-336791?style=for-the-badge&logo=postgresql&logoColor=white&labelColor=0a0a0a)](https://www.postgresql.org/)
[![Redis](https://img.shields.io/badge/Redis-7-DC382D?style=for-the-badge&logo=redis&logoColor=white&labelColor=0a0a0a)](https://redis.io/)
[![Cloudflare R2](https://img.shields.io/badge/Cloudflare-R2-F38020?style=for-the-badge&logo=cloudflare&logoColor=white&labelColor=0a0a0a)](https://www.cloudflare.com/products/r2/)

**A zero-trust, end-to-end-encrypted personal cloud — built like Proton, fast like Linear, polished like Apple.**

<br />

</div>

> Nimbus Cloud is a fully open-source, ultra-secure personal storage platform.  
> Your files are **encrypted before they ever touch disk**, sealed with **AES-256-GCM**, gated by **TOTP 2FA + device-bound sessions**, and served only over **time-boxed signed URLs**. The UI is a futuristic glassmorphic experience designed to feel like a billion-dollar product — without the surveillance.

<br />

<p align="center">
  <img alt="Nimbus Cloud preview" src=".github/assets/preview-dashboard.png" width="880" />
</p>

<br />

---

## ✦ Why Nimbus

|  | Big Tech Drives | **Nimbus Cloud** |
|---|---|---|
| **Encryption** | Server-side, vendor holds keys | **Envelope AES-256-GCM**, per-file DEK, server holds no plaintext key |
| **Auth** | Email + opt-in 2FA | **JWT + rotating refresh + TOTP + device-bind** by default |
| **Privacy** | Telemetry + ML on your photos | **Zero telemetry**, no third-party CDNs, no trackers |
| **Sharing** | Permanent public URLs | **HMAC signed URLs**, expiry + password + download caps |
| **Compliance** | Trust us | **Tamper-evident audit chain** + full self-host |
| **UX** | Generic admin panels | **Glassmorphic, animated, mobile-first** |

---

## ✦ Feature Matrix

<table>
<tr>
<td valign="top" width="50%">

### Security
- AES-256-GCM **envelope encryption** (KEK → DEK → file key)
- **TOTP 2FA** with hashed recovery codes
- **Refresh-token rotation** with replay detection
- **Device fingerprinting** + trusted-device tracking
- **Brute-force lockout** + Redis-backed rate limiting
- **IP anomaly detection** + per-IP ban list
- **CSP + HSTS + CSRF + Helmet** baseline
- **Path-traversal & SSRF** hardened
- **Tamper-evident audit log** (hash chain)
- **ClamAV** malware scan pipeline w/ quarantine

</td>
<td valign="top" width="50%">

### Product
- Drag-and-drop **multipart resumable uploads**
- Streaming **secure video player** with signed tokens
- **Smart gallery** with thumbnails + EXIF strip
- **Nested folders**, favorites, recycle bin
- **Private share links** (expiry / password / download cap)
- **Real-time sync** across devices (Socket.IO)
- **Active sessions** + device revocation
- **Storage analytics** with breakdown charts
- **Admin dashboard** (users / abuse / IP bans / logs)
- **PWA**: installable, offline-capable, mobile-first

</td>
</tr>
</table>

---

## ✦ Architecture at a glance

```
┌─────────────────────────────┐    ┌────────────────────────────────────┐
│  Next.js 14 Web (PWA)       │    │  NestJS 10 API                     │
│  ─ App Router, RSC          │    │  ─ JWT + refresh rotation          │
│  ─ Tailwind + Framer Motion │◀──▶│  ─ TOTP 2FA + Google OAuth         │
│  ─ Glassmorphic dark UI     │    │  ─ Envelope crypto (AES-256-GCM)   │
└─────────────────────────────┘    │  ─ Multipart uploads + ClamAV scan │
              │                    │  ─ WebSocket realtime sync         │
              │ HTTPS + CSRF       │  ─ Tamper-evident audit chain      │
              ▼                    └────────────┬───────────┬───────────┘
   ┌─────────────────────┐                      │           │
   │  Nginx (TLS, HSTS)  │                      ▼           ▼
   └─────────────────────┘             ┌──────────────┐  ┌────────────┐
              │                        │ PostgreSQL 16│  │  Redis 7   │
              ▼                        │   (Prisma)   │  │ rate/locks │
   ┌─────────────────────┐             └──────────────┘  └────────────┘
   │ Cloudflare R2 / S3  │                      ▲
   │ ─ quarantine bucket │                      │
   │ ─ encrypted bucket  │              ┌───────┴────────┐
   └─────────────────────┘              │ ClamAV scanner │
                                        └────────────────┘
```

Full deep-dive in [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md).

---

## ✦ Tech Stack

<div align="center">

|  Layer  |  Stack  |
|---------|---------|
| **Frontend** | Next.js 14 · TypeScript · Tailwind · Framer Motion · Recharts · Socket.IO client |
| **Backend** | NestJS 10 · Node 22 · Prisma 5 · ioredis · Passport · class-validator |
| **Database** | PostgreSQL 16 with row-level encryption metadata |
| **Cache / Queues** | Redis 7 (rate limits, locks, sessions, realtime pub/sub) |
| **Storage** | Cloudflare R2 / AWS S3 / Local — pluggable driver interface |
| **Crypto** | AES-256-GCM (envelope), Argon2id (passwords), HMAC-SHA-256 (CSRF, signed URLs) |
| **Auth** | JWT (RS-free, HS512 default) + rotating refresh + TOTP (RFC 6238) + Google OAuth |
| **Infra** | Docker Compose · Nginx · GitHub Actions CI |

</div>

---

## ✦ Quick start

> Requires **Node 22**, **pnpm 9**, **Docker**, and an OpenSSL CLI for generating secrets.

```bash
# 1. Clone
git clone https://github.com/panthomnexuslab/nimbus-cloud.git
cd nimbus-cloud

# 2. Install
pnpm install

# 3. Bring up Postgres + Redis + ClamAV
docker compose -f docker-compose.yml up -d postgres redis clamav

# 4. Generate envs (one-time)
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.example apps/web/.env.local

# 5. Initialize the database
pnpm --filter @nimbus/api prisma:migrate
pnpm --filter @nimbus/api prisma:seed   # optional: demo user + folders

# 6. Run everything
pnpm dev
```

| Service | URL |
|---|---|
| Web (Next.js) | http://localhost:3000 |
| API (NestJS) | http://localhost:4000/api/v1 |
| OpenAPI docs | http://localhost:4000/docs |
| Prisma Studio | `pnpm --filter @nimbus/api prisma:studio` |
| Local R2 emulator (Minio) | http://localhost:9001 |

---

## ✦ Project layout

```
nimbus-cloud/
├─ apps/
│  ├─ api/                  # NestJS backend (REST + WS + admin)
│  │  ├─ prisma/            # schema, migrations, seed
│  │  ├─ src/
│  │  │  ├─ config/         # zod-validated env config
│  │  │  ├─ common/         # filters, guards, middleware, decorators, utils
│  │  │  ├─ prisma/         # Prisma client wrapper
│  │  │  ├─ redis/          # Redis client wrapper + locks
│  │  │  └─ modules/
│  │  │     ├─ auth/        # JWT + refresh + TOTP + Google OAuth
│  │  │     ├─ users/
│  │  │     ├─ folders/
│  │  │     ├─ files/
│  │  │     ├─ uploads/     # multipart + quarantine flow
│  │  │     ├─ storage/     # R2 / S3 / local drivers (pluggable)
│  │  │     ├─ crypto/      # envelope AES-256-GCM
│  │  │     ├─ sharing/     # signed share links
│  │  │     ├─ recycle-bin/
│  │  │     ├─ malware/     # ClamAV pipeline
│  │  │     ├─ audit/       # tamper-evident hash chain
│  │  │     ├─ security/    # sessions, devices, IP anomaly
│  │  │     ├─ realtime/    # Socket.IO gateway w/ Redis adapter
│  │  │     ├─ notifications/
│  │  │     ├─ admin/
│  │  │     └─ health/
│  │  └─ test/
│  └─ web/                  # Next.js 14 (App Router) + Tailwind + Framer Motion
│     ├─ src/app/
│     ├─ src/components/
│     ├─ src/lib/
│     └─ src/styles/
├─ packages/
│  └─ shared/               # typed contracts + zod schemas + constants
├─ infra/
│  ├─ docker/               # multi-stage Dockerfiles
│  └─ nginx/                # TLS, HSTS, security headers
├─ docs/
│  ├─ ARCHITECTURE.md
│  ├─ DEPLOYMENT.md
│  └─ THREAT_MODEL.md
├─ docker-compose.yml
├─ pnpm-workspace.yaml
└─ README.md
```

---

## ✦ Upload flow

```
        Web (Next.js)                    API (NestJS)               Object Storage
        ─────────────                    ─────────────              ──────────────
   1. POST /uploads               ─▶ check quota, gen IDs,
      { name, size, mime }            create Upload row
                                       ─▶ initiate multipart
                                          on QUARANTINE bucket  ─▶  multipartId
   2. ← { uploadId, parts:[…] }
   3. for each part:
      PUT <signedPartUrl>         ──────────────────────────────────────▶ Q-bucket
   4. POST /uploads/:id/complete  ─▶ verify parts, complete multipart
                                       ─▶ enqueue malware scan
                                       ─▶ if CLEAN:
                                           server-side copy
                                           QUARANTINE → FILES bucket
                                           promote File.status = CLEAN
                                           encrypt key wrap
                                       ─▶ if INFECTED:
                                           delete bytes, audit, alert user
   5. ← { fileId, status: CLEAN }
```

* The browser never sees the final bucket key.  
* The final bucket is private — only HMAC-signed download URLs work.  
* Bytes are quarantined until ClamAV verdict comes back.

---

## ✦ Auth flow

```
   Login (email + password)
        │
        ▼
   Argon2id verify (constant-time)
        │
        ▼
   2FA enabled? ── yes ──▶ require TOTP/recovery code
        │                          │
        ▼                          ▼
   Create Session row (sessionTokenHash, deviceId, ip, ua, fingerprint)
        │
        ▼
   Issue:
     – access JWT  (15m, HS512, includes sid + mfa flag)
     – refresh token (opaque, hashed in DB, single-use)
        │
        ▼
   Set HttpOnly + Secure + SameSite cookie for refresh
        │
        ▼
   Refresh endpoint rotates refresh token
        │   ┌── reuse of an old refresh token ▶ replay detected ▶ revoke whole session ──┐
        │   │                                                                            │
        └───┴─ on success: previous rt → replacedBy=new, new rt issued ──────────────────┘
```

---

## ✦ Threat model (excerpt)

| Threat | Mitigation |
|---|---|
| **XSS** | Strict CSP, no `dangerouslySetInnerHTML`, signed `script-src` |
| **CSRF** | Double-submit cookie + HMAC token + bearer-only mode for native apps |
| **SSRF** | Outbound HTTP egress disabled in API container; signed URL TTL ≤ 5 min |
| **SQL injection** | Prisma parameterized queries everywhere, no raw SQL on user input |
| **Token replay** | Refresh tokens hashed, single-use, rotation chain detects replay |
| **Brute force** | Redis-backed counters, exponential lockout, optional captcha |
| **Malicious uploads** | Strict mime/extension allowlist, ClamAV quarantine, content-type sniffing |
| **Path traversal** | Server-generated opaque keys, name regex + normalize, OS-reserved blacklist |
| **Privilege escalation** | RBAC + per-row owner scoping + audit chain |
| **Account takeover** | TOTP 2FA, device-bind, "new device" email alerts, login-history UI |
| **Insider risk** | KEK never persisted, audit log is hash-chained, admin actions logged |

Full doc: [`docs/THREAT_MODEL.md`](./docs/THREAT_MODEL.md).

---

## ✦ API surface

> Versioned at `/api/v1`. OpenAPI spec available at `/docs` in non-prod.

```
POST   /auth/register                      POST   /uploads
POST   /auth/login                          POST   /uploads/:id/parts/:n/sign
POST   /auth/refresh                        POST   /uploads/:id/complete
POST   /auth/logout                         POST   /uploads/:id/abort
GET    /auth/me                             
POST   /auth/2fa/setup                      GET    /files
POST   /auth/2fa/verify                     GET    /files/:id
POST   /auth/2fa/disable                    PATCH  /files/:id
GET    /auth/google                         DELETE /files/:id   (→ recycle bin)
GET    /auth/google/callback                POST   /files/:id/download
                                            POST   /files/:id/restore
GET    /sessions                            POST   /files/:id/share
DELETE /sessions/:id                        
GET    /devices                             GET    /folders
DELETE /devices/:id                         POST   /folders
                                            PATCH  /folders/:id
GET    /security/login-history              DELETE /folders/:id
GET    /security/recovery-codes             
POST   /security/recovery-codes/regenerate  GET    /share/:slug             (public)
                                            POST   /share/:slug/download    (public)
GET    /recycle-bin                         
POST   /recycle-bin/:id/restore             GET    /admin/users
POST   /recycle-bin/:id/purge               POST   /admin/users/:id/disable
                                            GET    /admin/abuse
GET    /notifications                       POST   /admin/ip-bans
PATCH  /notifications/:id/read              DELETE /admin/ip-bans/:id
                                            GET    /admin/system

WS     /realtime    (Socket.IO + Redis pub/sub adapter)
```

---

## ✦ Deployment targets

| Target | Notes |
|---|---|
| **Docker Compose** | Single-host self-host; `docker compose up -d` |
| **Fly.io / Railway** | API + Postgres + Redis as managed services |
| **AWS** | Fargate + RDS + ElastiCache + S3 + CloudFront |
| **Cloudflare** | Workers (web) + R2 (storage) + tunneled API |
| **DigitalOcean** | App Platform or Droplet + managed PG/Redis |

Step-by-step in [`docs/DEPLOYMENT.md`](./docs/DEPLOYMENT.md).

---

## ✦ Roadmap

- [x] Foundation: auth, encryption, files/folders, uploads, sharing, recycle, audit, admin
- [x] Realtime sync via Socket.IO + Redis pub/sub
- [x] Glassmorphic Next.js web app + PWA
- [ ] **AI features**: face grouping, smart tags, duplicate detection *(separate PR)*
- [ ] **Android & iOS** native clients via React Native *(separate PR)*
- [ ] WebAuthn / passkeys
- [ ] Native end-to-end (client-held keys) opt-in mode
- [ ] Family / team workspaces

---

## ✦ Contributing

PRs welcome — especially in:
- Storage drivers (GCS, Backblaze B2, MinIO presets)
- Locale packs (UI is i18n-ready)
- Security audits & threat model contributions

See [`CONTRIBUTING.md`](./CONTRIBUTING.md) (coming soon).

---

## ✦ License

[MIT](./LICENSE) © panthomnexuslab. Built with discipline, paranoia, and pixel-pushing.

<div align="center">
<br />
<sub><b>Nimbus Cloud</b> — your files. your keys. your cloud.</sub>
</div>
