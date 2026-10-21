'use client';

import { useEffect, useState } from 'react';
import { Check, Chrome, Copy, Download, LoaderCircle, RefreshCw } from 'lucide-react';
import styles from './chrome-extension-install.module.css';

type Release = { version: string; bytes: number; sha256: string };

export function ChromeExtensionInstall() {
  const [release, setRelease] = useState<Release | null>(null);
  const [loading, setLoading] = useState(true);
  const [attempt, setAttempt] = useState(0);
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    fetch('/downloads/chrome/release.json', {
      signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]), cache: 'no-store',
    }).then(async response => {
      if (!response.ok) throw Error('Download unavailable');
      const value = await response.json();
      if (!/^\d+\.\d+\.\d+$/.test(value.version) || !Number.isFinite(value.bytes) || value.bytes <= 0 || !/^[a-f0-9]{64}$/.test(value.sha256)) throw Error('Invalid release');
      if (!controller.signal.aborted) setRelease(value);
    }).catch(() => { if (!controller.signal.aborted) setRelease(null); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [attempt]);
  const copyAddress = async () => {
    try { await navigator.clipboard.writeText('chrome://extensions'); setCopied(true); setCopyError(false); }
    catch { setCopyError(true); }
  };
  return <section id="chrome-extension" className={styles.section} aria-labelledby="chrome-install-title">
    <div className={styles.intro}>
      <span className={styles.eyebrow}><Chrome size={18}/> ANCHORPROPOSAL FOR CHROME</span>
      <h2 id="chrome-install-title">Your browser.<br/><span>Your next application.</span></h2>
      <p>Open a separate application in each browser tab, choose your profile, and generate together. Preview your resume and cover letter, download them automatically, and get answers for that job.</p>
      <ul className={styles.benefits}><li><Check size={15}/>Generate up to three resumes at once</li><li><Check size={15}/>Separate drafts and previews in every tab</li><li><Check size={15}/>Automatic downloads and Get answers</li></ul>
      <p className={styles.note}>This release is installed from a ZIP using Chrome’s Developer mode. It is not listed in the Chrome Web Store.</p>
    </div>
    <div className={styles.card}>
      <div className={styles.cardHeader}><Chrome size={28}/><span>CHROME 120+</span></div>
      <h3>Install in Chrome</h3>
      <p>Available on Windows, macOS and Linux.</p>
      <div className={styles.release} aria-live="polite">{release ? `Version ${release.version} · ${(release.bytes/1024).toFixed(0)} KB · ZIP archive` : loading ? 'Checking the extension download…' : 'The extension download is unavailable.'}</div>
      {release ? <a className={styles.download} href={`/downloads/chrome/AnchorProposal-Chrome-v${release.version}.zip`} download={`AnchorProposal-Chrome-v${release.version}.zip`}><Download size={18}/>Download Chrome extension</a> : <button className={styles.download} disabled>{loading ? <LoaderCircle size={18} className="animate-spin"/> : <Download size={18}/>}Download Chrome extension</button>}
      {!release && !loading && <button className={styles.retry} onClick={()=>setAttempt(value=>value+1)}><RefreshCw size={14}/>Check again</button>}
      <ol className={styles.steps}>
        <li><span>1</span><div><strong>Download and extract</strong><p>Unzip the download into a folder you will keep.</p></div></li>
        <li><span>2</span><div><strong>Open Chrome’s extension manager</strong><p>Paste <code>chrome://extensions</code> into Chrome’s address bar and turn on <b>Developer mode</b>.</p><button className={styles.copy} onClick={()=>void copyAddress()}>{copied ? <Check size={14}/> : <Copy size={14}/>} {copied ? 'Address copied' : 'Copy chrome://extensions'}</button>{copyError && <p role="status">Copy the address shown above into Chrome.</p>}</div></li>
        <li><span>3</span><div><strong>Load the extension</strong><p>Click <b>Load unpacked</b>, then choose the extracted folder containing <code>manifest.json</code>.</p></div></li>
        <li><span>4</span><div><strong>Pin, open and sign in</strong><p>Pin AnchorProposal from Chrome’s Extensions menu, click its icon, and sign in. Use <kbd>Alt + Shift + A</kbd> to open it.</p></div></li>
      </ol>
      <details className={styles.details}><summary>Updating an existing installation</summary><p>Replace the files in the same installation folder, then click Reload on AnchorProposal at <code>chrome://extensions</code>. Keep the folder to preserve your saved defaults and queue.</p></details>
      {release && <details className={styles.details}><summary>File checksum (SHA-256)</summary><code className={styles.hash}>{release.sha256}</code></details>}
    </div>
  </section>;
}
