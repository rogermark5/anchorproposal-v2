# AnchorProposal Desktop for Windows

A full Windows workspace with the same application, profile, template, team, prompt, and platform-management screens as the website. The desktop bundles and reuses the web components, with native navigation, a dark theme, and an API bridge. The default global shortcut is **Ctrl + Shift + Z**. Change it in **Desktop preferences → Global shortcut** by clicking the recorder and pressing a new combination.

## Use the app

1. Choose **Setup installer** or **Portable app** on the website's `/download` page. The installer (`release/v<version>/AnchorProposal-Setup.exe`) lets you choose a folder and creates Start menu and desktop shortcuts. The portable app (`release/v<version>/AnchorProposal.exe`) runs without installation. Each download is a single file; neither needs Node.js, a database, web server, or local API process on the user's computer.
2. The desktop connects only to `https://anchorproposal.giize.com/backend`. Sign in with your AnchorProposal account; there is no server-address field to configure. On upgrade, saved localhost or other server addresses are replaced automatically. Sessions belonging to those old addresses are cleared, so sign in again. Preferences such as your hotkey and notifications are preserved.
3. Sign in using your existing account. New users can register, verify their email, and wait for administrator approval. Password recovery accepts the reset link from email.
4. Use the sidebar to open the same workflows as the website. Press the global shortcut to open a separate **New application** window on the right, without bringing the main workspace forward. Choose a profile and template, paste the job description, and generate. **Ctrl + Enter** submits the form. Warnings show their matching sentences before you continue; blocked applications require resolution in their details.
5. The quick window shrinks to progress while the model works. Hiding it, closing it to the tray, or pressing Escape keeps generation running. Cancel stops the stream. Completion opens **Resume**, **Cover letter**, and **Answers** tabs in that same window. Both document tabs use the server-rendered layouts, including the cover letter's saved profile contact details. Choose **Preview and edit documents** for the same version selector, content editor, save-and-rebuild, combined downloads, and public sharing as the website. Saving selects the new version for subsequent quick-window downloads and answers. Use **Ctrl+1/2/3** to switch tabs, **Ctrl+S** to save the selected document as PDF, and **Ctrl+N** to start the next application. Word export is available beside Save PDF; export status remains visible until saving completes or is cancelled. The global shortcut preserves unfinished drafts and starts a fresh draft after completion or Save only. Drag the title bar to move the window and drag its edges to resize it.
6. Profiles, templates, and options refresh whenever the quick window opens or regains focus, and after changes in the main desktop window. The application list refreshes after quick saves and completed generation, and when the workspace regains focus. Both windows use the same server and signed-in account.

Manual generation provides the complete prompt and validates pasted JSON. Answer chat continues the saved resume conversation. Profiles, template previews and editing, application status and history, resume/cover-letter exports, prompts, user assignments, job pool, and published downloads use the existing web screens. Master accounts can manage provider settings, warning rules, audit logs, and desktop releases directly in the app. Admin and Bidder accounts retain their existing permissions; the server authorizes every request.

Completed resumes, application history, and answer conversations are saved in the server database and loaded through the API, so they remain available after closing the app or signing in on another computer. A local document is created only when you explicitly export PDF/DOCX. The desktop interface is bundled in the executable and runs locally; account operations, generation, and saved content require access to your hosted API.

The quick window opens on the right of the monitor containing the pointer. Desktop preferences include the global shortcut, always-on-top for the quick window, Windows startup, notifications, password change, and sign-out. The main workspace is resizable and can be maximized. Startup is opt-in. Keep a portable executable at a stable path if you enable Windows startup.

## Server deployment

Deploy the API changes in this repository alongside the desktop app, including migration `20261006120000_device_sessions`. Rebuild the generated Prisma client, apply migrations, and restart the API. Existing web refresh tokens remain compatible. New logins get separate revocable sessions so web and desktop sessions can coexist. Password changes revoke all sessions.

The quick window's streaming route is `POST /applications/:id/generations/stream`. A reverse proxy must allow long-lived responses, disable buffering for this route, and use a read timeout above eight minutes. Responses send `Cache-Control: no-store`, `X-Accel-Buffering: no`, and a heartbeat every 15 seconds. Request disconnects cancel the provider call; completed resumes remain saved. Check Applications after a broken connection before retrying.

Master must save the provider key in platform settings. Environment-only keys cannot enable generation. The key is checked for every request and never sent to the desktop. Signup and recovery require the existing server mail configuration.

Desktop generation starts immediately rather than waiting for the web generation queue. Reservations use PostgreSQL locks and idempotency keys, so separate API instances share admission limits. `DESKTOP_GENERATION_CONCURRENCY` controls the platform-wide streaming limit (default 16, maximum 256); each account may hold at most two streams and this desktop UI starts one at a time. Size this limit to provider quotas, database capacity, and measured load. This release has functional integration coverage, not a production load certification.

The quick window stays loaded in the tray, profile/template/option requests run in parallel, charts and workspace pages load on demand, and PDF/DOCX rendering happens on export. The initial local screen does not wait for a server connection. Actual AI completion time still depends on model choice, prompt size, provider capacity, and network latency. No real-provider speed claim is made by the mocked performance tests.

## Credentials and packaging

Desktop preferences and the encrypted sign-in session are saved locally. The refresh token is encrypted with Windows DPAPI through Electron safeStorage. Access tokens remain in the native process; passwords are not saved. Renderer code receives neither tokens nor provider credentials. Remote API calls require HTTPS. Windows encryption protects against other Windows accounts; it is not protection from malicious software already running as the signed-in user.

The renderer is packaged local code with sandboxing, context isolation, no Node integration, no external navigation, clipboard-write-only permissions, and an allowlisted IPC bridge. Template previews have scripts disabled. External links open in the default browser. Sign-out removes the saved credential and synchronizes both windows. Credentials saved for an old server are never sent to the fixed production server.

The build stages only the desktop main-process files, bundled interface, icons, and package metadata. QA helpers, server files, environment files, and monorepo dependencies are excluded. Builds are currently unsigned; configure Windows code signing before public distribution. No automatic updater is configured in this release.

The portable download is one executable. Its small Windows launcher extracts the runtime once per build to `%LOCALAPPDATA%\AnchorProposal\PortableRuntime\<build-hash>` and reuses it on later launches. A progress window explains the first extraction. The cached executable and application bundle are hash-checked before reuse. Interrupted extractions cannot become completed caches; separate copies coordinate through a mutex. This directory contains program files, not resumes or credentials. Windows 10/11 provides the .NET Framework runtime used by the launcher. The setup executable installs the same app for the current Windows user and includes an uninstaller. Uninstalling preserves desktop preferences and sign-in data. `release/build/` contains intermediate packaging output and is not needed by users.

## Develop and verify

From the repository root:

```powershell
pnpm install
pnpm --filter @anchorproposal/desktop exec install-electron
pnpm desktop
pnpm --filter @anchorproposal/desktop typecheck
pnpm --filter @anchorproposal/desktop test
pnpm --filter @anchorproposal/desktop test:smoke
pnpm package:desktop
pnpm --filter @anchorproposal/desktop verify:package
```

The smoke test creates an isolated Windows profile under `tmp/desktop-qa`, uses a local mock API, checks real DPAPI and global shortcut registration, exercises the full workspace and separate quick window, and captures screenshots. It covers warning confirmation/blocking, automatic streaming, manual JSON import, answer chat, role navigation, fresh drafts, logout, and hotkey changes. It does not contact an AI provider, send mail, or alter user accounts. Server regression coverage is in `apps/api/test/desktop-stream.test.cjs` and `device-sessions-db.cjs`; the latter uses a database transaction and rolls back all test writes.

Measure a packaged startup with `scripts/measure-startup.ps1 -Executable release/v<version>/AnchorProposal.exe -Label cold -CacheDirectory ../../tmp/desktop-qa/startup-cache`. Use a new cache directory for a first extraction and the same directory for a warm launch. The probe uses an isolated profile, makes no API requests, writes first-render timings, and exits. Compare sequential runs on the same computer; antivirus scanning, disk caches, and machine load affect results.

Windows deliverables are **`release/v<version>/AnchorProposal-Setup.exe`** and **`release/v<version>/AnchorProposal.exe`**. `pnpm package:desktop` builds both in a versioned folder. The native process enforces `https://anchorproposal.giize.com/backend`; saved settings, renderer requests, and `ANCHOR_API_URL` cannot override it. Package verification checks that the embedded server metadata agrees with the native constant.

Packaging creates local deliverables without changing the server release catalog. To publish an update, sign in as **Master → Settings → Desktop app** in the web or desktop workspace, create its version, upload the setup and/or portable executable, and publish it. Master can edit notes, select the latest version, hide versions, and delete drafts. All published versions remain on `/download`; Admins and Bidders have no release-management access. `pnpm publish:desktop` remains a legacy server-file staging command; an existing managed catalog cannot be replaced by staging a manifest. See `RUNBOOK.md` for storage backups and nginx upload limits.
