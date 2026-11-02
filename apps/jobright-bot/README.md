# Jobright browser bot on Ubuntu

This optional worker uses your normal Jobright browser session, reads source posting timestamps and saves jobs through AnchorProposal's limited worker API. It does not apply to jobs. The **Master → Job pool → Jobright bot** panel manages URL exclusions, the browser and Start/Stop controls. The page is fixed to `https://jobright.ai/jobs/recommend`; there is no search URL setting.

Only a posting with a known source timestamp **strictly later than Start watching** can be saved. Import/first-seen times, “today” and relative labels are never substituted. The cutoff survives PM2, worker and API restarts; Stop followed by Start creates a new cutoff. Opening login during a watch preserves that watch's cutoff.

## 1. Deploy the matching server

Push/merge this code into the branch deployed on Ubuntu first. Use your existing backup/deployment procedure, preserving the API `.env`, document storage, PostgreSQL container/volume and Ubuntu `ecosystem.config.cjs`. Install and build from `/opt/anchorproposal`:

```bash
cd /opt/anchorproposal
pnpm install --frozen-lockfile --prod=false
pnpm db:generate
pnpm db:migrate
pnpm build
```

Continue only if these commands succeed, then restart the existing API/web processes using your preserved production configuration. This bot adds **no new migration**; `db:migrate` applies any earlier pending migrations. Never reset or seed the existing production database. The bot's settings, cutoff and limited credential hash use the existing `system_settings` table.

## 2. Configure the worker

In the website, sign in as Master. Open **Job pool → Jobright bot → Connect the Ubuntu worker → Generate worker key**. Copy the key; it is shown once. It is not your account password and cannot read applications, profiles or documents.

On your **Ubuntu desktop**, open a terminal as the same user who runs PM2. Check the display values:

```bash
printf 'DISPLAY=%s\nXAUTHORITY=%s\n' "$DISPLAY" "$XAUTHORITY"
cd /opt/anchorproposal
umask 077
cp -n apps/jobright-bot/.env.example apps/jobright-bot/.env
chmod 600 apps/jobright-bot/.env
nano apps/jobright-bot/.env
```

Set these values in the file (replace the placeholder key):

```dotenv
JOBRIGHT_API_URL=http://127.0.0.1:3001
JOBRIGHT_WORKER_KEY=jrbot_REPLACE_WITH_THE_GENERATED_KEY
DISPLAY=:0
```

Use the actual `DISPLAY` from the desktop terminal, which may be `:1`. If `XAUTHORITY` is set in that terminal, add its exact path too. The worker also checks the normal GDM authority location on Linux. Keep this file and `apps/jobright-bot/.data/` private; the latter holds your Chrome sign-in session. Both are ignored by Git. Do not copy the browser profile to the web public directory or share it in logs/backups intended for others.

Local API access is preferred on the same Ubuntu host. If using the domain instead, the value must include the API proxy prefix: `https://anchorproposal.giize.com/backend`. Remote API URLs require HTTPS.

Install Chrome for the worker if the dependency installation did not already download it:

```bash
pnpm --filter @anchorproposal/jobright-bot exec puppeteer browsers install chrome
```

If Linux reports missing Chrome libraries, install the reported Ubuntu packages. Puppeteer's Linux helper can install dependencies with administrator access: `sudo pnpm --filter @anchorproposal/jobright-bot exec puppeteer browsers install chrome --install-deps`. Keep running the worker itself as your normal desktop user. An existing Chrome executable can instead be selected with `PUPPETEER_EXECUTABLE_PATH` in `.env`.

## 3. Start the worker and sign in

```bash
cd /opt/anchorproposal
pm2 start apps/jobright-bot/ecosystem.config.cjs
pm2 logs anchor-jobright-bot --lines 30 --nostream
```

1. Wait for **Worker offline** in the website to change to the connected worker status.
2. Click **Open login on Ubuntu**. Chrome opens on the Ubuntu desktop, even when you control the website from Windows.
3. Sign in to Jobright normally in that Chrome window. Complete any normal browser verification yourself.
4. Set your Jobright country, job-title, experience and other filters in that window. Click **Finish login & hide** after signing in. Chrome stays open but is minimized; collection uses that same search page and session.
5. Later, use **Show browser** to pause collection and adjust your filters on Ubuntu. **Hide browser** minimizes the same window and resumes an active watch immediately. These actions preserve the watch cutoff and checkpoint. The worker changes only the sort to **Most Recent** on each scan.
6. Add blocked domains, for example `linkedin.com`. This excludes the domain and subdomains, without blocking unrelated lookalike hosts. Add URL words, one per line; matching ignores case and decodes URL escapes. The URL preview lets you test rules before saving them. Click **Save bot settings**.
7. Click **Start watching**. The displayed start time is now the exact cutoff. The first scan skips older results; later scans collect postings published after it. Once connected and tested, run `pm2 save`.

A logged-in Ubuntu desktop display is required while the worker uses Chrome, including minimized scans. An SSH terminal alone cannot provide this display. The worker never automates passwords, CAPTCHAs or access checks. Challenges and rate limits pause collection and appear in the panel; show the browser to continue once resolved. The window appears on Ubuntu, even if you use the website from another computer.

## What is imported

- Only jobs with an original off-Jobright URL. Explicit Jobright redirect targets are unwrapped; a Jobright detail URL or company homepage is never substituted for a missing application link.
- Only jobs whose structured source timestamp follows this watch's cutoff and is not in the future. Jobright's UTC `publishTime` and timezone-qualified `datePosted` are supported.
- Your existing remote software, US/UK/Ireland and Master title-keyword rules still apply. There is a 30-day retention limit. Browser imports use this watch's timestamp rule rather than the normal feeds' “posted today” rule.
- Exclusions, timestamps and run IDs are checked again on the server. Stop rejects late submissions from an in-progress scan. Canonical URLs prevent duplicate job records on retries and restarts. Jobs retain the original publication time in the job pool.
- Every scan selects **Most Recent** through Jobright's dropdown and verifies the selected label. The worker waits for a fresh listing response and ignores delayed data from the previous sort. A page already showing Most Recent is reselected through Recommended to force a fresh response. If the dropdown or refreshed listing cannot be verified, collection pauses with an error. Other filters stay as configured on that same page.
- A saved checkpoint identifies the newest job from the last completely processed list. Subsequent scans skip older posting times and job IDs already processed; new IDs sharing the checkpoint's exact posting time remain eligible. Per-job receipts survive worker restarts. The server saves the checkpoint only after successful processing, and retains it on detail/API failures, interrupted scans, incomplete pagination and job limits. Stop followed by Start creates a new watch and clears the checkpoint.
- Each eligible new job is opened at its Jobright detail page. The detail's company, title, description, location, source posting time, salary, employment type and original URL are read before saving. Missing detail responses are retried; listing summaries are never substituted. **Original Job Post** anchors/buttons are supported. Apply buttons are never clicked.

Jobright's anonymous pages often omit original links. If an otherwise readable detail page exposes no original link, it is skipped and reported. A scan scrolls up to 20 times to reach the previous boundary, with at most 40 detail pages by default, adjustable to 100. If the scan limit is reached, processed IDs are remembered and remaining jobs are picked up on later scans. Complete Jobright coverage and a daily company count are not guaranteed. Layout/data changes can require an adapter update. Check live collection with your Ubuntu Jobright session after installation.

## Stop, restart and troubleshoot

Use **Stop** in the panel to stop the watch. To stop/restart the process itself:

```bash
pm2 stop anchor-jobright-bot
pm2 restart anchor-jobright-bot
pm2 logs anchor-jobright-bot --lines 50 --nostream
```

PM2 restarts preserve the current cutoff and private browser session. Only one worker can hold the server lease. A clean shutdown releases it immediately; a crashed worker's lease expires after 90 seconds. Do not run multiple workers against the same Chrome profile.

If you replace the key in the panel, update `JOBRIGHT_WORKER_KEY` in Ubuntu `.env` and restart `anchor-jobright-bot`. If Chrome cannot open for login, check `DISPLAY`/`XAUTHORITY` and that the Ubuntu desktop session is logged in. If zero jobs arrive, check the cutoff, exclusions, pool title/remote/country rules, missing original links and sign-in status. The website does not need to remain open while the worker watches.

Transient network and 429/502/503/504 API errors are retried with bounded delays. Connection failures name the API origin and error category (for example ECONNREFUSED or a timeout), without exposing the worker key. Check `pm2 status`, the `anchor-api` logs and `JOBRIGHT_API_URL` for those failures. Use the direct localhost API URL on the same host; a public-domain URL needs `/backend`. A retry never moves the checkpoint past an unacknowledged job.

## Verification

From the repository root:

```bash
pnpm --filter @anchorproposal/shared build
pnpm --filter @anchorproposal/api build
pnpm --filter @anchorproposal/jobright-bot test
pnpm --filter @anchorproposal/api exec node --test test/jobright-bot.test.cjs
```

`apps/api/test/jobright-bot-db.cjs` additionally verifies persistence and real ingestion in a disposable schema on a local PostgreSQL database. It reads the existing schema, creates no live jobs and drops its test schema afterward. Browser tests use intercepted Jobright fixtures, including missing links, old timestamps, blocked URLs, a challenge, hidden Chrome, and visible-to-hidden profile reuse; they do not sign in to a real Jobright account.
