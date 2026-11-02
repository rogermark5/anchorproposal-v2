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

After generation, the preview lets you choose a resume version, review both documents, and download both in PDF or DOCX. The Applications table also has a preview button. Template customizations and default selections belong to the current user; shared template records stay unchanged. Generated versions retain their template configuration. Page borders are removed; section decorations are optional in the designer.

The document creator can choose **Edit documents** in the preview, change summary, skills, experience wording, education, certifications or cover-letter text, and use **Preview changes** before **Save and rebuild**. The editor also accepts a professional headline, core expertise and projects, including descriptions, technologies, links, dates and achievement bullets. Saving creates a new version with no AI call and leaves the original available in the version selector. Downloads and public links for that new version use the saved edits. Name, contact details, employers and employment dates remain bound to the saved profile; qualification corrections and added projects are accepted only through the authenticated editor, never through model metadata.

### Resume template designer

Open **Templates**, select a template and edit its style. The 12 tabs cover Typography, Layout, Colors, Contact, Experience, Education, Certifications, Headline, Expertise, Projects, Sections and PDF Style. Changes update the sample preview; **Save style** stores the current user's customization. Existing generated versions keep their saved style; saving an edited document preserves that version's template snapshot.

Contact and entry controls configure visibility, color, line placement and alignment. Entries support one or two lines with independent bold/italic styling. Layout includes Letter/A4, page margins, header alignment, spacing and section rules. Spacing fields labelled **twips** use 20 twips per point (720 = half an inch); heading-rule thickness uses eighths of a point. The Sections tab renames, reorders, aligns and hides headings. Enable Headline or Core Expertise there to display their editor content. Projects display when present unless explicitly hidden.

**PDF Style** provides 12 themes, 16 header accents, 14 subtle watermarks and 16 section styles. Pick a theme, then customize its three layers independently. Decorative vector artwork appears in the live preview and PDF. Word exports retain the content, section order, typography, margins, field layouts and supported native heading styles; background artwork is PDF-only. The template's job-title switch and the personal Resume appearance setting both control the title below the candidate's name.

These designer and editor additions use existing JSON columns and require no additional database migration. When upgrading from an older release, still apply any pending Job Pool migrations as described below. Focused validation covers private saves and candidate identity, browser controls and mobile width, plus PDF/Word samples for every theme and a multipage A4 resume.

Cover letters include the saved candidate name, headline, contact details, date, company and role. Their preview, PDF and Word exports use the same professional structure. Closing blocks and signatures pasted into body paragraphs are removed, and the saved candidate signs the letter once.

Duplicate companies and job links produce confirmation messages and allow resume generation after the user continues. Job-link matching ignores URL fragments and common tracking parameters while preserving job identifiers. Other blocking warnings keep their existing policies. Public resume links are encrypted, expire after 30 days, and can be revoked by the resume creator. Configure `RESUME_SHARE_SECRET` with at least 24 characters, or use an existing `JWT_SECRET` of that length. Public pages expose the rendered resume and do not include the cover letter or application data.

## API Endpoints

- `POST /auth/login` - Sign in
- `GET /dashboard/metrics` - Dashboard KPIs
- `GET /applications` - List applications
- `POST /applications/:id/generations` - Start resume generation
- `GET /documents/:fileId/download` - Download generated file

## Job Pool

The pool contains fully remote software jobs open to applicants in the **United States, United Kingdom and Ireland**. Titles containing **staff, principal, architect, junior, lead or director** are excluded by default, case-insensitively. **Master → Job Pool → Excluded job title keywords** lets Master add/remove words or phrases and save the shared rules. Rules use literal substring matching and apply during imports, manual publication, browsing, counts and job actions. An empty saved list disables title keyword exclusions while keeping software/remote/country checks. Settings persist in PostgreSQL; only Master can read or change management settings. Changes hide matching existing jobs immediately without deleting application, applied or viewed history. Removing a keyword allows previously skipped jobs to return on their next source import. A country must be supported by the original posting's location or structured applicant requirements. Worldwide roles require explicit permission. A bare Remote label, a timezone, employer headquarters, salary currency, Europe or EMEA alone does not establish eligibility. Northern Ireland belongs to the UK filter. Original descriptions and application links remain available so applicants can review more specific residence and work authorization requirements.

The default library contains **30,000 distinct source configurations**. The latest expansion adds 16,997 verified live employer boards to the previous 13,003 sources, using twelve employer-board integrations. Sources are individual employer boards and public feeds, rather than 30,000 different recruiting platforms or geographic copies of the same board. The supported integrations are Jobicy, Remote OK, Greenhouse, Lever, Ashby, SmartRecruiters, Workable, Recruitee, Breezy HR, Pinpoint, Personio, Teamtailor, BambooHR, Paylocity public careers, optional USAJOBS, Freehire employer feeds, Freehire worldwide feeds, Ocean of Jobs and RemoteJobs.org. USAJOBS alone needs its optional free API key; no paid APIs or AI calls are used for imports.

The new catalog and its verification evidence are in `apps/api/prisma/job-pool-30000-sources.json`. All 16,997 new employer boards returned published jobs during live verification. The report separately records observed software openings and raw posting counts before remote/country filtering and deduplication. Case variants, obvious demo/test boards and repeated Paylocity employer names are excluded from the new catalog. Source count is separate from available job count: some boards currently have no qualifying software openings. Runtime imports apply the full remote, software, eligibility, expiry and freshness checks to every job. Historical catalogs and their verification evidence remain in the other `job-pool-*-sources.json` files.

Master's coverage panel has a **30,000 distinct-source library target** and a **10,000 confirmed-source target for each of US, UK and Ireland**. Country progress counts sources with currently available qualifying remote software jobs. Merely being searchable for a country does not meet its target. Any shortfall remains visible; no country quota is manufactured by cloning boards or assigning unsupported locations. Employer boards are shared and fetched once, then jobs are checked for eligible countries. Separate counters show sources monitored, successful reads and available jobs. Disabled or unconfigured sources do not count as monitored. Job counts use the same eligibility, visibility, expiry and freshness rules as browsing, across all application statuses. Manual jobs count as jobs, not imported sources. Worldwide jobs may appear in more than one country total. Live vacancies determine whether a country reaches its target; 30,000 configured boards do not guarantee 10,000 currently hiring sources in each country.

Master opens **Job Pool → Start automatic imports** to schedule imports every 1, 6, 12 or 24 hours. **Import jobs now** queues a background pass without changing the recurring schedule. Imports continue with the browser closed. Existing automatic-import preferences, disabled sources, names and retry schedules are preserved during an upgrade. Only Master can add/publish/hide jobs or manage sources. All signed-in users can browse and apply using their existing permissions.

**Country** offers All countries, United States, United Kingdom and Ireland. **Site** groups jobs by recruiting platform or feed instead of individual employer boards. **Posted** uses the timestamp supplied by the source: Last 24 hours, 72 hours (3 days), 168 hours (7 days), 336 hours (14 days), or 720 hours (30 days), plus All time. Rows, details and newest-first cursor pagination use this same source timestamp. Missing dates show **Posting time unavailable**, sort last in All time, and stay outside date-filtered results. Refreshes without a date preserve a previously known source timestamp. Import time still identifies new additions and keeps scrolling snapshots stable, independently of posting age. Search, country, site, posting-time and per-user applied filters compose. **Not applied** is the default; **Applied** and **All jobs** remain available. Marking, undo, scrolling and new-job notices preserve selected filters. Preparing a resume does not mark a job applied. This change uses existing database fields and settings; it needs no additional migration beyond the project's pending migrations.

Job rows omit descriptions and source attribution; **View job** retains the complete description and original source link. Company-match links compare only your accessible applications, using lowercase company names with all whitespace removed. Original company names remain visible, and each matching link opens that application. Rows use neutral backgrounds with a hover effect; only badges carry status colors. Company-match badges show the matching profile and original application company, and job-platform logos appear on the left with a globe fallback. Applied badges name the profiles used. **Mark applied** opens a profile picker; one job can be marked with several accessible profiles, and undo removes only the selected profile. Older marks show **Profile not recorded** until the user updates them. Import groups follow the selected 1/6/12/24-hour interval, starting when the first genuinely new job is added. The first addition after that interval replaces the previous New group; empty imports, retries and updates to existing jobs leave the group unchanged. New is independent of Viewed/Applied and appears as an additional badge. The group is saved in PostgreSQL and shared across accounts, browsers, computers and restarts. List polling moves markers without resetting scroll or filters. Every status has a text label. Opening View job or the original job link records Viewed for your own account through `PATCH /job-pool/jobs/:id/viewed`. This persists across reloads, browsers and computers without marking the job Applied. Existing views from before this feature cannot be reconstructed. All filter inputs share a height and alignment, and the grid wraps on smaller screens. Master import details start collapsed to give jobs more room. Source management still has employer search and 50-row pagination. Progress polling uses `/job-pool/manage?summary=1`, which omits source records and preserves the cached list.

Workable uses its public widget API with full descriptions. Recruitee uses its public JSON offer feed. Breezy reads the employer's public JSON listing and JobPosting metadata from the same employer host, without executing HTML. Pinpoint uses its documented keyless `postings.json` feed and requires an explicit remote workplace type, supported location and software role. Hidden salary fields are not exposed, and missing publication dates stay unknown. Missing descriptions and interrupted imports never close previously saved jobs. Other employer boards retain their public API integrations. Freehire and Ocean query US, GB and IE together; RemoteJobs uses confirmed applicant-location requirements and exclusions for each country. Jobicy has separate geographic feeds. USAJOBS remains US-only.

Personio reads the public English XML feed, rejecting DTDs and external entities. Teamtailor reads the public careers JSON feed and its JobPosting metadata, requiring `TELECOMMUTE`; explicit applicant-country requirements take precedence over office addresses. BambooHR reads its public careers list and details, using the documented location enum (`1` remote, `0` on-site, `2` hybrid). Paylocity reads public careers-page JSON and job-detail HTML as data, without executing JavaScript or using the separate keyed feed API. Internal postings are excluded, and details must confirm fully remote work and match the employer's public board or verified employer account ID. Employer subdomains, Teamtailor regional hosts and Paylocity public board UUIDs are validated before any request. Responses are limited to 20 MiB and bounded by timeouts.

Imports use separate employer-board and aggregate-feed workers, database leases, per-host request spacing, a minimum one-hour source cooldown and Retry-After backoff. Twelve board workers process bounded batches; aggregate feeds retain two workers. A failing source does not block other providers. HTTP 429 starts a shared provider cooldown, so other boards on that provider do not continue making requests. Workable requests remain at least one second apart, other employer providers at least 250 ms, RemoteJobs at least 19 seconds and Freehire at least one second per API process. Complete successful feeds close missing jobs; failed or partial feeds keep older jobs. Paylocity presentation/application links, Personio domain aliases and BambooHR legacy links retain existing job IDs, hidden flags and application marks when a direct board replaces an aggregate listing. Source warnings include safe failure reasons. Deployments sharing an IP must account for shared upstream limits.

**Upgrade:** back up the production database, document storage, desktop release storage and environment/configuration files. Verify that the migration connection matches the running API. Install locked dependencies, then run `pnpm db:generate`, `pnpm db:migrate` and `pnpm build` before restarting API/web. The new migrations are:

- `20261020010000_pool_profile_marks_and_title_rules`: adds profile-specific applied history, preserves legacy marks and timestamps, and excludes the four title terms without deleting job records or changing source settings. Deploy the matching API/web/desktop clients together.
- `20261018010000_job_pool_country_eligibility`: adds an indexed eligible-country array and backfills existing US jobs without changing their IDs or applied marks. Subsequent imports add other countries when confirmed.
- `20261018020000_ten_thousand_job_sources`: adds source configurations idempotently while preserving case-variant existing sources, Master overrides, schedules, jobs and user data.
- `20261018030000_country_source_targets`: adds another 3,000 verified live employer boards with the same preservation rules. Monitoring targets are measured from the actual enabled source configuration, not fabricated per-country source copies.
- `20261018040000_thirty_thousand_distinct_sources`: adds 16,997 distinct verified boards to reach 30,000 configurations. Existing source preferences, retry delays, jobs, applied marks and import settings are preserved. New boards with observed software openings are scheduled first. Country target progress now uses confirmed available jobs rather than monitoring capability.

New application forms in web and desktop validate the JD as it changes through the read-only `POST /applications/validate` endpoint. Checks use existing profile access, creation permissions and warning rules, create no records, ignore stale responses and require warning review before saving. Blocked descriptions cannot be created through the form.

Do not seed or reset an existing production database. Fresh installations start imports paused; upgrades keep their saved preference. Ubuntu needs all pending migrations and an API/web rebuild for this feature. Desktop **0.2.13** bundles the matching interface; publish its setup/portable files through **Master → Settings → Desktop app** after deploying the server. Building or applying migrations locally does not deploy Ubuntu or publish a desktop release.

Source attribution: earlier subsets of employer identifiers come from [LastRound AI](https://lastroundai.com/blog/salary-transparency-study-2026) under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/), [open-jobs-data](https://github.com/ConorsCode/open-jobs-data) under MIT, and [Elliott Dehn / Open Jobs](https://github.com/elliottdehn/open-jobs) under CC0-1.0. The new expansion uses employer identifiers from Open Jobs' frozen directory, independently checked against current employer endpoints. Snapshot postings, inferred eligibility, embeddings and upstream code are not imported. Public feed documentation: [Freehire](https://freehire.me/docs/api), [Ocean of Jobs](https://oceanofjobs.com/api/help), [RemoteJobs.org](https://remotejobs.org/developers/api), [Workable](https://help.workable.com/hc/en-us/articles/115012771647-Using-the-Workable-API-to-create-a-careers-page), and [Recruitee](https://support.recruitee.com/en/articles/8213076-faq-api).

Pinpoint's public feed is documented in its [Job Postings JSON Endpoint guide](https://developers.pinpointhq.com/docs/jobs-json-endpoint).

Additional references: [Personio public XML and credential-free access](https://support.personio.de/hc/en-us/articles/29375445597725-Frequently-asked-questions-on-XML-job-integration), [Teamtailor public careers feeds](https://support.teamtailor.com/en/articles/11171756-rss-feed-how-to-guide), and [BambooHR location types](https://documentation.bamboohr.com/reference/create-job-opening). Paylocity's public careers pages are used; its separately keyed job-feed API is not required.

Validation includes provider/HTTP/catalog/verifier tests, a real PostgreSQL fixture that rolls back its isolated schema, browser tests for Master/Admin/Bidder country and applied filters, 30,000-source management and mobile width, and native desktop checks. After building the API, run `pnpm --filter @anchorproposal/api test:unit` and `pnpm --filter @anchorproposal/api exec node test/functional-job-pool.cjs`. The public-board verifier supports all twelve employer board integrations, up to 30,000 candidates per pass, resumable checkpoints, and first-page eligible job counts for each country. Rechecking a catalog is read-only and respects rate limits. Live job counts change with vacancies and completed imports.

For source posting times and editable title keywords, `pnpm --filter @anchorproposal/api exec node test/job-pool-source-time.cjs` checks rolling windows, nullable-date pagination, concurrent settings updates, import rules and preserved history in a disposable schema on a local PostgreSQL instance. After packaging the extension, `pnpm --filter @anchorproposal/extension test:job-pool-browser` checks the shared interface for Master, Admin and Bidder against a local fixture, including narrow screens. Neither test contacts job providers or AI services.

The additive migration `20261018070000_job_pool_import_batches` adds first-addition group IDs without changing existing job IDs, viewed/applied marks or source settings. Existing jobs are not retroactively labelled New. Only committed new additions advance the group, including manually published jobs. `node test/job-pool-import-batches.cjs` checks concurrent services, rotation, empty runs, refreshes, rollback and private history in an isolated local schema.

## Optional Jobright bot

The Master job-pool panel can control a separate Ubuntu browser worker: configure Jobright search pages, exclude domains/URL words, sign in visibly and continue hidden. Only source postings after the saved watch start can be imported, with original off-Jobright links and the existing pool rules. See the [Ubuntu installation, login and operating guide](apps/jobright-bot/README.md). The worker is optional and adds no database migration.

## Chrome extension

Run `pnpm build:extension` for the Manifest V3 extension. Each browser tab opens its own new application form, with independent drafts and up to three concurrent generations. Completed jobs show resume and cover-letter previews, automatic PDF/Word downloads and Get answers. The gear button saves profile, template and download defaults. The advanced workspace remains available internally. **Apps & extensions** opens `/download`, with the Chrome ZIP and installation/update guide at `/download#chrome-extension`. Web build/dev scripts generate the public ZIP and version/size/checksum metadata automatically; generated binaries stay out of Git. Load the ZIP unpacked through Chrome Developer mode, keeping the same installation folder when updating; see [installation, permissions and update instructions](apps/extension/README.md). Deploy the matching API for three concurrent server generations. The focused-panel update adds no database migration; apply the earlier profile-marks migration if it has not been deployed.
