# AnchorProposal Operations Runbook

## Local Development

1. Start PostgreSQL and Redis: `docker compose up -d`
2. Install: `npm install`
3. Migrate: `cd apps/api && npx prisma migrate deploy && npm run db:seed`
4. Run: `npm run dev` from root

## Production Deployment

### Pre-deploy Checklist

- [ ] Set strong `JWT_SECRET` and `JWT_REFRESH_SECRET`
- [ ] Configure `DEEPSEEK_API_KEY` in environment (not in source control)
- [ ] Run database migrations: `npx prisma migrate deploy`
- [ ] Verify backup/restore procedure
- [ ] Configure monitoring for API latency, queue depth, generation failures

### Services

| Service | Port | Notes |
|---------|------|-------|
| Web (Next.js) | 3000 | Static + SSR |
| API (NestJS) | 3001 | REST API |
| PostgreSQL | 5432 | Primary data store |
| Redis | 6379 | BullMQ job queue |

### Generation Pipeline Monitoring

Watch for:
- Queue depth on `resume-generation` queue
- `FAILED` generation status count
- DeepSeek API latency and error rate
- Puppeteer memory usage during PDF rendering

### Rollback

1. Revert deployment artifact
2. Run backward-compatible migration if needed
3. Clear stuck jobs in Redis: `redis-cli KEYS bull:resume-generation:*`

### Backup

- PostgreSQL: daily automated backups
- File storage (`./storage/resumes/`): sync to durable storage

## Troubleshooting

### US, UK and Ireland Job Pool upgrade

This upgrade needs a server deployment, including migrations `20261018010000_job_pool_country_eligibility`, `20261018020000_ten_thousand_job_sources`, `20261018030000_country_source_targets` and `20261018040000_thirty_thousand_distinct_sources`. Preserve the production environment and PM2 configuration and back up the database, documents and desktop release files before deploying the merged code. Confirm that the migration URL matches the running API's database. Run `pnpm install --frozen-lockfile --prod=false`, `pnpm db:generate`, `pnpm db:migrate` and `pnpm build`, then restart `anchor-api` and `anchor-web` and save the PM2 list. Do not seed or reset the production database.

The additive source migrations bring a standard installation to 30,000 distinct source configurations and preserve existing source overrides and application marks. The Master panel shows a 30,000-source library goal and separate 10,000-source country targets based on currently available eligible remote software jobs. Monitoring capability alone does not meet country targets; shortages remain visible. Shared boards are fetched once. Large catalogs take multiple import passes, and source limits/cooldowns are respected. Existing US jobs retain their IDs; other eligibility is added when sources refresh. Master can start imports from Job Pool, and all signed-in users can filter by US, UK or Ireland. Existing automatic-import preferences stay in effect. Check source totals, country coverage, applied marks and a PDF export after deployment. The added-time index migration `20261018050000_job_pool_added_time_index` and per-user viewed-history migration `20261018060000_job_pool_viewed` and import-group migration `20261018070000_job_pool_import_batches` must also be deployed before restarting the API. Verify that viewing a job persists for that user after reload and leaves other users' statuses and Applied marks unchanged. Verify Last 24 hours against first-import timestamps, the Site filter, company-match links and live JD checks before publishing desktop binaries. The matching desktop release is 0.2.12; publish it after deploying the server. See the README Job Pool section for provider details and source verification evidence.

### Windows app download

**Chrome address-bar installation:** Every web page links to `/manifest.webmanifest`, with 192px and 512px branded PNG icons and standalone display mode. Chrome can offer its built-in **Install app** icon for **AnchorProposal Web**. This installs the browser-powered workspace; the setup/portable Windows app with global hotkeys is still downloaded from `/download`. Production must use HTTPS. Chrome controls promotion based on its installability/engagement rules and existing installations; the icon may not appear immediately or when the app is already installed. The Codex embedded preview does not provide Chrome's native address bar. Verify with Chrome DevTools → Application → Manifest after deployment. Recreate the icon files with `node apps/web/scripts/generate-app-icons.cjs` from the repository root if the vector brand mark changes. No service worker or offline caching of account data is introduced.

**Master release management:** Sign in as Master and open **Settings → Desktop app**. Create a unique version (for example `1.2.3`), upload its setup and/or portable `.exe` files, add release notes, and choose **Publish & make latest**. Each upload is limited to 512 MiB and streamed to disk; the API validates Windows executable headers and computes SHA-256. Admin, Bidder, and anonymous requests cannot list drafts, upload, edit, publish, hide, select latest, or delete releases. Every successful management change records the Master actor in the audit log.

All published versions appear on `/download`, with their own stable download URLs, notes, file sizes, and checksums. **Make latest** changes the featured version without removing older versions. Hide a release to revoke its public downloads and edit or remove its files. Delete is available only for hidden/draft releases and removes their files. Back up both the database and `DESKTOP_RELEASE_DIR`: the catalog is persisted under `desktop_releases_v1` in system settings, with PostgreSQL advisory locking for concurrent writes. This feature needs no new database migration.

For nginx, allow multipart uploads on the API proxy with `client_max_body_size 520m`, `client_body_timeout 600s`, and `proxy_read_timeout 600s`. Give the API process read/write access to `DESKTOP_RELEASE_DIR` and sufficient disk space. Never serve this storage directory through a static alias; download visibility is enforced by the API. Multiple API workers must share the same artifact storage and database. Failed uploads are cleaned up; an interrupted process or a file held open on Windows may leave an unreferenced file, which can be removed during storage maintenance.

The public download page is `/download`, linked from the sign-in screens and the dashboard sidebar. It reads release metadata from `/backend/desktop/release` and offers **Setup installer** (`/backend/desktop/windows/setup`) and **Portable app** (`/backend/desktop/windows`). All download endpoints are public; account data and AI operations still require authentication. Each variant has its own availability, size and checksum. Older portable-only manifests are still supported.

Build both Windows packages with `pnpm package:desktop`. Packaging creates local deliverables without publishing a release. Upload and publish them through Master release management. `pnpm publish:desktop` remains a legacy command that stages executable files and a manifest locally; it cannot change an existing managed catalog. Binaries stay out of Git. Desktop 0.2.0 shares the web workspace screens and opens a separate New application window through the customizable hotkey. The portable runtime is cached per build for fast reopening. See `apps/desktop/README.md` for native QA and startup measurement.

Deploy the updated API and web app, then use Master release management to upload the Windows builds. For the initial legacy release only, an existing `release.json` and its versioned executables in `/opt/anchorproposal/apps/api/storage/desktop/` remain supported. The first Master management change adopts that release into the database catalog; subsequent local manifest changes cannot overwrite managed versions or restore a hidden/deleted release. `pnpm publish:desktop` stages build files locally and does not update an existing managed catalog.

Set `DESKTOP_RELEASE_DIR` in the API environment to use another absolute directory. A release change is picked up without restarting the API. Missing files and incomplete uploads disable the corresponding download rather than serving a broken link. Download endpoints stream large files and support byte-range requests. `/desktop/releases/:id/windows/:kind` addresses a specific published version; the original `/desktop/windows` and `/desktop/windows/setup` endpoints remain available for compatibility.

Verify deployment with `GET https://anchorproposal.giize.com/backend/desktop/release` (expect `available: true` and both `downloads` entries), then send `HEAD` requests to `/backend/desktop/windows` and `/backend/desktop/windows/setup` (expect each executable's size and attachment filename). Open `https://anchorproposal.giize.com/download` and try both selections. The desktop streaming endpoint and `20261006120000_device_sessions` database migration must also be deployed for the app's generation and device sessions.

| Issue | Resolution |
|-------|------------|
| Generation stuck in QUEUED | Check Redis connection and BullMQ worker |
| PDF render fails | Ensure Puppeteer/Chromium dependencies installed |
| 401 on API calls | Token expired; refresh or re-login |
| Duplicate warning on valid company | Review normalization rules in warning settings |


### Prompt experience-position flag (desktop 0.1.2)

Each library prompt has a **JD role match** checkbox in Settings. Unchecked prompts use fixed profile positions; checked prompts may tailor experience titles to the job description. Assign the prompt to a profile to use its flag. Shared initial prompts, personal default prompts, and default/fallback generation always use fixed positions. Editing the flag preserves the prompt text. The website and desktop app follow the assigned prompt automatically, without a separate generation selector.

The prompt-library API accepts `experienceTitleMode: "saved" | "tailored"` when creating or editing a prompt. New prompts default to `saved`; edits that omit the field preserve its current value. The server resolves and snapshots this flag when generation starts. Legacy generation request overrides are ignored, and completed versions retain their original mode. Manual preparation returns the resolved mode and context hash; imports must return the hash. Changing the prompt or flag after preparation requires preparing a new prompt before import. Completed idempotent retries return the original result.

Tailored JSON may contain only `summary`, `skills`, and `experiences` with `role` and `bullets`. Return exactly one entry per saved experience in profile order. The API validates roles/bullets and fills company, location, dates, contact, education, and certificates from the generation's saved profile snapshot. Existing full JSON remains supported. Mismatched counts, conflicting company names, or a changed prompt context are rejected with an actionable error. Compact entries are paired by array position; their order must match the profile. Titles are normalized for all templates, exports, and the answer conversation.

Before deploying the API, run `pnpm --filter @anchorproposal/api db:migrate` and `pnpm --filter @anchorproposal/api db:generate`, then rebuild/restart the API and website. Migration `20261006200000_experience_title_mode` adds the generation snapshot column. Migration `20261006210000_prompt_experience_flag` adds the prompt flag, defaults existing prompts to fixed positions, and prevents default prompts from using role matching. Mark existing role-matching library prompts using their checkbox after migration. Upload the new setup and portable binaries as a new version through **Master → Settings → Desktop app**, then publish. Updating source or building binaries does not deploy the hosted server.


### Daily company discovery

Migration `20261024010000_company_discovery` adds company history, a verified-board discovery queue, and 21 Himalayas country/role feeds. These are filtered API feeds, not 21 separate employers. Existing jobs, applications and marks are retained. Existing companies inherit their earliest stored job creation date, so deployment does not mark the entire library as new.

Back up the production PostgreSQL database first. Stop the API, deploy the code, run `pnpm install --frozen-lockfile --prod=false`, `pnpm db:generate`, `pnpm --filter @anchorproposal/api exec prisma migrate deploy`, and `pnpm build`, then restart the API and web processes. Use `migrate deploy` on Ubuntu; do not reset or reseed the database. Preserve production environment files, the PM2 configuration, database connection and document storage. The migration was applied to the local development database; Ubuntu needs its own migration after deployment.

The Job Pool shows all matching jobs, including applied jobs and multiple roles at the same company. The filter bar has Search, Country, Site, Posted and **Sort by** controls. **Recently imported** (default) uses each job's first import time; **Newest posted** uses the original source posting date and places unknown dates last. Refreshing an existing job does not change its import order. Displayed job times and the Posted date filter always use source dates, independently of the selected order; import times are not displayed on job rows. Master also has a Visibility menu for hidden jobs. Applied, viewed and company-match badges remain visible. The API retains its optional company grouping/history filters for existing clients.

New imports require a confirmed source publication date from **today**, from midnight through the current time in `America/Los_Angeles`. Set the API environment variable `JOB_POOL_TIME_ZONE` to a valid IANA timezone to change this calendar consistently on Windows and Ubuntu. Yesterday's jobs are skipped even when they are less than 24 hours old; future-dated and undated postings cannot create new jobs. Daylight-saving changes follow calendar days, rather than a fixed 24-hour duration. Known jobs can still refresh after their first day, without becoming new additions again. Source update times do not qualify as publication dates; this includes Himalayas `pubDate` and Greenhouse `updated_at`. Legacy undated jobs retain their existing history and normal availability rules.

Jobs posted more than 30 days ago disappear from every listing, independently of their latest import or refresh time. A cleanup pass runs on API startup and every minute, including while imports are paused, marking those jobs inactive. Job records, company history, applications and applied/viewed marks are retained. Later refreshes cannot reactivate a posting that is still over 30 days old. No additional database migration is required for this age policy. After `pnpm build:api`, stop the running local app with Ctrl+C and run `pnpm start` again to activate the changes; the web build does not need to be replaced.

The new-company count uses the company's first encounter, independently of job publication and import batches. The displayed 1,000/day figure is a goal, not a guaranteed supply. Company identity follows lowercase names with all whitespace removed; punctuation and legal suffixes stay distinct.

Automatic imports also run employer-board discovery. A bounded scan harvests explicit public ATS URLs from stored jobs, validates pending boards using the existing title, remote, country and today's publication rules, and registers only boards with a qualifying posting. The harvest repeats daily and progresses in batches. Boards without a qualifying recent posting retry after a day; existing or manually disabled sources are not re-enabled. Master can use **Discover companies now** for a manual pass. Pausing automatic imports pauses automatic discovery.

Himalayas runs in a separate lane, refreshing successful searches once per 24 hours (failed requests can retry after at least an hour, subject to provider cooldowns), preserving its supplied application links and visible attribution. Its `pubDate` is an update timestamp: the application stores it as `sourceUpdatedAt`, leaves unknown original publication dates empty, and labels the date **Updated**. A Posted filter excludes jobs with unknown publication dates. The optional server-only `HIMALAYAS_API_KEY` raises free request limits; no key is required. Provider-wide cooldowns respect Retry-After. Documentation: https://himalayas.app/docs/remote-jobs-api

### Additional useful free feeds

The useful-free bootstrap registers 424 additive feed/search configurations at startup: 188 Freehire employer-system/company feeds with both country and explicit-worldwide searches, 36 Remote First Jobs category/skill feeds, We Work Remotely, five Arbeitnow editions, OnJob.io, Nomado24, three Remote Frontend/Backend/Java searches and AI Dev Jobs. The latest expansion adds 273 configurations to the previous coverage. Registration preserves existing names, enabled/disabled settings and schedules. These are filtered searches, not 424 individual employers. No additional migration or API key is required for this expansion; restart the API after building it to register the sources and queue initial imports. See `research/free-job-source-audit-2026-10-24.md` for official access terms, live evidence and exclusions. Freehire's anonymous access is for personal/non-commercial use.

Remote First Jobs RSS provides full descriptions and source publication timestamps. The adapter reads public JobPosting metadata to confirm applicant countries; it does not infer eligibility from company headquarters. We Work Remotely uses its published RSS region/country fields. Existing source links and named source attribution are preserved in job previews and application links. Official feed documentation: https://remotefirstjobs.com/rss and https://weworkremotely.com/remote-job-rss-feed. Reads are limited to the documented endpoints and approved posting URLs, paced to one request per second, cached across overlapping category feeds and paused after HTTP 429 responses.

Freehire now requests recent `posted_at` results and Ocean of Jobs requests recent source dates before fetching full descriptions. The two-day upstream window allows for timezone and daylight-saving differences; the final import gate still admits only today's dates in JOB_POOL_TIME_ZONE. Limited recent-result feeds do not deactivate existing jobs just because they fall out of the returned window. The 30-day posting-age rule and expiration checks still apply. Cross-source content matches preserve job IDs and tracking marks instead of creating duplicate postings.

The initial 15-feed live verification on October 24, 2026 found 34 matching source URLs across 24 company names, including 14 absent from the local company history (`research/useful-free-feeds-2026-10-24.json`). The later expansion has separate `additional-free-rss-results-2026-10-24.json`, `additional-free-public-feeds-2026-10-24.json` and employer-source audit reports. Counts are before content deduplication and can overlap across feeds/reports; they are not guaranteed daily supply. Reproduce read-only checks from apps/api with `node scripts/verify-useful-free-feeds.cjs --new-public` or `--rss-skills`; the default checks the entire bootstrap list. These scripts do not start workers or modify the database. Daily feeds use a 24-hour successful-sync interval, all provider-wide cooldowns respect Retry-After, and Nomado24 requests are spaced at least four seconds apart. Paginated/incremental feeds retain jobs missing from a recent-results window or truncated public API response.

Checks: `pnpm build:api`; from apps/api, `node --test test/job-pool-*.test.cjs` and `node test/company-discovery-db.cjs`. The latter tests the actual migration and listing against an isolated schema and removes only that test schema. Set `PG_BIN` to the PostgreSQL command-line tool directory when needed; it defaults to the installed Windows PostgreSQL 16 directory. Web attribution can be typechecked with `pnpm --filter @anchorproposal/web exec tsc --noEmit --incremental false`; run `pnpm build:web` only during a deployment when the existing web service has been stopped so served chunks are not replaced underneath open browsers.
