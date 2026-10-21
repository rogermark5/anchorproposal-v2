'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard,
  FileText,
  Users,
  Briefcase,
  Palette,
  UserCog,
  Settings,
  MonitorDown,
  LogOut,
  X,
} from 'lucide-react';
import { useAuth } from '@/lib/auth-context';
import { BrandMark } from '@/components/brand-mark';
import { cn } from '@/lib/utils';

const navItems = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/applications', label: 'Applications', icon: FileText, bidOnly: true },
  { href: '/profiles', label: 'Profiles', icon: Users },
  { href: '/job-pool', label: 'Job Pool', icon: Briefcase },
  { href: '/templates', label: 'Templates', icon: Palette },
  { href: '/users', label: 'Users', icon: UserCog, staffOnly: true },
  { href: '/settings', label: 'Settings', icon: Settings },
  { href: '/download', label: 'Apps & extensions', icon: MonitorDown },
];

type SidebarProps = {
  /** Drawer mode on mobile */
  mobile?: boolean;
  open?: boolean;
  onClose?: () => void;
};

export function Sidebar({ mobile = false, open = true, onClose }: SidebarProps) {
  const pathname = usePathname();
  const { user, logout, isAdmin, canBid, isMaster } = useAuth();

  const visible = navItems.filter((item) => {
    if (item.staffOnly && !isAdmin) return false;
    if (item.bidOnly && !canBid) return false;
    return true;
  });

  const panel = (
    <aside
      className={cn(
        'bg-primary-deep text-white flex flex-col h-full',
        mobile ? 'w-[min(18rem,85vw)] shadow-2xl' : 'w-64 shrink-0 sticky top-0 h-screen',
      )}
    >
      <div className="px-5 py-6 border-b border-white/10 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <BrandMark variant="light" href="/dashboard" />
          <p className="text-[11px] text-white/50 mt-2 tracking-wide uppercase">AI Resume Platform</p>
        </div>
        {mobile && (
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-md text-white/70 hover:bg-white/10 hover:text-white shrink-0"
            aria-label="Close menu"
          >
            <X className="w-5 h-5" strokeWidth={1.5} />
          </button>
        )}
      </div>

      <nav className="flex-1 p-3 space-y-0.5 overflow-y-auto">
        {visible.map((item) => {
          const Icon = item.icon;
          const active = pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={() => onClose?.()}
              className={cn(
                'flex items-center gap-3 px-3 py-2.5 rounded-md text-sm font-medium transition-colors',
                active
                  ? 'bg-white/15 text-white'
                  : 'text-white/70 hover:bg-white/10 hover:text-white',
              )}
            >
              <Icon className="w-[18px] h-[18px]" strokeWidth={1.5} />
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div className="p-3 border-t border-white/10">
        <div className="px-3 py-2 mb-1">
          <p className="text-sm font-medium text-white truncate">
            {user?.firstName} {user?.lastName}
          </p>
          <p className="text-xs text-white/50">
            {isMaster ? 'Master' : user?.role === 'ADMIN' ? 'Admin' : 'Bidder'}
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            onClose?.();
            void logout();
          }}
          className="flex items-center gap-3 px-3 py-2.5 rounded-md text-sm text-white/70 hover:bg-white/10 hover:text-white w-full transition-colors"
        >
          <LogOut className="w-[18px] h-[18px]" strokeWidth={1.5} />
          Sign Out
        </button>
      </div>
    </aside>
  );

  if (!mobile) return panel;

  return (
    <div
      className={cn(
        'fixed inset-0 z-50 md:hidden',
        open ? 'pointer-events-auto' : 'pointer-events-none',
      )}
      aria-hidden={!open}
    >
      <button
        type="button"
        className={cn(
          'absolute inset-0 bg-black/50 transition-opacity',
          open ? 'opacity-100' : 'opacity-0',
        )}
        aria-label="Close menu"
        onClick={onClose}
      />
      <div
        className={cn(
          'absolute inset-y-0 left-0 transition-transform duration-200 ease-out',
          open ? 'translate-x-0' : '-translate-x-full',
        )}
      >
        {panel}
      </div>
    </div>
  );
}
