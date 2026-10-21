# AnchorProposal for Chrome

Each browser tab opens its own **New application** page. Capture or paste a job, choose a profile and generate. Up to **three generations run concurrently**, while additional applications wait for a slot. Completed applications show **Resume**, **Cover letter** and **Get answers** in the same panel. Both documents download automatically as PDFs by default.

## Build and install

From the repository root:

```sh
pnpm install --frozen-lockfile
pnpm build:extension
```

The build creates `apps/extension/release/v0.2.4/AnchorProposal-Chrome-v0.2.4.zip` and its `unpacked` folder. The website provides the ZIP and installation guide at **Apps & extensions → Install Chrome extension**, `/download#chrome-extension`. Web builds automatically generate the public download and release metadata; binary files do not need to be committed.

1. Extract the ZIP into a permanent folder.
2. Open `chrome://extensions`, turn on **Developer mode**, choose **Load unpacked**, and select the folder containing `manifest.json`.
3. Pin AnchorProposal, open a job page, click the extension icon and sign in. **Alt+Shift+A** opens the panel too; customize it at `chrome://extensions/shortcuts`.

To update, replace the files in the **same installation folder** and click **Reload** on AnchorProposal at `chrome://extensions`. Keeping the folder preserves the unpacked extension identity, defaults and queue. Open panels should be closed and reopened after reloading. The extension uses the existing account/server at `https://anchorproposal.giize.com/backend`. This release is installed unpacked and has not been published to the Chrome Web Store.

## Using several tabs

- Open jobs in separate Chrome tabs. Each panel has its own draft, profile, selected template, saved application and generation preview. **Capture this tab** reads only that panel’s job page. Review extracted details before generating; live job-description validation runs before submission.
- New forms fill the profile, template, location, source and automatic-download preference before you start entering details. Explicit extension defaults take priority; otherwise the assigned account defaults are selected, with the first available option as fallback. **New** and **Clear** use the latest defaults. Reopening a draft keeps your choices, including deliberately cleared fields. Empty drafts from older releases receive the account defaults once when upgraded.
- On a new job website, **Capture this tab** asks Chrome for access to that site and continues capturing after approval in the same click. Other tabs on that site reuse the approval, including tabs where the toolbar icon has not been clicked. Denying or revoking access preserves your draft; Capture can request the site again. Page loading disables Capture until the target is ready. Navigation refreshes the target and a page change during capture cannot overwrite the draft with stale job details.
- Select **Generate resume**, switch to another job tab, open the extension and generate there too. Existing preferences that limited generation to one upgrade to three. Defaults can select two or three concurrent generations. A previously paused queue remains paused until **Resume generation** is selected.
- The gear button configures the default profile/template, location, source, automatic download format and automatic downloads for future applications. Each draft can opt out of downloads independently. Account and server permissions still apply.
- When generation finishes, preview the resume and cover letter or use **Get answers** for that application. Asking questions is an explicit action. Switching tabs does not combine conversations, profiles or job descriptions.
- Select **Edit** in the Resume or Cover letter tab to change its text. Switch between these tabs to edit both documents together. **Preview changes** shows an unsaved preview; **Continue editing** returns to the fields. **Discard** restores the saved documents. **Save edits** creates a new saved version without another AI generation. Save before closing the panel or starting another application. Downloads and Get answers use the saved version; automatic downloads export updated files to the original job folder, preserving earlier files with Chrome's duplicate filename suffix. Editing requires permission to generate your own documents. Name, contact details, employers and employment dates stay tied to the saved profile.
- Automatic downloads export the same documents as the preview’s PDF/Word buttons and save both to **Downloads/Company - Role - MM.DD/**. The date uses the local month and day when the folder is first created. Interrupted downloads retain that folder if retried after midnight. The extension tracks Chrome download IDs to avoid downloading the same result again after reopening. Interrupted downloads have a **Retry unfinished downloads** action. Failed downloads from the old incorrect URL are retried once after updating; successfully downloaded documents are left alone. If a cover letter was not generated, it is shown as not included; the extension does not automatically start another generation. Chrome’s own download policies/settings can still require user interaction.
- **New** starts another application in the current tab while earlier generations continue. Use **Applications in this tab** to return to earlier work. Drafts survive panel closure/reload within the Chrome session, and are cleared when the source browser tab closes or the account signs out. Completed server applications/documents remain saved.

Queued work and download receipts are stored locally per account. Submitted generations keep running on the server when the panel or Chrome closes. Local waiting submissions and downloads resume when Chrome runs again; background alarms are best effort. Up to 500 active items and 200 finished history items are retained. The previous advanced workspace remains available internally with `index.html?workspace=1`; normal toolbar panels show only the application workflow.

## Server deployment

Deploy the matching API and web update so the BullMQ resume worker runs **three generations concurrently per worker process** across all clients. The extension cannot change an older deployed server’s worker concurrency. Existing provider configuration, quotas and account permissions still apply. Generation retries after a lost response reuse the original request ID.

This focused-panel update adds no new database migration. If the preceding profile-specific applied-marks update has not yet been deployed, generate Prisma Client and apply `20261020010000_pool_profile_marks_and_title_rules` using `prisma migrate deploy`. Back up production database/document storage and preserve its environment and PM2 configuration. Do not reset or seed production. The earlier migration preserves applied history and source settings.

## Permissions and privacy

There are no always-on content scripts. The required `tabs` permission identifies the panel's job tab and URL so Capture can request the correct website. HTTP/HTTPS host access is optional and requested for the selected site's exact host when Capture is clicked; the extension does not request all websites together. Chrome remembers sites you approve and lets you revoke them. `scripting` reads page text only after Capture; `activeTab` also supports toolbar invocation. The extractor reads selected text, JobPosting structured data or job content, not input values, cookies or browser history. Browser-internal pages and the Chrome Web Store cannot be captured; some sites require manual paste.

API requests are restricted to the fixed server. Refresh tokens stay in extension-local storage; access tokens and temporary drafts use trusted session storage; passwords are never saved. Tokens are never placed in URLs, captured pages or download filenames. `downloads` saves documents; optional `notifications` is requested only when enabled in the advanced workspace. `storage`, `alarms` and `sidePanel` support per-tab drafts and queued work.

## Verification

```sh
pnpm --filter @anchorproposal/extension typecheck
pnpm test:extension
pnpm --filter @anchorproposal/extension test:focus-browser
pnpm --filter @anchorproposal/extension test:capture-browser
pnpm --filter @anchorproposal/extension test:browser
pnpm --filter @anchorproposal/extension test:install
```

Browser tests load the real MV3 package in an isolated Chrome profile against a localhost fixture. They do not call production or an AI provider. The focused test checks separate tab drafts, overlapping submissions, profile-specific previews/answers, editing both documents, draft previews/discard, failed-save recovery, saved versions, actual automatic downloads and reopening without duplicates. The capture regression uses a job host different from the API host to test permission denial, approval, first capture in new tabs, navigation and revocation without toolbar clicks. It simulates only the native consent choice; Chrome itself grants host access and enforces script injection. The advanced workspace test covers the existing broader workflow. The install-page test requires a completed web build and verifies the served ZIP, setup controls and narrow layout. Localhost builds/fixtures are excluded from release ZIPs. Icon attribution is bundled at `assets/job-site-icon-sources.json`.
