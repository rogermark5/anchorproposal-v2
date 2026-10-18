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
