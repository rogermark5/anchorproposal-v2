# Free job source audit — 2026-10-24

This audit covers documented public job APIs and feeds that can support a personal remote-software job search in the US, UK and Ireland. It is not a claim that every job website on the Internet has been enumerated. A free job-seeker website is not necessarily a free API or a licensed redistribution feed.

No paid plans, expiring credits, API trials, account registration or payment details were used. Fair-use limits and attribution still apply. Freehire's anonymous access is for personal/non-commercial use; the app must not imply an unrestricted commercial licence.

## Implemented additions

| Source | Added coverage | Free-access evidence | Constraints |
| --- | --- | --- | --- |
| Freehire | 116 additional employer systems/company career feeds, each with country and explicit-worldwide searches: 232 connections | [API reference](https://freehire.me/docs/api), [source directory](https://freehire.me/sources) | Keyless personal/non-commercial access. All 116 source IDs responded successfully with filters applied; only 3 had results in the two-day country search snapshot. The remaining feeds were valid but empty for these filters, not failed requests. Aggregator entries from the directory were excluded. |
| Remote First Jobs | 30 additional technical skill feeds | [RSS documentation](https://remotefirstjobs.com/rss) | Latest 100 jobs per skill, updated about every 10 minutes. Public JSON API has a 24-hour delay, so these additions use RSS and public structured country metadata. Original links and attribution retained. |
| Arbeitnow | Five public editions: UK, Germany, France, Switzerland, Netherlands | [Official API announcement](https://www.arbeitnow.com/blog/job-board-api), [API terms](https://www.arbeitnow.com/terms) | Keyless, paginated, full descriptions, source API `created_at` publication timestamp. `remote: true` required. Edition does not imply applicant eligibility: Germany-only and vague "Remote" jobs remain excluded. Link back to Arbeitnow. |
| OnJob.io | One paginated public JSON feed | [Free feed and licence](https://onjob.io/for-job-boards/) | Explicitly free to ingest/cache/republish, no key. Source `datePosted`, full descriptions and canonical OnJob application links. Successful reads once per day as recommended; failed reads can retry after cooldown. |
| Nomado24 | One structured remote search covering US/GB/IE applicant regions | [Developer documentation](https://www.nomado24.com/en/developers) | Keyless, cursor pagination including empty pages. Four-second spacing stays below 240 requests/15 minutes. Only employer ATS results with `source_fact` original publication provenance are accepted; downstream aggregator timestamps are excluded. |
| Remote Frontend/Backend/Java Jobs | Three board searches using the public API | [Developer documentation and terms](https://www.remotefrontendjobs.com/developers) | Keyless, original `isoDate`, full-detail requests and canonical board links. Only explicit country/worldwide eligibility. API access stops at 250 jobs/search and may delay ATS jobs 24 hours; reaching the cap is recorded as incomplete, not a full snapshot. Direct employer submissions can be available immediately. |
| AI Dev Jobs | One public remote search | [Official API guide](https://aidevboard.com/llms.txt) | Public reads, full descriptions, original `published_at`, exact pagination. No registration, paid employer programs, candidate data or application endpoints used. Reject degraded/estimated responses and ambiguous geography. |

**273 additional feed/search configurations**: 232 + 30 + 5 + 1 + 1 + 3 + 1. These are not 273 individual employers. The useful-free bootstrap now covers 424 configurations: 188 employer feeds × 2, 36 Remote First Jobs feeds, We Work Remotely and the 11 new public searches. Existing older configurations are reused through their provider/token uniqueness constraint. Existing names, disabled status and schedules are preserved.

All incoming jobs still require a confirmed source timestamp from today in `JOB_POOL_TIME_ZONE` (default America/Los_Angeles), remote software work, eligible applicant country and the Master's saved title exclusions. Yesterday, future, unknown-date, hybrid, onsite and foreign-only new postings are rejected. Existing tracking history and the 30-day retention rules remain intact. Jobs found in multiple feeds are still compared with existing postings before insertion.

## Reviewed but not enabled

| Provider | Reason |
| --- | --- |
| Jooble | [Official documentation](https://help.jooble.org/en/support/solutions/articles/60001448238-rest-api-documentation) states the free API has **500 total lifetime requests per country key**. This is not a sustainable free daily feed. |
| Adzuna | [API terms](https://developer.adzuna.com/docs/terms_of_service) describe free evaluation access and a 14-day commercial trial; not a fully free ongoing import source under this request. |
| Remotive | [Official API terms](https://github.com/remotive-com/remote-jobs-api) prohibit displaying jobs behind a sign-in gate; this app requires login. The API also delays listings by a day. |
| Remote Landers | [Official API](https://remotelanders.com/api) is free, but `postedDate` is a date-only **first-seen** value, not source publication. The API does not provide a full description. It cannot satisfy these import rules. |
| YubHub | [Free feeds](https://yubhub.co/free-job-feeds/) are public and licensed with attribution, but sampled feed dates move with enrichment (`x-feed-sort: enriched_at desc`), with no separate verifiable original publication timestamp. Do not label these as newly posted today. |
| Startup Jobs | [RSS is free](https://startup.jobs/api/) but contains truncated descriptions without confirmed applicant geography. Full posting fetches returned HTTP 403 during testing. Its free API requires a user-created key. No partial snippet was imported as a full JD. |
| The Muse | [Official API docs](https://www.themuse.com/developers/api/v2) permit anonymous testing but require registration beyond testing. No user key is configured; do not silently use the testing exception in production. |
| Refolk | [Public job search is free](https://www.refolk.ai/developers/jobs), but the live server returned HTTP 429. No repeated requests or bypass were attempted. Not enabled without a successful schema/date/eligibility test. |
| Artificial Intelligence Jobs | [Public API](https://artificialintelligencejobs.co/developers) is free but supplies date-only `posted` and no full description in the job response. No exact source timestamp was invented. Its employers may already be covered through ATS feeds. |
| Career Nest | The previously advertised API documentation domain now resolves to a parked hosting page. No feed enabled. |
| Working Nomads | Public endpoint was reachable, but a clear official API reuse policy was not confirmed and the sampled feed had no today-posted jobs. Do not treat third-party API-directory claims as permission. |
| Reed, LinkedIn, Indeed, Glassdoor and commercial job-data proxies | A durable, documented free feed suitable for this import was not verified. No scraping bypass, paid proxy or trial was added. |

Existing public employer APIs, Ocean of Jobs, Freehire, RemoteJobs.org, Remote OK, Jobicy, We Work Remotely and configured free USAJOBS access remain supported. Himalayas remains supported but its update timestamp is not substituted for missing original publication dates.

## Reproducible evidence

- `free-employer-feed-audit-2026-10-24.json`: 116/116 additional employer source IDs returned HTTP 200 with valid filtered search metadata. Most were empty; source counts are not job counts.
- `free-rss-skills-audit-2026-10-24.json`: all 30 additional skill feeds returned valid RSS.
- `additional-free-rss-results-2026-10-24.json`: adapter-level today/date/country/title results, deduplicated by source URL. Company counts can overlap with existing sources and other reports.
- `additional-free-public-feeds-2026-10-24.json`: live adapter checks of the additional public searches, including empty results and the Remote Jobs network pagination cap.

The verifier scripts are read-only: they read saved title exclusions/company keys, write local reports and caches, and make bounded public requests. They do not modify real jobs, applications, source settings or start background workers. A snapshot is not a promised daily supply, and overlapping reports must not be added together as unique new companies.

Activate by building the API and restarting it. Startup upserts configurations and queues initial imports; it does not reset jobs or require a new migration for this source expansion. Web attribution is a source edit and requires the normal web build during a stopped-service deployment. Do not rebuild an actively served `.next` directory.
