# AnchorProposal - AI Resume & Application Tracking Platform

Multi-user platform for AI-assisted resume tailoring and job application management.

## Tech Stack

- **Frontend:** Next.js 15, TypeScript, Tailwind CSS, Recharts
- **Backend:** NestJS, Prisma ORM, BullMQ
- **Database:** PostgreSQL 16
- **Queue:** Redis 7 + BullMQ
- **AI:** DeepSeek API
- **Monorepo:** npm workspaces + Turborepo

## Quick Start

### Prerequisites

- Node.js 20+
- pnpm (`corepack enable`)
- PostgreSQL 16 and Redis 5+ (or Memurai on Windows)
- Optional: Docker Desktop (requires WSL2 + reboot after first install)

### Setup

```bash
# 1. Install dependencies (from repo root)
cd D:\tailor
pnpm install

# 2. Build shared package
pnpm --filter @anchorproposal/shared build

# 3. Generate Prisma client and migrate
cd apps/api
pnpm exec prisma generate
pnpm exec prisma migrate deploy
pnpm exec ts-node --transpile-only prisma/seed.ts
cd ../..

# 4. Start API
cd apps/api
pnpm build
pnpm start

# 5. Start Web (new terminal)
cd apps/web
pnpm dev
```

Or from root: `pnpm dev` (starts web + api in parallel once scripts are configured)

API build and startup commands check that the installed Prisma client matches `apps/api/prisma/schema.prisma`. A missing or stale generated client is repaired automatically before the API imports its modules, including after a fresh dependency install. This only generates client code; it does not migrate, seed, or reset the database. Production deployments may omit the Prisma CLI after generating a valid client during the build. If generation fails, startup stops with the repair command instead of crashing on a missing enum such as `UserRole.ADMIN`.

- **Web:** http://localhost:3000
- **API:** http://localhost:3001

### Docker Compose (after reboot)

Docker Desktop + WSL2 were installed but need a **Windows restart** before the Docker engine can start.

After reboot:
```bash
docker compose up -d
```

### Demo Accounts

| Role   | Email / username              | Password      |
|--------|-------------------------------|---------------|
| Master | Master                        | Master@12345  |
| Admin  | admin@anchorproposal.com      | admin123      |
| Bidder | bidder@anchorproposal.com     | bidder123     |

**Roles:** Master manages users and platform analytics (no bidding). Admin bids and manages their own bidders, profiles, templates, and prompts. Bidder bids using assigned profiles and published templates only.

Sign-in uses email and password. Sign-up still requires a **6-digit email OTP** (logged to the API console when SMTP is not configured). New self-registered users start as **Pending** until Master/Admin allows them.

## Trial / share with QA (ngrok)

Several users on other machines can log in over one ngrok HTTPS URL. Auth uses Bearer tokens + same-origin `/backend` proxy — **no per-IP setup**.

**Never run `pnpm dev` while sharing.** Dev web serves a ~7MB JS bundle; browsers and free ngrok fail, and login ends on `/login?`. Use share mode only.

### Start trial mode (local + remote)

```powershell
# From repo root — kills next/api on 3000/3001, starts API + production web, smoke-tests login
pnpm share

# Separate terminal (IPv4 required on Windows — do not use bare "localhost")
ngrok http 127.0.0.1:3000
# Or: ngrok start --config ngrok.yml --all
```

- **You (host):** open `http://127.0.0.1:3000` (prefer this over `localhost` on Windows)
- **Testers:** open the ngrok **HTTPS** URL, click through the free interstitial once, hard-refresh (Ctrl+Shift+R) once, then sign in with a demo account above

`pnpm dev` is for **local coding only** (no ngrok). For QA/trial hosting always use `pnpm share`.

### Env for the public URL

In `apps/api/.env` (and root `.env`), set your current ngrok HTTPS origin:

```env
APP_WEB_URL=https://YOUR-SUBDOMAIN.ngrok-free.dev
CORS_ORIGIN=https://YOUR-SUBDOMAIN.ngrok-free.dev,http://localhost:3000,http://127.0.0.1:3000
NEXT_PUBLIC_API_URL=/backend
API_PROXY_TARGET=http://127.0.0.1:3001
```

Restart the API after changing `APP_WEB_URL` / `CORS_ORIGIN`.

### QA checklist

1. Keep **API (3001)**, **production web (127.0.0.1:3000)**, and **ngrok** running — do not start `pnpm dev`.
2. Testers open the **HTTPS** ngrok URL and click through the free ngrok interstitial once.
3. Sign in with a demo account above.
4. In DevTools → Network, login should be `POST /backend/auth/login` on the **same** ngrok host (not `localhost:3001`).
5. If login breaks again, you likely started `pnpm dev` — run `pnpm share` again.
6. If the ngrok URL changes, update `APP_WEB_URL` / `CORS_ORIGIN` and restart the API.

## Project Structure

```
apps/
  web/          Next.js frontend
  api/          NestJS backend + BullMQ worker
packages/
  shared/       Shared types, enums, Zod schemas
```

## Key Features

- Admin/Bidder role-based access control
- Candidate profile management with assignments
- Manual application entry with policy validation
- Duplicate company detection
- Configurable warning rules (clearance, remote, etc.)
- Async AI resume **and cover letter** generation via DeepSeek (JSON → PDF/DOCX using the chosen template)
- Master configures the platform DeepSeek API key and model under Settings → AI Provider.
- Every user owns their resume, cover-letter and application-answer prompts. Existing shared instructions are preserved as independent private copies.
- PDF, DOCX, and TXT document output
- Resume template designer with live preview
- Application status tracking with timeline
- Audit logging

## Environment Variables

See `.env.example` for all configuration options.

## Resume generation

Apply database migrations with `pnpm db:migrate` before starting an updated build. Production startup (`pnpm build`, then `pnpm start`) serves the web app at `http://127.0.0.1:3100`; local development uses port 3000.

Settings → Resume & cover letter shows three generation ways. Way 1 has one private prompt for all profiles. Way 2 lets you select a profile and create or choose its combined resume + cover-letter prompt. Way 3 shows separate resume and cover-letter selectors for the selected profile. Save the setup to activate that way; repeat profile assignments for other profiles. The profile detail page links directly to this setup. Separate mode makes the resume request first and the cover-letter request second. Manual generation provides both prompts and accepts separate JSON responses.

The application appends mandatory JSON rules to every resume and cover-letter prompt, including custom, manual, streamed and repair requests. It validates output before saving, retries malformed provider JSON up to three times, and attempts one repair for invalid resume structure. Invalid results are rejected instead of becoming completed documents. You write the instructions; the application manages the output contract.

The database profile controls the candidate name, contact details, links, employers, dates and original qualification facts. Skills come from the response JSON `skills` array, including manual imports. The header title follows the most recent rendered experience role; its visibility is controlled by **Settings → Resume appearance → Job title below your name**. That personal setting also applies to existing document previews, fresh exports and public links, while employment-history titles remain visible. Conflicting employer histories are rejected. Older resume versions with conflicting identities or employers must be regenerated before preview, export, answers, or public sharing.

After generation, the preview lets you choose a resume version, review both documents, and download both in PDF or DOCX. The Applications table also has a preview button. Template customizations and default selections belong to the current user; shared template records stay unchanged. Generated versions retain their template configuration, and exported documents have no page or section borders.

The document creator can choose **Edit documents** in the preview, change summary, skills, experience wording, education, certifications or cover-letter text, and use **Preview changes** before **Save and rebuild**. Saving creates a new version with no AI call and leaves the original available in the version selector. Downloads and public links for that new version use the saved edits. Name, contact details, employers and employment dates remain bound to the saved profile; qualification corrections are accepted only through the authenticated editor, never through model metadata.

Cover letters include the saved candidate name, headline, contact details, date, company and role. Their preview, PDF and Word exports use the same professional structure. Closing blocks and signatures pasted into body paragraphs are removed, and the saved candidate signs the letter once.

Duplicate companies and job links produce confirmation messages and allow resume generation after the user continues. Job-link matching ignores URL fragments and common tracking parameters while preserving job identifiers. Other blocking warnings keep their existing policies. Public resume links are encrypted, expire after 30 days, and can be revoked by the resume creator. Configure `RESUME_SHARE_SECRET` with at least 24 characters, or use an existing `JWT_SECRET` of that length. Public pages expose the rendered resume and do not include the cover letter or application data.

## API Endpoints

- `POST /auth/login` - Sign in
- `GET /dashboard/metrics` - Dashboard KPIs
- `GET /applications` - List applications
- `POST /applications/:id/generations` - Start resume generation
- `GET /documents/:fileId/download` - Download generated file

## Job Pool

Job Pool pages are UI-only placeholders. Backend integration is planned for a future release.
