'use client';
import { useTimeZone } from '@/components/time-zone-settings';
import { formatZonedDate } from '@/lib/time-zone';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { LoaderCircle, Monitor, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { api, DesktopCatalog, DesktopPackageKind } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import styles from './desktop-release-manager.module.css';

const apiBase = (process.env.NEXT_PUBLIC_API_URL || '/backend').replace(/\/+$/, '');
const kinds = ['setup', 'portable'] as const;
const packageName = (kind: DesktopPackageKind) => kind === 'setup' ? 'Setup installer' : 'Portable app';

export function DesktopReleaseManager() {
  useTimeZone();
  const { isMaster } = useAuth();
  const [catalog, setCatalog] = useState<DesktopCatalog | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [version, setVersion] = useState('');
  const [notes, setNotes] = useState('');
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const load = useCallback(async () => {
    const value = await api.getDesktopReleases(); setCatalog(value); setError('');
    setDrafts(Object.fromEntries(value.releases.map(row => [row.id, row.notes])));
  }, []);
  useEffect(() => { if (isMaster) load().catch(err => setError(err.message || 'Could not load releases.')); }, [isMaster, load]);
  async function run(label: string, action: () => Promise<unknown>, success: string) {
    setBusy(label);
    try { await action(); await load(); toast.success(success); }
    catch (err) { toast.error(err instanceof Error ? err.message : 'Could not save this change.'); }
    finally { setBusy(''); }
  }
  async function upload(id: string, kind: DesktopPackageKind, file?: File) {
    if (!file) return;
    if (!/\.exe$/i.test(file.name) || file.size > 512 * 1024 * 1024) { toast.error('Choose a Windows .exe file up to 512 MB.'); return; }
    await run(`Uploading ${packageName(kind).toLowerCase()}… Keep this page open.`, () => api.uploadDesktopRelease(id, kind, file), 'File uploaded. Publish the release when it is ready.');
  }
  if (!isMaster) return null;
  return <section className={styles.manager} aria-labelledby="desktop-manager-title">
    <div className={styles.heading}><div><h2 id="desktop-manager-title"><Monitor size={21}/> Desktop releases</h2><p>Only Master can upload and manage releases. Published versions appear on the download page.</p></div><Link href="/download">View downloads ↗</Link></div>
    {error ? <div className={styles.error} role="alert">{error} <button onClick={() => load().catch(err => setError(err.message))}>Try again</button></div> : !catalog ? <p role="status">Loading releases…</p> : <>
      <form className={styles.create} onSubmit={event => { event.preventDefault(); void run('Creating release…', async () => { await api.createDesktopRelease(version, notes); setVersion(''); setNotes(''); }, 'Draft created. Add its Windows files below.'); }}>
        <h3>New version</h3><div className={styles.createFields}><label>Version<input required value={version} maxLength={64} placeholder="1.2.3" disabled={Boolean(busy)} onChange={event => setVersion(event.target.value)}/></label><label>Release notes<textarea value={notes} maxLength={10000} rows={2} placeholder="What changed in this version?" disabled={Boolean(busy)} onChange={event => setNotes(event.target.value)}/></label></div>
        <button className={styles.primary} disabled={Boolean(busy) || !version.trim()}>Create draft</button>
      </form>
      {busy && <p className={styles.progress} role="status"><LoaderCircle size={17} className={styles.spin}/>{busy}</p>}
      {!catalog.releases.length && <p className={styles.empty}>No releases yet. Create a version, upload its files, then publish it.</p>}
      <div className={styles.releases}>{catalog.releases.map(release => <article key={release.id} className={styles.release} aria-label={`Version ${release.version}`}>
        <div className={styles.releaseHeader}><h3>Version {release.version}</h3><span className={release.published ? styles.published : styles.draft}>{release.published ? 'Published' : 'Draft / hidden'}</span>{catalog.latestId === release.id && <span className={styles.latest}>Latest</span>}<time>{formatZonedDate(release.createdAt)}</time></div>
        <div className={styles.files}>{kinds.map(kind => {
          const file = release.downloads[kind]; const uploaded = release.uploaded?.[kind] || Boolean(file);
          return <div key={kind} className={styles.file}><h4>{packageName(kind)}</h4>{file ? <><p>{(file.bytes / 1024 / 1024).toFixed(1)} MB</p><details><summary>SHA-256 checksum</summary><code>{file.sha256}</code></details>{release.published && <a href={`${apiBase}/desktop/releases/${encodeURIComponent(release.id)}/windows/${kind}`}>Download file</a>}</> : <p>{uploaded ? 'File is missing from server storage. Remove it and upload again.' : 'No file uploaded'}</p>}
            {!release.published && (uploaded ? <button disabled={Boolean(busy)} onClick={() => { if (window.confirm(`Remove the ${packageName(kind).toLowerCase()} from version ${release.version}?`)) void run('Removing file…', () => api.removeDesktopReleaseFile(release.id, kind), 'File removed.'); }}>Remove file</button> : <label className={`${styles.upload} ${busy ? styles.disabled : ''}`}><Upload size={15}/> Upload .exe<input type="file" accept=".exe" aria-label={`Upload ${packageName(kind).toLowerCase()} for ${release.version}`} disabled={Boolean(busy)} onChange={event => { const chosen = event.target.files?.[0]; event.target.value = ''; void upload(release.id, kind, chosen); }}/></label>)}
          </div>;
        })}</div>
        <label className={styles.notes}>Release notes<textarea rows={3} maxLength={10000} value={drafts[release.id] ?? release.notes} disabled={Boolean(busy)} onChange={event => setDrafts(previous => ({ ...previous, [release.id]: event.target.value }))}/></label>
        <div className={styles.actions}>
          <button disabled={Boolean(busy) || drafts[release.id] === release.notes} onClick={() => void run('Saving notes…', () => api.updateDesktopRelease(release.id, { notes: drafts[release.id] }), 'Release notes saved.')}>Save notes</button>
          {release.published ? <><button disabled={Boolean(busy) || catalog.latestId === release.id} onClick={() => void run('Updating latest version…', () => api.updateDesktopRelease(release.id, { action: 'latest' }), 'Latest version updated.')}>Make latest</button><button disabled={Boolean(busy)} onClick={() => { if (window.confirm(`Hide version ${release.version}? Its public downloads will become unavailable.`)) void run('Hiding release…', () => api.updateDesktopRelease(release.id, { action: 'unpublish' }), 'Release hidden.'); }}>Hide release</button></> : <><button className={styles.primary} disabled={Boolean(busy) || (!release.downloads.setup && !release.downloads.portable)} onClick={() => void run('Publishing release…', () => api.updateDesktopRelease(release.id, { action: 'publish' }), 'Release published as the latest version.')}>Publish & make latest</button><button className={styles.danger} disabled={Boolean(busy)} onClick={() => { if (window.confirm(`Permanently delete version ${release.version} and its uploaded files?`)) void run('Deleting release…', () => api.deleteDesktopRelease(release.id), 'Release deleted.'); }}>Delete version</button></>}
        </div>
      </article>)}</div><p className={styles.help}>Windows x64 · Setup and portable .exe files · Maximum 512 MB per file. Hide a published release before replacing its files.</p>
    </>}
  </section>;
}
