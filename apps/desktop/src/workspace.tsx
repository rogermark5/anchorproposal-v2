import React, { Suspense, lazy, useEffect } from 'react';
import { LayoutDashboard, FileText, Users, Briefcase, Palette, UserCog, Settings, Keyboard, LogOut, Plus, ArrowLeft, ArrowRight, MonitorDown, Anchor } from 'lucide-react';
import Link, { usePathname, useRouter } from './navigation';
import { useAuth } from './auth-context';

const Dashboard = lazy(() => import('../../web/src/app/(dashboard)/dashboard/page'));
const Applications = lazy(() => import('../../web/src/app/(dashboard)/applications/page'));
const Application = lazy(() => import('../../web/src/app/(dashboard)/applications/[id]/page'));
const Resume = lazy(() => import('../../web/src/app/(dashboard)/applications/[id]/resume/page'));
const Profiles = lazy(() => import('../../web/src/app/(dashboard)/profiles/page'));
const Profile = lazy(() => import('../../web/src/app/(dashboard)/profiles/[id]/page'));
const NewProfile = lazy(() => import('../../web/src/app/(dashboard)/profiles/new/page'));
const Templates = lazy(() => import('../../web/src/app/(dashboard)/templates/page'));
const Template = lazy(() => import('../../web/src/app/(dashboard)/templates/[id]/page'));
const Designer = lazy(() => import('../../web/src/app/(dashboard)/templates/[id]/designer/page'));
const NewTemplate = lazy(() => import('../../web/src/app/(dashboard)/templates/new/page'));
const UserManagement = lazy(() => import('../../web/src/app/(dashboard)/users/page'));
const SettingsPage = lazy(() => import('../../web/src/app/(dashboard)/settings/page'));
const JobPool = lazy(() => import('../../web/src/app/(dashboard)/job-pool/page'));
const Downloads = lazy(() => import('../../web/src/components/desktop-download').then(m => ({ default: m.DesktopDownload })));
const nav = [
  ['/dashboard', 'Overview', LayoutDashboard, 'all'], ['/applications', 'Applications', FileText, 'bid'],
  ['/profiles', 'Profiles', Users, 'all'], ['/job-pool', 'Job pool', Briefcase, 'bid'],
  ['/templates', 'Templates', Palette, 'all'], ['/users', 'Team & permissions', UserCog, 'staff'],
  ['/settings', 'Platform settings', Settings, 'all'], ['/download', 'App versions', MonitorDown, 'all'],
] as const;

export default function Workspace({ preferences, hotkey }: { preferences: React.ReactNode; hotkey: string }) {
  const { user, isAdmin, canBid, logout } = useAuth();
  const path = usePathname(); const router = useRouter();
  useEffect(() => {
    if (path === '/applications/new') {
      router.replace('/applications');
      void window.anchor.window('new');
    }
  }, [path]);
  let Page: React.ComponentType = Dashboard;
  if (path === '/applications' || path === '/applications/new') Page = Applications;
  else if (/^\/applications\/[^/]+\/resume$/.test(path)) Page = Resume;
  else if (/^\/applications\/[^/]+$/.test(path)) Page = Application;
  else if (path === '/profiles') Page = Profiles;
  else if (path === '/profiles/new') Page = NewProfile;
  else if (path.startsWith('/profiles/')) Page = Profile;
  else if (path === '/templates') Page = Templates;
  else if (path === '/templates/new') Page = NewTemplate;
  else if (path.endsWith('/designer')) Page = Designer;
  else if (path.startsWith('/templates/')) Page = Template;
  else if (path === '/users') Page = UserManagement;
  else if (path === '/settings') Page = SettingsPage;
  else if (path === '/job-pool') Page = JobPool;
  else if (path === '/download') Page = Downloads;
  const label = nav.find(([url]) => path.startsWith(url))?.[1] || 'Desktop preferences';
  return <div className="desktop-workspace">
    <aside className="desktop-sidebar">
      <Link href="/dashboard" className="desktop-brand"><span><Anchor size={23}/></span><div>AnchorProposal<small>YOUR APPLICATION WORKSPACE</small></div></Link>
      {canBid && <button className="desktop-new" onClick={() => void window.anchor.window('new')}><Plus size={17}/> New application <kbd>{hotkey.replace('Control', 'Ctrl').replace('Shift', '⇧').replaceAll('+', ' ')}</kbd></button>}
      <p className="nav-caption">WORKSPACE</p>
      <nav>{nav.filter(([, , , access]) => access === 'all' || (access === 'bid' ? canBid : isAdmin)).map(([url, title, Icon]) => <Link key={url} href={url} className={path.startsWith(url) ? 'active' : ''}><Icon size={18}/><span>{title}</span></Link>)}</nav>
      <div className="desktop-sidebar-bottom"><Link href="/desktop-settings" className={path === '/desktop-settings' ? 'active' : ''}><Keyboard size={18}/> Desktop preferences</Link><div className="desktop-account"><span className="desktop-avatar">{user?.firstName?.[0]}{user?.lastName?.[0]}</span><div><strong>{user?.firstName} {user?.lastName}</strong><small>{user?.role.toLowerCase()}</small></div><button aria-label="Sign out" title="Sign out" onClick={() => void logout()}><LogOut size={17}/></button></div></div>
    </aside>
    <section className="desktop-content"><header className="desktop-breadcrumb"><div><button aria-label="Back" onClick={router.back}><ArrowLeft size={17}/></button><button aria-label="Forward" onClick={() => history.forward()}><ArrowRight size={17}/></button><span>Workspace <i>/</i> <strong>{label}</strong></span></div><span className="server-status"><i/> Connected to your server</span></header>
      <main className="desktop-page" key={path === '/settings' ? router.path : path}><Suspense fallback={<div className="desktop-loading">Loading {label.toLowerCase()}…</div>}>{path === '/desktop-settings' ? <div className="preferences-view">{preferences}</div> : <Page/>}</Suspense></main>
    </section>
  </div>;
}
