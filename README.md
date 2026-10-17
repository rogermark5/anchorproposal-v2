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

Apply `pnpm db:migrate` before starting this version. `20261016120000_free_us_job_pool` creates separate Job Pool tables and the original 29 sources. `20261016160000_remote_us_source_expansion` adds 282 verified company boards, bringing the original expanded library to 311 sources. `20261016210000_more_free_software_job_sources` adds 180 more live-checked employer boards, for 491 sources at that stage. `20261017010000_double_software_job_sources` adds another 714 verified boards, bringing the default library to 1205 sources. The expansion preserves existing source names, enabled flags and schedules, including Master customizations. `20261016200000_software_pool_applied_scroll` adds software classification, posting-date ordering and a separate per-user applied-marks table. All migrations are additive; existing users, profiles, applications and documents are retained. Imports start paused until Master enables them.

Master opens **Job Pool → Start automatic imports** to collect US jobs every 1, 6, 12 or 24 hours. **Import jobs now** runs a background pass without enabling the recurring schedule. The API performs imports even when the browser is closed, uses a database lease to prevent overlapping workers, and respects a minimum one-hour source cooldown and `Retry-After`. Sources that fail do not block the other sources. Manual synchronization rechecks readiness atomically so a concurrent worker cannot leave an already completed source queued. The worker repairs legacy completed queue flags without clearing a live lease. SmartRecruiters skips detail requests for known non-software titles before applying the full job filter. Feed data is never sent to an AI provider and no paid API is used.

The library contains Jobicy, Remote OK, 1202 company boards (540 Greenhouse, 433 Ashby, 209 Lever and 20 SmartRecruiters), and optional USAJOBS. The initial expansion was checked on October 16, 2026. The next 180 boards were checked on 2026-10-17 (UTC), selecting only boards with remote US software matches from 1694 candidates. Their checked pages contained 479 matching postings before URL deduplication and expiry checks. A further 714 boards were selected after 7945 candidate checks on 2026-10-17 (UTC). Their checked pages contained 1830 matching postings before deduplication and expiry checks. Local verification on 2026-10-17 (UTC) recorded 3,430 unique available jobs, compared with 1,538 previously (2.23×). Lever verification samples its first 100 postings; normal imports paginate the full feed. Company boards can be added by Master under **Manage sources → Add source**, using the board name from the company's public careers URL. Source search and 50-row pagination make the larger library manageable. The coverage panel distinguishes the library size, sources returning matches in their latest import, and sources awaiting a successful first import. A source can have no qualifying openings at a given time. The seven supported integrations use free public read APIs. USAJOBS is initially disabled and needs a free key from https://developer.usajobs.gov/apirequest/; set `USAJOBS_API_KEY` and `USAJOBS_EMAIL` in the API environment, restart the API and enable that source. Other sources need no key. Coverage depends on the free feeds and configured employers and does not include every vacancy.

The pool is **remote software jobs eligible for US applicants**, enforced by the API for listing, job details, publishing and application preparation. Hybrid, office and unspecified arrangements are excluded even when an older client asks for a different work type. Existing non-remote and non-software pool records are preserved but excluded from browsing and application preparation. Software occupation filtering uses role titles (development, software QA, DevOps/SRE, cloud, data/ML and software engineering leadership), excluding non-software occupations such as sales, recruiting and civil/mechanical engineering. Generic roles such as Product Engineer require evidence of software development in the full description. Existing records are classified by the same rules during migration. Company imports require explicit remote evidence in the source's workplace field, location or marked role title; incidental wording in a job description is not used. A role about remote sensing is not assumed to be remote work. Explicit unrestricted worldwide locations are accepted when no country restriction conflicts with US eligibility. Bare Remote, a timezone, employer headquarters, and worldwide roles that exclude US applicants are insufficient. USAJOBS requests specify `RemoteIndicator=true`. SmartRecruiters requests specify public, remote, US postings and fetch full descriptions only for eligible jobs, with bounded concurrency and request throttling.

Only Master can publish jobs, hide/show listings, manage sources or start/configure imports. All signed-in roles can search remote US software jobs by title, company, location, skill and source. Posting-date filters cover 1, 3, 7, 14 and 30 days or All dates. The default **Not applied** view hides only the current user's marks; **Applied** and **All jobs** are also available. **Mark applied** and **Applied · Undo** persist independently for each account, including Master. Preparing a resume and opening the employer link do not mark a job applied or submit anything. Job cards show relative times such as **3 mins ago**; if the feed omits its posting date, the first-import date is labeled **Added** and used by the date filter. Cursor-based infinite scrolling appends 20 jobs at a time, with a manual load/retry fallback. Source progress polling never resets the job list or scroll position; Refresh fetches newly imported jobs. Admin and Bidder users can open a job, select an accessible profile, and save an application through the existing permission and warning checks before generating documents. **Apply at source** opens the original job listing; saving inside AnchorProposal does not submit an application to an employer.

Canonical job links prevent duplicate pool entries. Source attribution and links are retained. Successful complete company-board imports close missing jobs; partial or failed imports do not. Explicit expiry dates and a 30-day last-seen cutoff hide stale jobs. Master-hidden jobs stay hidden when a source refreshes. One synchronization pass is bounded to 30 pages per source; truncated feeds report that status and never close missing roles. Existing applications are unaffected when a pool listing disappears.

Verification: API provider/HTTP tests run with `node --test test/job-pool-*.test.cjs` from `apps/api` after an API build. `node test/functional-job-pool.cjs` additionally exercises the migration and service against a local PostgreSQL instance in an isolated schema, rolls back every change, and mocks all external feeds and application creation.

Maintainers can explicitly recheck the public company-board catalog with `node apps/api/scripts/verify-job-sources.cjs`. It performs read-only public requests, stops querying a host if rate limited, and writes verification metadata under `tmp/job-pool-qa/`. It never writes to the database or automatically replaces the catalog or migrations. Use the new catalog path `apps/api/prisma/job-pool-expanded-sources.json` to recheck this expansion. `--new-only` skips boards already included in migrations, `--target=180` stops after finding that many boards with matching software postings, and `--max-candidates=3000` bounds the discovery pass. `--target-jobs=1900` also requires a matching-posting target, `--resume` uses the last complete checkpoint without refetching checked boards, and `--concurrency=1..12` changes the worker count while retaining the per-host request throttle. Rate-limit blocks persist across resumes. Both count targets must be met to stop early; the candidate budget always remains an upper bound, and `targetReached` reports whether those targets were met. A custom JSON input may contain `candidates` grouped by provider, or a `sources` array matching `apps/api/prisma/job-pool-additional-sources.json`.

The additional source identifiers in `apps/api/prisma/job-pool-expanded-sources.json` are adapted from the [ATS Company Directory by LastRound AI](https://github.com/fyrosofttech/lastroundai-hiring-data/tree/main/ats-directory), licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Credit: [LastRound AI pay transparency study](https://lastroundai.com/blog/salary-transparency-study-2026). The subset was independently checked against public ATS endpoints, filtered for remote US software matches, and Greenhouse board labels were refreshed. No upstream code runs in this project.

The further expansion is recorded in `apps/api/prisma/job-pool-double-sources.json`, with directory attribution and license notices. Company identifiers from [open-jobs-data](https://github.com/ConorsCode/open-jobs-data) (MIT, copyright 2026 open-jobs-data contributors) were used to prioritize primary ATS verification. Neither its code nor its snapshot job rows are imported. The new migration adds source rows only, preserves existing overrides and user data, and is safe to reapply. Source libraries above 1,000 entries are processed over successive worker passes.

The next expansion adds the [Freehire public API](https://freehire.me/docs/api), which needs no account, key or paid plan. It provides 37 independent feeds for additional employer recruiting systems, including Workday, Workable, iCIMS, Oracle, BambooHR, Breezy, Rippling, JazzHR, ADP, UKG, Paylocity and others. Existing Greenhouse, Lever and Ashby integrations continue to read their company boards directly. The Freehire integration requests employer-system sources only, excluding aggregator sources. It keeps the original employer links and full descriptions, checks software titles with the existing classifier, requires explicit US location evidence and a remote workplace designation, and rejects closed listings or upstream sightings older than seven days. Source labels identify Freehire and the recruiting system. Data is supplied by [Freehire](https://github.com/strelov1/freehire) through its documented read API under its [terms](https://freehire.me/terms); no upstream code is copied or AI endpoint called.

Apply both `20261017040000_free_employer_feed` and `20261017050000_partition_employer_feeds` with `pnpm db:migrate`. The latter replaces the initial aggregate import with independent feeds so a slow or unavailable system does not hold up other feeds. It retains existing job IDs, hidden flags and applied marks when moving imported jobs, preserves customized source rows, and carries forward previous retry delays. The legacy aggregate source remains disabled. Master can manage each feed separately or choose a supported recruiting system from the Add source dropdown. Automatic-import preferences are preserved. Local verification on 2026-10-17 (UTC) recorded **7,059 available jobs versus 3,430 before this expansion (2.06×)**, including 3,629 additional employer-feed jobs. Thirty-six feeds completed; Workday retained 803 partial results and its retry delay. All three user roles could browse the expanded pool through the running API, and existing users, profiles, applications, generated documents, applied marks and import settings were unchanged. API and web builds, 26 provider/HTTP checks, 25 isolated database checks and 21 browser checks passed. Live counts depend on current vacancies and successful imports; this local verification does not deploy the Ubuntu server.

Employer feeds use the same URL deduplication, expiry rules and Master-only management as existing sources. Freehire requests are spaced at least one second apart per API process, use its full-description endpoint with explicit country/workplace filters, and respect `Retry-After`. Independent feeds paginate up to the public limit of 10,000 results; an incomplete search is reported without closing old jobs. Imports renew their database lease before each page, and only the worker that owns the attempt can release it. Successful complete imports close missing jobs; failed or partial imports keep previously imported jobs. Verify this integration with `node --test test/job-pool-freehire.test.cjs`, the functional Job Pool test, and the browser test after building API and web.

Further coverage adds 31 employer systems, bringing Freehire to 68 supported systems, with separate US and worldwide queries. Worldwide queries still require an explicit unrestricted location or structured US eligibility; the source's broad `global` search tag alone is insufficient. The importer recognizes US-qualified generic remote labels and additional software specialties, and deduplicates alternate Greenhouse application URLs against primary employer postings. Source identities, hidden flags, applied marks, customized sources and automatic-import preferences are retained. `apps/api/prisma/job-pool-third-sources.json` adds 61 more SmartRecruiters boards checked against live public APIs. Board identifiers came from [Elliott Dehn / Open Jobs](https://github.com/elliottdehn/open-jobs), published under CC0-1.0; snapshot job records are not imported.

[Ocean of Jobs](https://oceanofjobs.com/api/help) supplies additional verified US remote roles from technical departments through its free public API. Metadata is paginated before full descriptions are fetched from a fixed API host, and known primary postings are skipped. Requests are spaced at least 200ms apart per API process, below the documented shared 20 requests/second ceiling. Missing descriptions are skipped without blocking valid postings; incomplete coverage on any page prevents closing older jobs, even when later pages finish normally. Estimated salaries are excluded.

[RemoteJobs.org](https://remotejobs.org/developers/api) adds seven software-related category feeds without an account or API key. Imports require known applicant geography and explicit remote work, plus confirmed US eligibility or verified worldwide permission. Unknown, conflicting and US-excluded locations are rejected. Requests are spaced at least 19 seconds apart per API process to stay below the free API's 200 requests/hour/IP limit, with shared rate-limit backoff. Full descriptions and application links are retained, and the Job Pool displays the required source credit. Near-identical postings with the same company and title are matched against existing employer content without loading every description into memory. These additive source migrations run through `pnpm db:migrate`; do not reset or seed an existing production database. Local verification does not deploy an Ubuntu server, and actual counts depend on current eligible vacancies and completed imports.

Local verification at 2026-10-17 06:37 UTC found **9,725 available jobs versus 7,159 before this expansion (+35.8%)**, with 1,411 configured sources and no duplicate posting identities. The requested 14,318-job target has **not** been reached. Imports remain enabled at the original interval and continue in the background. Existing user/document record counts and import preferences were unchanged, and all three roles could browse the expanded pool. API/web builds, 41 provider/HTTP checks, 31 isolated database checks and 21 browser checks passed. A read-only live Ocean page check returned 47 additional valid full descriptions and correctly reported missing descriptions as partial coverage.

The next source expansion doubles configured coverage from **1,411 to 2,822 sources**, adding **571 Ashby, 477 Greenhouse and 363 Lever employer boards**. Every new board was rechecked against its live, public API and had published software openings. The catalog and verification evidence are in `apps/api/prisma/job-pool-fourth-sources.json`, with the directory attribution and license notices retained. These boards had 12,925 software openings on the checked pages; 41 met the existing remote/US eligibility filters at verification time. The source count and eligible-job count are separate: a board can have software openings while currently offering no qualifying US remote roles. Imports continue to exclude onsite, hybrid, non-software and unconfirmed US eligibility listings.

Apply `20261017150000_double_verified_employer_boards` through `pnpm db:migrate` during deployment. This is a data-only migration that adds source configurations without changing the database schema, existing jobs, source customizations or automatic-import settings. Repeated application and case variants preserve existing Master overrides. The verifier's `--target-software-sources=N` flag counts live software boards independently of `--target=N` and `--target-jobs=N`, which require eligible remote US openings. `--new-only` checks every source migration; optional input `excludedSources` also excludes locally customized boards. Source responses are streamed with a 20 MiB limit, and host rate-limit blocks remain in resumable verification reports.

Local verification at 2026-10-17 14:18 UTC confirmed **2,822 sources (2.00×)**, retained the existing users, profiles, applications, generated documents and applied marks, and preserved all existing source names, enabled flags and import preferences. All three roles could browse jobs, and Master could read the expanded source list through the running API. All **44 provider/HTTP/verifier checks and 32 isolated database checks passed**. New sources are picked up by the existing background worker over successive passes. This local change has not been deployed to Ubuntu.

Imports now use separate company-board and aggregate-feed workers, so a long or rate-limited aggregate feed cannot hold up newly queued company boards. Four board requests and two aggregate imports can run concurrently, with per-host request spacing, database leases and existing retry delays retained. Source warnings include the source name and safe failure reason, and each completed batch logs its progress. An upstream HTTP 500 affects that source's retry schedule; other imports continue.

The Job Pool checks for arrivals every 15 seconds while visible and when returning to the tab. It updates the matching total and offers **Refresh job list** when new jobs arrive, preserving the current cards and scroll position until the user refreshes. Date, source, search and per-user applied filters also apply to these notices. Master sees sources checked, sources awaiting their first check, active imports and retry counts. These import and display fixes require rebuilding and restarting API/web, with no additional database migration.

Verification at 2026-10-17 14:44 UTC confirmed **10,898 available jobs**, all 1,411 newly added boards attempted, and both worker lanes running after the local restart. API/web builds, 44 provider/HTTP/verifier checks, 34 isolated database checks and 22 browser checks passed. The running API's list and arrival endpoints worked for Master, Admin and Bidder; management remained Master-only. Existing record IDs, job hidden flags, source customizations and import preferences were preserved. The external RemoteJobs.org data-science feed's HTTP 500 retains its retry schedule. Ubuntu has not been redeployed by this local fix.

The **5,000-source library** expansion adds 2,178 more distinct employer boards to the existing 2,822 configurations: **1,042 Greenhouse, 815 Ashby and 321 Lever**. Its catalog, live verification counts and attribution notices are in `apps/api/prisma/job-pool-5000-sources.json`. Each added board returned published software openings from its free public API during verification on 2026-10-17 (UTC). Checked pages contained 7,529 software openings, including 133 qualifying remote US listings across 91 boards before deduplication. Imported jobs still require explicit remote work and confirmed US eligibility; a software board can currently have no qualifying US remote vacancies. Source count is separate from job count.

During deployment, apply `20261017160000_five_thousand_job_sources` with `pnpm db:migrate`. It inserts source configurations only, skips existing boards including case variants, and preserves customized names, enabled flags, retry schedules, existing jobs, applied marks and automatic-import preferences. It does not alter the database schema or require a reset or seed. The existing background worker discovers new rows over successive passes, and the existing 50-row source table and search support the larger library.

Additional board identifiers were discovered through [Elliott Dehn / Open Jobs](https://github.com/elliottdehn/open-jobs), under CC0-1.0. Its frozen directory is used to find employers, then every selected board is independently checked through the employer's current public API. Snapshot postings, inferred eligibility and upstream code are not imported. Existing LastRound AI and open-jobs-data attribution and license notices are retained in the catalog.

Validation for this expansion passed **45 provider/HTTP/catalog/verifier checks, 35 isolated database checks and 22 browser checks**. The browser fixture exercises 5,000 source options, source search, 50-row pagination, all three user roles and mobile layouts. The database fixture applies the migration twice, preserves a case-variant customized source and its retry delay, and checks that existing job records, applied marks and import preferences remain unchanged.

Local verification at **2026-10-17 15:59 UTC** confirmed exactly **5,000 configured sources**, with the new migration applied and imports running. At that checkpoint 57 new boards had been attempted and 53 had completed; the remainder continue in background passes. All existing user, profile, application, generation, document and applied-mark record IDs were retained, along with job hidden flags, source customizations and automatic-import settings. Master, Admin and Bidder could browse, scroll and check arrivals through the running API, and Master management returned all 5,000 sources. This local change has not redeployed Ubuntu.
