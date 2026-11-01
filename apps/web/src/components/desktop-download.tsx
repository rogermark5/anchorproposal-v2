'use client';
import { useTimeZone } from '@/components/time-zone-settings';
import { formatZonedDate } from '@/lib/time-zone';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowRight, Check, Chrome, Cloud, Download, FileCheck2, Keyboard, LoaderCircle, Monitor, RefreshCw, ShieldCheck, Sparkles } from 'lucide-react';
import { BrandMark } from './brand-mark';
import { ChromeExtensionInstall } from './chrome-extension-install';
import { useAuth } from '@/lib/auth-context';
import { api, type DesktopRelease } from '@/lib/api';
import styles from './desktop-download.module.css';

type PackageType = 'setup' | 'portable';
type ReleaseFile = { version: string; bytes: number; sha256: string; publishedAt: string };
type Release = { available: true; downloads: Record<PackageType, ReleaseFile | null> } | { available: false };
const apiBase = (process.env.NEXT_PUBLIC_API_URL || '/backend').replace(/\/+$/, '');
const features = [
  { icon: Keyboard, title: 'A shortcut that fits your flow', description: 'Open the panel on the right of your screen with Ctrl + Shift + Z. Change the shortcut whenever you like.' },
  { icon: Sparkles, title: 'Generate without losing focus', description: 'Paste a job description, choose your profile, and generate. A compact progress panel keeps you up to date.' },
  { icon: Cloud, title: 'Your work stays with you', description: 'Resumes, applications, and answer chats are saved on your server and available when you sign in again.' },
];

export function DesktopDownload() {
  useTimeZone();
  const { user } = useAuth();
  const [release, setRelease] = useState<Release | null>(null);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [packageType, setPackageType] = useState<PackageType>('setup');
  const [versions, setVersions] = useState<DesktopRelease[]>([]);
  const [latestId, setLatestId] = useState<string | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    setRelease(null); setError(false);
    setVersions([]); setLatestId(null);
    api.getPublicDesktopRelease(AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]))
      .then(async value => {
        if (typeof value.available !== 'boolean') throw new Error('Invalid release');
        let normalized: Release = { available: false };
        if (value.available) {
          const downloads = value.downloads || { portable: value, setup: null };
          for (const file of [downloads.portable, downloads.setup]) {
            if (file && (!file.version || !Number.isFinite(file.bytes) || !/^[a-f0-9]{64}$/.test(file.sha256))) throw new Error('Invalid release');
          }
          if (!downloads.portable && !downloads.setup) throw new Error('Invalid release');
          normalized = { available: true, downloads: { portable: downloads.portable || null, setup: downloads.setup || null } };
          if (!controller.signal.aborted) setPackageType(current => downloads[current] ? current : downloads.setup ? 'setup' : 'portable');
        }
        if (!controller.signal.aborted) {
          setRelease(normalized);
          setVersions(Array.isArray(value.releases) ? value.releases : []);
          setLatestId(typeof value.latestId === 'string' ? value.latestId : null);
        }
      }).catch(() => { if (!controller.signal.aborted) setError(true); });
    return () => controller.abort();
  }, [attempt]);
  const file = release?.available ? release.downloads[packageType] : null;
  const filename = `AnchorProposal${packageType === 'setup' ? '-Setup' : ''}${latestId && file ? `-${file.version}` : ''}.exe`;
  const downloadPath = latestId ? `/desktop/releases/${encodeURIComponent(latestId)}/windows/${packageType}` : `/desktop/windows${packageType === 'setup' ? '/setup' : ''}`;

  return <div className={styles.page}>
    <header className={styles.header}>
      <BrandMark variant="light" href={user ? '/dashboard' : '/login'} />
      <Link className={styles.backLink} href={user ? '/dashboard' : '/login'}>{user ? 'Back to workspace' : 'Sign in'} <ArrowRight size={16}/></Link>
    </header>
    <main className={styles.main}>
      <nav className={styles.platformNav} aria-label="Choose an app"><a href="#windows-app"><Monitor size={17}/>Windows app</a><a href="#chrome-extension"><Chrome size={17}/>Install Chrome extension <ArrowRight size={15}/></a></nav>
      <section id="windows-app" className={styles.hero} aria-labelledby="download-title">
        <div className={styles.intro}>
          <span className={styles.eyebrow}><span/> ANCHORPROPOSAL FOR WINDOWS</span>
          <h1 id="download-title">Your next move.<br/><span>One shortcut away.</span></h1>
          <p className={styles.lead}>Keep your applications moving, right beside the work you’re doing. A focused desktop companion for resumes and application answers.</p>
          <div className={styles.shortcut} aria-label="Default shortcut Control Shift Z"><kbd>Ctrl</kbd><span>+</span><kbd>Shift</kbd><span>+</span><kbd>Z</kbd><span className={styles.shortcutLabel}>Open. Create. Keep moving.</span></div>
          <div className={styles.benefits}><span><Check size={15}/> Setup or portable</span><span><Check size={15}/> Custom hotkeys</span><span><Check size={15}/> Dark interface</span></div>
        </div>

        <aside className={styles.downloadCard} aria-label="Windows download">
          <div className={styles.cardTop}><div className={styles.windowsIcon} aria-hidden><span/><span/><span/><span/></div><span className={styles.platformPill}>WINDOWS · 64-BIT</span></div>
          <h2>A little closer to your next role.</h2>
          <p>Download, open, and sign in with your AnchorProposal account.</p>
          <fieldset className={styles.packageOptions}>
            <legend className="sr-only">Choose your Windows download</legend>
            {(['setup', 'portable'] as const).map(kind => {
              const available = release?.available && Boolean(release.downloads[kind]);
              return <label key={kind} className={`${styles.packageOption} ${packageType === kind ? styles.selectedPackage : ''} ${!available ? styles.disabledPackage : ''}`}>
                <input type="radio" name="windows-package" value={kind} checked={packageType === kind} disabled={!available} onChange={() => setPackageType(kind)}/>
                <span><strong>{kind === 'setup' ? 'Setup installer' : 'Portable app'}</strong><small>{release?.available && !available ? 'Not published yet' : kind === 'setup' ? 'Install with shortcuts' : 'Run without installing'}</small></span>
              </label>;
            })}
          </fieldset>
          <div className={styles.releaseInfo} aria-live="polite">
            {file ? <><span>Version {file.version}</span><span>{(file.bytes / 1024 / 1024).toFixed(1)} MB</span><span>{packageType === 'setup' ? 'Setup installer' : 'Portable'}</span></> : <span>{error ? 'Unable to check the latest release' : release ? 'The Windows download is being prepared' : 'Checking the latest release…'}</span>}
          </div>
          {file ? <a className={styles.downloadButton} href={`${apiBase}${downloadPath}`} download={filename}><Download size={19}/> {packageType === 'setup' ? 'Download installer' : 'Download portable app'} <ArrowRight size={18}/></a> : <button className={styles.downloadButton} disabled>{!release && !error ? <LoaderCircle size={18} className={styles.spin}/> : <Download size={18}/>} {!release && !error ? 'Checking download…' : 'Download coming soon'}</button>}
          {(error || release?.available === false) && <div className={styles.unavailable} role="status"><p>{error ? 'We could not reach the download service. Please try again.' : 'The Windows app has not been published on this server yet. Please check back soon.'}</p><button onClick={() => setAttempt(value => value + 1)}><RefreshCw size={14}/> Check again</button></div>}
          <p className={styles.finePrint}>{packageType === 'setup' ? 'Choose an install folder and launch from your Start menu.' : 'A single file. Run it from a folder you’ll keep.'}<br/>An internet connection to your server is required.</p>
          <div className={styles.security}><ShieldCheck size={19}/><span>Your API key stays on the server.<br/>Your sign-in session is encrypted on Windows.</span></div>
          {file && <details className={styles.details}><summary>File details</summary><dl><dt>File name</dt><dd>{filename}</dd><dt>SHA-256 checksum</dt><dd className={styles.hash}>{file.sha256}</dd></dl><p>This build is unsigned. Windows may show an unrecognized publisher notice.</p></details>}
        </aside>
      </section>

      <ChromeExtensionInstall/>
      <section className={styles.versionHistory} aria-labelledby="versions-title">
        <div className={styles.historyHeading}><div><span className={styles.eyebrow}>RELEASE HISTORY</span><h2 id="versions-title">All versions</h2><p>Choose any published release for Windows.</p></div>{user?.role === 'MASTER' && <Link href="/settings#desktop">Manage releases <ArrowRight size={15}/></Link>}</div>
        {!versions.length ? <p className={styles.historyEmpty}>{error ? 'Version history could not be loaded. Use Check again above to retry.' : !release ? 'Loading versions…' : 'No version history has been published yet.'}</p> : <div className={styles.versionList}>{versions.map(version => <article key={version.id} className={styles.version} aria-label={`Version ${version.version}`}>
          <div className={styles.versionHeading}><h3>Version {version.version}</h3>{version.id === latestId && <span>Latest</span>}<time dateTime={version.publishedAt || version.createdAt}>{formatZonedDate(version.publishedAt || version.createdAt)}</time></div>
          {version.notes && <p className={styles.releaseNotes}>{version.notes}</p>}
          <div className={styles.versionFiles}>{(['setup', 'portable'] as const).map(kind => {
            const artifact = version.downloads[kind]; const name = kind === 'setup' ? 'Setup installer' : 'Portable app';
            return <div key={kind}>{artifact ? <><a href={`${apiBase}/desktop/releases/${encodeURIComponent(version.id)}/windows/${kind}`} download={`AnchorProposal${kind === 'setup' ? '-Setup' : ''}-${version.version}.exe`}><Download size={16}/>{name}<span>{(artifact.bytes / 1024 / 1024).toFixed(1)} MB</span></a><details><summary>SHA-256 checksum</summary><code>{artifact.sha256}</code></details></> : <p className={styles.missingPackage}>{name} · Not available</p>}</div>;
          })}</div>
        </article>)}</div>}
      </section>
      <section className={styles.features} aria-label="Desktop features">{features.map(({ icon: Icon, title, description }) => <article key={title}><div className={styles.featureIcon}><Icon size={22}/></div><h2>{title}</h2><p>{description}</p></article>)}</section>
      <section className={styles.setup} aria-labelledby="setup-title"><div><span className={styles.eyebrow}>READY IN THREE STEPS</span><h2 id="setup-title">Make room for a simpler routine.</h2></div><ol><li><span>01</span><div><Monitor size={19}/><h3>{packageType === 'setup' ? 'Install the app' : 'Open the app'}</h3><p>{packageType === 'setup' ? 'Run AnchorProposal-Setup.exe and follow the installer.' : 'Run AnchorProposal.exe from a folder you’ll keep.'} There’s no local server to install.</p></div></li><li><span>02</span><div><ShieldCheck size={19}/><h3>Sign in</h3><p>Use your existing account or create one. Your server address is already filled in.</p></div></li><li><span>03</span><div><FileCheck2 size={19}/><h3>Create your next application</h3><p>Press Ctrl + Shift + Z, paste the job description, and get started.</p></div></li></ol></section>
    </main>
    <footer className={styles.footer}><span>AnchorProposal apps &amp; extensions</span><Link href={user ? '/dashboard' : '/register'}>{user ? 'Continue in your browser' : 'Create an account'} <ArrowRight size={14}/></Link></footer>
  </div>;
}
