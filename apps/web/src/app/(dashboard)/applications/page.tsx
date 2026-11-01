'use client';
import { DateRangePicker, type DateRange } from '@/components/date-range-picker';
import { useTimeZone } from '@/components/time-zone-settings';
import { todayInTimeZone, formatZonedDate } from '@/lib/time-zone';
import { calendarDay } from '@anchorproposal/shared';

import { Suspense, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { GenerationPreviewDialog } from '@/components/generation-preview-dialog';
import type { ApplicationOption } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { STATUS_COLORS, formatStatus, formatDate, truncateText, hasRealJobUrl, cn, APPLICATION_STATUSES } from '@/lib/utils';
import { ApplicationFormFields } from '@/components/application-form-fields';
import { useApplicationValidation } from '@/lib/use-application-validation';
import {
  Plus,
  Search,
  Eye,
  Pencil,
  Trash2,
  FileText,
  FileType2,
  ExternalLink,
  X,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  Check,
  RefreshCw,
  AlertTriangle,
  Download,
  MessageSquare,
  Braces,
} from 'lucide-react';
import { LoadingSpinner } from '@/components/loading-spinner';
import { DefaultPromptWarning } from '@/components/default-prompt-warning';
import { GetAnswersDialog } from '@/components/get-answers';
import { ManualGenerationDialog } from '@/components/manual-generation-dialog';

type ProfileOption = {
  id: string;
  firstName: string;
  lastName: string;
  profileTitle: string;
  isDefault?: boolean;
};

interface LatestFiles {
  resumePdfId: string | null;
  resumeDocxId: string | null;
  coverLetterPdfId: string | null;
  coverLetterDocxId: string | null;
}

type AppWarning = {
  id?: string;
  category: string;
  matchedText: string;
  severity: string;
  behavior: string;
};

type PostCreatePhase = 'warnings' | 'confirm' | 'default-prompt' | 'progress' | 'download';

type PostCreateState = {
  appId: string;
  jobTitle: string;
  company: string;
  warnings: AppWarning[];
  phase: PostCreatePhase;
  templateId?: string;
  generationStatus?: string;
  generationId?: string;
  files?: LatestFiles;
  profileName?: string;
  defaultPromptName?: string;
};

interface Application {
  id: string;
  jobTitle: string;
  company: string;
  location: string | null;
  workArrangement?: string;
  source?: string | null;
  jobUrl?: string | null;
  jobDescription?: string;
  profileId?: string;
  status: string;
  createdAt: string;
  profile: { id?: string; firstName: string; lastName: string; profileTitle: string };
  bidder: { id?: string; firstName: string; lastName: string };
  warnings: { id: string }[];
  _count: { generations: number };
  latestGenerationId?: string | null;
  latestFiles?: LatestFiles;
}

type AppForm = {
  profileId: string;
  templateId: string;
  jobTitle: string;
  company: string;
  location: string;
  workArrangement: string;
  source: string;
  jobUrl: string;
  noJobLink: boolean;
  jobDescription: string;
};

const EMPTY_FORM: AppForm = {
  profileId: '',
  templateId: '',
  jobTitle: '',
  company: '',
  location: '',
  workArrangement: 'REMOTE',
  source: '',
  jobUrl: '',
  noJobLink: false,
  jobDescription: '',
};

const STATUS_CHIPS: { label: string; value: string }[] = [
  { label: 'All', value: '' },
  ...APPLICATION_STATUSES.map((value) => ({
    label: formatStatus(value),
    value,
  })),
];

const PAGE_SIZE = 15;
const BASE_COL_COUNT = 12;

type AppsTab = 'mine' | 'team' | 'all';

function warningsAllowGenerate(warnings: AppWarning[]): boolean {
  return !warnings.some((w) => w.category !== 'DUPLICATE' && (w.behavior === 'BLOCK' || w.behavior === 'ADMIN_REVIEW'));
}

function formatGenerationStatus(status?: string): string {
  switch (status) {
    case 'QUEUED':
      return 'Queued…';
    case 'VALIDATING':
      return 'Validating…';
    case 'GENERATING':
      return 'Generating resume content…';
    case 'RENDERING':
      return 'Rendering PDF & DOCX…';
    case 'UPLOADING':
      return 'Saving files…';
    case 'COMPLETED':
      return 'Completed';
    case 'FAILED':
      return 'Failed';
    default:
      return status ? `${status}…` : 'Starting…';
  }
}

function formatShortDate(date: string) {
  return formatZonedDate(date, { month: 'numeric', day: 'numeric', year: 'numeric' });
}

async function downloadFile(fileId: string, filename: string) {
  await api.downloadDocument(fileId, filename);
}

const STATUS_MENU: string[] = [...APPLICATION_STATUSES];

function StatusBadgeDropdown({
  status,
  onChange,
  disabled,
}: {
  status: string;
  onChange: (status: string) => Promise<void>;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [coords, setCoords] = useState<{ top: number; left: number }>({ top: 0, left: 0 });
  const btnRef = useRef<HTMLButtonElement>(null);

  const menu = STATUS_MENU.includes(status) ? STATUS_MENU : [status, ...STATUS_MENU];

  const getMenuPosition = useCallback(() => {
    const btn = btnRef.current;
    if (!btn) return { top: 0, left: 0 };
    const rect = btn.getBoundingClientRect();
    const menuWidth = 144;
    const menuHeight = menu.length * 36 + 8;
    const padding = 8;
    let left = rect.left;
    let top = rect.bottom + 4;

    if (left + menuWidth > window.innerWidth - padding) {
      left = Math.max(padding, window.innerWidth - menuWidth - padding);
    }
    if (top + menuHeight > window.innerHeight - padding && rect.top > menuHeight + padding) {
      top = rect.top - menuHeight - 4;
    }
    return { top, left };
  }, [menu.length]);

  const openMenu = () => {
    setCoords(getMenuPosition());
    setOpen(true);
  };

  useEffect(() => {
    if (!open) return;
    const onReposition = () => setCoords(getMenuPosition());
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('resize', onReposition);
    window.addEventListener('scroll', onReposition, true);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('resize', onReposition);
      window.removeEventListener('scroll', onReposition, true);
      window.removeEventListener('keydown', onKey);
    };
  }, [open, getMenuPosition]);

  const handlePick = async (next: string) => {
    setOpen(false);
    if (next === status) return;
    setBusy(true);
    try {
      await onChange(next);
    } finally {
      setBusy(false);
    }
  };

  const menuNode =
    open && typeof document !== 'undefined'
      ? createPortal(
          <div className="fixed inset-0 z-[200]" role="presentation">
            <button
              type="button"
              aria-label="Close status menu"
              className="absolute inset-0 cursor-default bg-transparent"
              onClick={() => setOpen(false)}
            />
            <div
              role="listbox"
              aria-label="Change status"
              className="absolute w-36 rounded-lg border border-[var(--border)] bg-white py-1 shadow-xl"
              style={{ top: coords.top, left: coords.left }}
              onClick={(e) => e.stopPropagation()}
            >
              {menu.map((s) => (
                <button
                  key={s}
                  type="button"
                  role="option"
                  aria-selected={s === status}
                  onClick={() => handlePick(s)}
                  className="flex w-full items-center justify-between gap-2 px-2.5 py-1.5 text-left hover:bg-slate-50"
                >
                  <span
                    className={cn(
                      'inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium',
                      STATUS_COLORS[s] || 'bg-gray-100 text-gray-700',
                    )}
                  >
                    {formatStatus(s)}
                  </span>
                  {s === status && <Check className="h-3.5 w-3.5 shrink-0 text-primary" />}
                </button>
              ))}
            </div>
          </div>,
          document.body,
        )
      : null;

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        disabled={disabled || busy}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => (open ? setOpen(false) : openMenu())}
        className={cn(
          'inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium transition-opacity',
          STATUS_COLORS[status] || 'bg-gray-100 text-gray-700',
          busy && 'opacity-60',
          !disabled && 'cursor-pointer hover:opacity-80',
        )}
        title="Change status"
      >
        {formatStatus(status)}
        {!disabled && <ChevronDown className="h-3 w-3 opacity-70" />}
      </button>
      {menuNode}
    </>
  );
}

function IconBtn({
  title,
  disabled,
  onClick,
  className,
  children,
  href,
}: {
  title: string;
  disabled?: boolean;
  onClick?: () => void;
  className?: string;
  children: ReactNode;
  href?: string;
}) {
  const base =
    'inline-flex items-center justify-center p-1 rounded text-slate-500 hover:bg-slate-100 disabled:opacity-25 disabled:pointer-events-none transition-colors';
  if (href && !disabled) {
    return (
      <Link href={href} title={title} className={cn(base, className)}>
        {children}
      </Link>
    );
  }
  return (
    <button type="button" title={title} disabled={disabled} onClick={onClick} className={cn(base, className)}>
      {children}
    </button>
  );
}

export default function ApplicationsPage() {
  return (
    <Suspense fallback={<div className="p-6 text-sm text-slate-500">Loading applications…</div>}>
      <ApplicationsPageInner />
    </Suspense>
  );
}

function ApplicationsPageInner() {
  const { canBid, isAdmin, user } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const isTrueAdmin = user?.role === 'ADMIN';
  const tabParam = searchParams.get('tab');
  const appsTab: AppsTab =
    isTrueAdmin && tabParam === 'team'
      ? 'team'
      : isTrueAdmin && tabParam === 'all'
        ? 'all'
        : 'mine';
  const showBidderCol = isTrueAdmin && (appsTab === 'team' || appsTab === 'all');
  const showDateNav = true;
  const { timeZone } = useTimeZone();
  const colCount = BASE_COL_COUNT + (showBidderCol ? 1 : 0);

  const [apps, setApps] = useState<Application[]>([]);
  const [profiles, setProfiles] = useState<ProfileOption[]>([]);
  const [createTemplates, setCreateTemplates] = useState<
    { id: string; name: string; isPublished: boolean; isDefault?: boolean }[]
  >([]);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [dateRange, setDateRange] = useState<DateRange>(() => { const today = todayInTimeZone(); return { from: today, to: today }; });
  const [page, setPage] = useState(1);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const hasLoaded = useRef(false);
  const [previewFor, setPreviewFor] = useState<{ applicationId: string; initialGenerationId?: string } | null>(null);

  const [showCreate, setShowCreate] = useState(false);
  const [editApp, setEditApp] = useState<Application | null>(null);
  const [deleteApp, setDeleteApp] = useState<Application | null>(null);
  const [form, setForm] = useState<AppForm>(EMPTY_FORM);
  const draftValidation = useApplicationValidation(form, showCreate);
  const [locations, setLocations] = useState<ApplicationOption[]>([]);
  const [sources, setSources] = useState<ApplicationOption[]>([]);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [postCreate, setPostCreate] = useState<PostCreateState | null>(null);
  const [manualFor, setManualFor] = useState<{
    appId: string; jobTitle: string; company: string; templateId?: string;
  } | null>(null);
  const [startingGeneration, setStartingGeneration] = useState<string | null>(null);
  const generationRequestLock = useRef(false);
  const generationStartLock = useRef(false);
  const [answersFor, setAnswersFor] = useState<{ generationId: string; jobTitle: string } | null>(null);
  const [buildingFile, setBuildingFile] = useState<{
    key: string;
    label: string;
  } | null>(null);
  const exportLock = useRef(false);
  const postCreateBusy = postCreate?.phase === 'progress' || buildingFile !== null;

  useEffect(() => {
    if (!canBid) router.replace('/dashboard');
  }, [canBid, router]);

  const loadProfiles = useCallback(async () => {
    if (isAdmin) {
      const all = (await api.getProfiles()) as ProfileOption[];
      setProfiles(all);
      return all;
    }
    const assignments = (await api.getAssignedProfiles()) as {
      profileId: string;
      isDefault: boolean;
      profile: ProfileOption;
    }[];
    const list = assignments.map((a) => ({
      ...a.profile,
      id: a.profileId,
      isDefault: a.isDefault,
    }));
    setProfiles(list);
    return list;
  }, [isAdmin]);

  const loadOptions = useCallback(async () => {
    const data = await api.getApplicationOptions();
    setLocations(data.locations);
    setSources(data.sources);
    return data;
  }, []);

  const buildNewForm = useCallback(
    (
      profileList: ProfileOption[],
      locationList: ApplicationOption[],
      sourceList: ApplicationOption[],
      templateList: { id: string; name: string; isDefault?: boolean }[] = [],
    ): AppForm => {
      const defaultProfile = profileList.find((p) => p.isDefault) || profileList[0];
      const defaultLocation = locationList.find((o) => o.isDefault) || locationList[0];
      const defaultSource = sourceList.find((o) => o.isDefault) || sourceList[0];
      const defaultTemplate = templateList.find((t) => t.isDefault) || templateList[0];
      return {
        ...EMPTY_FORM,
        profileId: defaultProfile?.id || '',
        templateId: defaultTemplate?.id || '',
        location: defaultLocation?.value || '',
        source: defaultSource?.value || '',
        workArrangement: 'REMOTE',
      };
    },
    [],
  );

  const openCreate = useCallback(async () => {
    try {
      const [profileList, optionData, templateData] = await Promise.all([
        profiles.length ? Promise.resolve(profiles) : loadProfiles(),
        loadOptions(),
        isTrueAdmin
          ? (api.getTemplates() as Promise<
              { id: string; name: string; isPublished: boolean; isDefault?: boolean }[]
            >)
          : Promise.resolve([]),
      ]);
      const published = templateData.filter((t) => t.isPublished);
      if (isTrueAdmin) setCreateTemplates(published);
      setForm(buildNewForm(profileList, optionData.locations, optionData.sources, published));
      setShowCreate(true);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to open form');
    }
  }, [profiles, loadProfiles, loadOptions, buildNewForm, isTrueAdmin]);

  useEffect(() => {
    if (searchParams.get('new') !== '1' || !canBid) return;
    let cancelled = false;
    (async () => {
      try {
        const [profileList, optionData] = await Promise.all([loadProfiles(), loadOptions()]);
        if (cancelled) return;
        setForm(buildNewForm(profileList, optionData.locations, optionData.sources));
        setShowCreate(true);
      } catch (err) {
        if (!cancelled) {
          toast.error(err instanceof Error ? err.message : 'Failed to open form');
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // Intentionally only when query/canBid changes — not when helpers recreate
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, canBid]);

  const setAppsTab = useCallback(
    (tab: AppsTab) => {
      const params = new URLSearchParams(searchParams.toString());
      if (tab === 'mine') params.delete('tab');
      else params.set('tab', tab);
      const qs = params.toString();
      router.replace(qs ? `/applications?${qs}` : '/applications');
    },
    [router, searchParams],
  );

  const buildListParams = useCallback(() => {
    const params: Record<string, string> = { from: dateRange.from, to: dateRange.to, timeZone };
    if (statusFilter) params.status = statusFilter;
    if (isTrueAdmin && (appsTab === 'mine' || appsTab === 'team')) {
      params.scope = appsTab;
    }
    return params;
  }, [statusFilter, isTrueAdmin, appsTab, dateRange.from, dateRange.to, timeZone]);

  const listRequest = useRef(0);
  const load = useCallback(async () => {
    const request = ++listRequest.current;
    if (!hasLoaded.current) setLoading(true);
    try {
      const data = (await api.getApplications(buildListParams())) as Application[];
      if (request === listRequest.current) { setApps(data); hasLoaded.current = true; }
    } catch (err) {
      if (request === listRequest.current) toast.error(err instanceof Error ? err.message : 'Failed to load applications');
    } finally {
      if (request === listRequest.current) setLoading(false);
    }
  }, [buildListParams]);

  useEffect(() => {
    const refresh = () => { if (canBid) { api.invalidateCache(); void load(); } };
    window.addEventListener('focus', refresh);
    const off = (window as any).anchor?.onEvent((event: any) => {
      if (event.type === 'data-changed' && /^\/(applications|generations)/.test(event.route) || event.type === 'job' && event.job?.stage === 'completed') refresh();
    });
    return () => { window.removeEventListener('focus', refresh); off?.(); };
  }, [canBid, load]);

  useEffect(() => {
    if (!canBid) return;
    void load();
    return () => { listRequest.current++; };
  }, [canBid, load]);

  useEffect(() => {
    if (!canBid) return;
    loadProfiles().catch(() => undefined);
  }, [canBid, loadProfiles]);

  useEffect(() => {
    setPage(1);
    setSelectedIds(new Set());
  }, [search, statusFilter, dateRange.from, dateRange.to, appsTab]);

  const dateFilterActive = true;

  const filteredApps = useMemo(() => {
    const q = search.trim().toLowerCase();
    return apps.filter((app) => {
      const day = calendarDay(app.createdAt, timeZone);
      if (day < dateRange.from || day > dateRange.to) return false;
      if (!q) return true;
      const profileName = `${app.profile?.firstName || ''} ${app.profile?.lastName || ''}`.toLowerCase();
      const bidderName = `${app.bidder?.firstName || ''} ${app.bidder?.lastName || ''}`.toLowerCase();
      return (
        app.jobTitle.toLowerCase().includes(q) ||
        app.company.toLowerCase().includes(q) ||
        (app.location || '').toLowerCase().includes(q) ||
        (app.source || '').toLowerCase().includes(q) ||
        profileName.includes(q) ||
        bidderName.includes(q)
      );
    });
  }, [apps, search, dateRange.from, dateRange.to, timeZone]);

  const totalPages = Math.max(1, Math.ceil(filteredApps.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const pageApps = filteredApps.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  const allPageSelected = pageApps.length > 0 && pageApps.every((a) => selectedIds.has(a.id));
  const somePageSelected = pageApps.some((a) => selectedIds.has(a.id));

  const toggleSelectAll = () => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (allPageSelected) {
        pageApps.forEach((a) => next.delete(a.id));
      } else {
        pageApps.forEach((a) => next.add(a.id));
      }
      return next;
    });
  };

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const openEdit = async (app: Application) => {
    try {
      if (!profiles.length) await loadProfiles();
      await loadOptions();
      const full = (await api.getApplication(app.id)) as Record<string, unknown>;
      const url = (full.jobUrl as string) || '';
      const noLink = !hasRealJobUrl(url);
      setForm({
        profileId: (full.profileId as string) || app.profile?.id || '',
        templateId: '',
        jobTitle: (full.jobTitle as string) || '',
        company: (full.company as string) || '',
        location: (full.location as string) || '',
        workArrangement: (full.workArrangement as string) || 'REMOTE',
        source: (full.source as string) || '',
        jobUrl: noLink ? '' : url,
        noJobLink: noLink,
        jobDescription: (full.jobDescription as string) || '',
      });
      setEditApp(app);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load application');
    }
  };

  const handleCreate = async () => {
    if (!draftValidation.canSave) { toast.error("Review the job description validation before creating an application."); return; }
    if (!form.profileId || !form.jobTitle.trim() || !form.company.trim() || !form.jobDescription.trim()) {
      toast.error('Profile, job title, company, and description are required');
      return;
    }
    if (isTrueAdmin && !form.templateId) {
      toast.error('Select a template for resume generation');
      return;
    }
    setSaving(true);
    try {
      const { templateId, noJobLink, ...rest } = form;
      const createPayload = {
        ...rest,
        jobUrl: noJobLink ? '' : form.jobUrl.trim(),
      };
      const created = (await api.createApplication(createPayload)) as {
        id: string;
        jobTitle?: string;
        company?: string;
        warnings?: AppWarning[];
      };
      setShowCreate(false);
      setForm(EMPTY_FORM);
      await load();
      if (searchParams.get('new') === '1') {
        router.replace('/applications');
      }
      const warnings = Array.isArray(created.warnings) ? created.warnings : [];
      setPostCreate({
        appId: created.id,
        jobTitle: created.jobTitle || form.jobTitle,
        company: created.company || form.company,
        warnings,
        phase: warnings.length > 0 ? 'warnings' : 'confirm',
        templateId: templateId || undefined,
      });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to create application');
    } finally {
      setSaving(false);
    }
  };

  const closePostCreate = useCallback((savedToast = true) => {
    setPostCreate(null);
    if (savedToast) toast.success('Application saved');
  }, []);

  const pollGeneration = useCallback(async (generationId: string, maxAttempts = 240) => {
    for (let i = 0; i < maxAttempts; i++) {
      await new Promise((r) => setTimeout(r, 2000));
      try {
        const gen = await api.getGeneration(generationId);
        const status = gen.status as string;
        setPostCreate((prev) =>
          prev && prev.phase === 'progress' ? { ...prev, generationStatus: status } : prev,
        );
        if (status === 'COMPLETED' || status === 'FAILED' || status === 'CANCELLED') {
          return {
            status,
            errorMessage: (gen.errorMessage as string | null | undefined) || null,
          };
        }
      } catch {
        /* keep polling */
      }
    }
    return { status: 'PENDING', errorMessage: 'The resume is still processing. Check the application History tab before starting another generation.' };
  }, []);

  const startPostCreateGeneration = useCallback(
    async (appId: string, templateId?: string) => {
      if (generationStartLock.current) return;
      generationStartLock.current = true;
      setPostCreate((prev) =>
        prev ? { ...prev, phase: 'progress', generationStatus: 'QUEUED' } : prev,
      );
      try {
        let chosenId = templateId;
        if (!chosenId) {
          const templates = (await api.getTemplates()) as {
            id: string;
            isPublished: boolean;
            isDefault?: boolean;
          }[];
          const published = templates.filter((t) => t.isPublished);
          chosenId = (published.find((t) => t.isDefault) || published[0])?.id;
        }
        const started = (await api.startGeneration(appId, chosenId)) as {
          id: string;
          status: string;
        };
        setPostCreate((prev) =>
          prev
            ? { ...prev, phase: 'progress', generationId: started.id, generationStatus: started.status || 'QUEUED' }
            : prev,
        );
        const terminal = await pollGeneration(started.id);
        if (terminal.status === 'COMPLETED') {
          setPostCreate(null);
          setPreviewFor({ applicationId: appId, initialGenerationId: started.id });
          api.invalidateCache();
          await load();
          toast.success('Resume and cover letter are ready to preview.');
        } else {
          if (terminal.status === 'CANCELLED') toast.message('Generation cancelled. Your application is saved.');
          else toast.error(terminal.errorMessage || 'Generation failed');
          setPostCreate(null);
          await load();
        }
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Generation failed');
        setPostCreate(null);
        await load();
      } finally {
        generationStartLock.current = false;
      }
    },
    [pollGeneration, load],
  );

  const requestPostCreateGeneration = useCallback(
    async (appId: string, templateId?: string) => {
      try {
        const preview = await api.previewGenerationPrompt(appId);
        if (preview.usedDefault) {
          setPostCreate((prev) =>
            prev
              ? {
                  ...prev,
                  phase: 'default-prompt',
                  templateId,
                  profileName: preview.profileName,
                  defaultPromptName: preview.promptName,
                }
              : prev,
          );
          return;
        }
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Failed to check the profile prompt');
        setPostCreate(null);
        return;
      }
      await startPostCreateGeneration(appId, templateId);
    },
    [startPostCreateGeneration],
  );

  const regenerateInPlace = async (app: Application) => {
    if (generationRequestLock.current || postCreate || manualFor) return;
    generationRequestLock.current = true;
    setStartingGeneration(app.id);
    try {
      const full = await api.getApplication(app.id) as { warnings?: AppWarning[] };
      const warnings = Array.isArray(full.warnings) ? full.warnings : [];
      setPostCreate({
        appId: app.id, jobTitle: app.jobTitle, company: app.company,
        warnings, phase: warnings.length ? 'warnings' : 'progress',
        generationStatus: 'QUEUED',
      });
      if (!warnings.length) await requestPostCreateGeneration(app.id);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to start generation');
    } finally {
      generationRequestLock.current = false;
      setStartingGeneration(null);
    }
  };

  const openManualGeneration = (target: { appId: string; jobTitle: string; company: string; templateId?: string }) => {
    setPostCreate(null);
    setManualFor(target);
  };

  const completeManualGeneration = (generationId: string) => {
    if (!manualFor) return;
    setPostCreate(null);
    setPreviewFor({ applicationId: manualFor.appId, initialGenerationId: generationId });
    setManualFor(null);
    void load();
    toast.success('Documents saved and ready to preview.');
  };

  const handleEdit = async () => {
    if (!editApp) return;
    if (!form.profileId || !form.jobTitle.trim() || !form.company.trim() || !form.jobDescription.trim()) {
      toast.error('Profile, job title, company, and description are required');
      return;
    }
    setSaving(true);
    try {
      await api.updateApplication(editApp.id, {
        profileId: form.profileId,
        jobTitle: form.jobTitle,
        company: form.company,
        location: form.location,
        workArrangement: form.workArrangement,
        source: form.source,
        jobUrl: form.noJobLink ? '' : form.jobUrl.trim(),
        jobDescription: form.jobDescription,
      });
      toast.success('Application updated');
      setEditApp(null);
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to update application');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteApp) return;
    setDeleting(true);
    try {
      await api.deleteApplication(deleteApp.id);
      toast.success('Application deleted');
      setDeleteApp(null);
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to delete application');
    } finally {
      setDeleting(false);
    }
  };

  const handleStatusChange = async (appId: string, status: string) => {
    try {
      await api.updateApplicationStatus(appId, status);
      setApps((prev) => prev.map((a) => (a.id === appId ? { ...a, status } : a)));
      toast.success(`Status changed to ${formatStatus(status)}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to change status');
    }
  };

  const handleDownload = async (fileId: string | null | undefined, filename: string) => {
    if (!fileId) return;
    try {
      await downloadFile(fileId, filename);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Download failed');
    }
  };

  const handleExport = async (
    generationId: string,
    kind: 'RESUME' | 'COVER_LETTER',
    type: 'PDF' | 'DOCX',
    filename: string,
    existingId?: string | null,
  ) => {
    if (exportLock.current) return;
    exportLock.current = true;
    const key = `${generationId}:${kind}:${type}`;
    const label =
      kind === 'RESUME'
        ? type === 'PDF'
          ? 'Resume PDF'
          : 'Resume DOCX'
        : type === 'PDF'
          ? 'Cover letter PDF'
          : 'Cover letter DOCX';
    setBuildingFile({ key, label });
    try {
      const file = await api.exportGenerationFile(generationId, { kind, type });
      await downloadFile(file.id, file.filename || filename);
      {
        const field =
          kind === 'RESUME'
            ? type === 'PDF'
              ? 'resumePdfId'
              : 'resumeDocxId'
            : type === 'PDF'
              ? 'coverLetterPdfId'
              : 'coverLetterDocxId';
        setApps((prev) =>
          prev.map((app) =>
            app.latestGenerationId === generationId
              ? {
                  ...app,
                  latestFiles: {
                    resumePdfId: app.latestFiles?.resumePdfId ?? null,
                    resumeDocxId: app.latestFiles?.resumeDocxId ?? null,
                    coverLetterPdfId: app.latestFiles?.coverLetterPdfId ?? null,
                    coverLetterDocxId: app.latestFiles?.coverLetterDocxId ?? null,
                    [field]: file.id,
                  },
                }
              : app,
          ),
        );
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Download failed');
    } finally {
      exportLock.current = false;
      setBuildingFile(null);
    }
  };

  if (!canBid) return null;

  const thClass =
    'text-left px-2 py-2.5 font-medium text-[11px] uppercase tracking-wide text-slate-400 whitespace-nowrap';
  const tdClass = 'px-2 py-2 text-sm text-slate-600 whitespace-nowrap max-w-[10rem]';

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
        <div>
          <h1 className="text-2xl font-semibold text-slate-800 tracking-tight">Applications</h1>
          <p className="text-slate-500 mt-0.5 text-sm">Manage and track job applications</p>
        </div>
        <button
          type="button"
          onClick={openCreate}
          className="btn-primary"
        >
          <Plus className="w-4 h-4" /> New Application
        </button>
      </div>

      {isTrueAdmin && (
        <div className="mb-4 flex gap-1 border-b border-[var(--border)] overflow-x-auto">
          {(
            [
              { id: 'mine' as const, label: 'My Applications', short: 'Mine' },
              { id: 'team' as const, label: 'Bidder Applications', short: 'Bidders' },
              { id: 'all' as const, label: 'All Applications', short: 'All' },
            ] as const
          ).map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setAppsTab(tab.id)}
              className={cn(
                'px-3 sm:px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors whitespace-nowrap shrink-0',
                appsTab === tab.id
                  ? 'border-primary text-primary'
                  : 'border-transparent text-slate-500 hover:text-slate-800',
              )}
            >
              <span className="sm:hidden">{tab.short}</span>
              <span className="hidden sm:inline">{tab.label}</span>
            </button>
          ))}
        </div>
      )}

      <div className="bg-white border border-[var(--border)] rounded-xl shadow-sm">
        {/* Date navigator — hidden on admin All Applications */}
        {showDateNav && (
          <div className="px-4 pt-4 pb-2 flex justify-center">
            <DateRangePicker value={dateRange} onChange={setDateRange} />
          </div>
        )}


        {/* Search */}
        <div className={cn('px-4 pb-3', !showDateNav && 'pt-4')}>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input
              type="text"
              placeholder="Search all applications..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-10 pr-4 py-2.5 border border-[var(--border)] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
            />
          </div>
        </div>

        {/* Status chips */}
        <div className="px-4 pb-3 flex flex-wrap gap-1 border-b border-slate-100">
          {STATUS_CHIPS.map((chip) => (
            <button
              key={chip.label}
              type="button"
              onClick={() => setStatusFilter(chip.value)}
              className={cn(
                'px-3 py-1.5 text-sm rounded-lg transition-colors',
                statusFilter === chip.value
                  ? 'bg-primary text-white font-medium'
                  : 'text-slate-600 hover:bg-slate-100',
              )}
            >
              {chip.label}
            </button>
          ))}
          {selectedIds.size > 0 && (
            <span className="ml-auto self-center text-xs text-slate-500">
              {selectedIds.size} selected
            </span>
          )}
        </div>

        <div className="overflow-x-auto overflow-y-visible">
          <table className="w-full text-sm min-w-[1100px]">
            <thead>
              <tr className="border-b border-[var(--border)] bg-slate-50/80">
                <th className={cn(thClass, 'sticky left-0 z-10 bg-slate-50/95 w-10')}>
                  <input
                    type="checkbox"
                    checked={allPageSelected}
                    ref={(el) => {
                      if (el) el.indeterminate = somePageSelected && !allPageSelected;
                    }}
                    onChange={toggleSelectAll}
                    className="rounded border-slate-300"
                    aria-label="Select all on page"
                  />
                </th>
                <th className={cn(thClass, 'sticky left-10 z-10 bg-slate-50/95 w-10')}>No</th>
                <th className={thClass}>Title</th>
                <th className={thClass}>Company</th>
                <th className={thClass}>Location</th>
                <th className={thClass}>Source</th>
                <th className={thClass}>Profile</th>
                {showBidderCol && <th className={thClass}>Bidder</th>}
                <th className={thClass}>Status</th>
                <th className={thClass}>Date</th>
                <th className={thClass}>Resume</th>
                <th className={thClass}>Cover Letter</th>
                <th className={thClass}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={colCount} className="px-4 py-10 text-center text-slate-500">
                    Loading...
                  </td>
                </tr>
              ) : pageApps.length === 0 ? (
                <tr>
                  <td colSpan={colCount} className="px-4 py-10 text-center text-slate-500">
                    No applications found
                    {dateFilterActive ? ' for this date' : ''}
                  </td>
                </tr>
              ) : (
                pageApps.map((app, idx) => {
                  const files = app.latestFiles;
                  const rowNo = (currentPage - 1) * PAGE_SIZE + idx + 1;
                  const profileName = `${app.profile?.firstName || ''} ${app.profile?.lastName || ''}`.trim();
                  const bidderName = `${app.bidder?.firstName || ''} ${app.bidder?.lastName || ''}`.trim();
                  const isSelected = selectedIds.has(app.id);
                  const stickyBg = isSelected ? 'bg-primary/[0.04]' : 'bg-white';
                  return (
                    <tr
                      key={app.id}
                      className={cn(
                        'border-b border-slate-100 hover:bg-slate-50/90 group',
                        isSelected && 'bg-primary/5',
                      )}
                    >
                      <td className={cn('px-2 py-2 sticky left-0 z-10', stickyBg, 'group-hover:bg-slate-50')}>
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggleSelect(app.id)}
                          className="rounded border-slate-300"
                          aria-label={`Select ${app.jobTitle}`}
                        />
                      </td>
                      <td
                        className={cn(
                          'px-2 py-2 text-xs text-slate-400 sticky left-10 z-10 tabular-nums',
                          stickyBg,
                          'group-hover:bg-slate-50',
                        )}
                      >
                        {rowNo}
                      </td>
                      <td className={cn(tdClass, 'max-w-[11rem] w-[11rem]')}>
                        <span className="inline-flex items-center gap-1 min-w-0 max-w-full">
                          {hasRealJobUrl(app.jobUrl) ? (
                            <a
                              href={app.jobUrl!}
                              target="_blank"
                              rel="noopener noreferrer"
                              title={app.jobTitle}
                              className="text-primary hover:underline font-medium inline-flex items-center gap-1 min-w-0 max-w-full"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <span className="truncate">{truncateText(app.jobTitle, 25)}</span>
                              <ExternalLink className="w-3 h-3 shrink-0 opacity-60" />
                            </a>
                          ) : (
                            <span title={app.jobTitle} className="font-medium text-slate-800 truncate">
                              {truncateText(app.jobTitle, 25)}
                            </span>
                          )}
                          {app.warnings?.length > 0 && (
                            <span className="text-amber-500 text-xs shrink-0" title="Has warnings">
                              ⚠
                            </span>
                          )}
                        </span>
                      </td>
                      <td className={cn(tdClass, 'max-w-[10rem]')} title={app.company}>
                        <span className="truncate block">{truncateText(app.company, 25)}</span>
                      </td>
                      <td className={tdClass} title={app.location || undefined}>
                        <span className="truncate block">{app.location || '—'}</span>
                      </td>
                      <td className={tdClass} title={app.source || undefined}>
                        <span className="truncate block">{app.source || '—'}</span>
                      </td>
                      <td className={tdClass} title={profileName}>
                        <span className="truncate block">{profileName || '—'}</span>
                      </td>
                      {showBidderCol && (
                        <td className={tdClass} title={bidderName}>
                          <span className="truncate block">{bidderName || '—'}</span>
                        </td>
                      )}
                      <td className="px-2 py-2">
                        <StatusBadgeDropdown
                          status={app.status}
                          onChange={(status) => handleStatusChange(app.id, status)}
                        />
                      </td>
                      <td className="px-2 py-2 text-xs text-slate-500 whitespace-nowrap" title={formatDate(app.createdAt)}>
                        {formatShortDate(app.createdAt)}
                      </td>
                      <td className="px-2 py-2">
                        <div className="flex items-center gap-0.5">
                          <IconBtn
                            title="Preview resume and cover letter"
                            disabled={!app.latestGenerationId}
                            onClick={() => setPreviewFor({ applicationId: app.id })}
                            className="text-primary hover:bg-slate-100"
                          >
                            <Eye className="w-3.5 h-3.5" />
                          </IconBtn>
                          <IconBtn
                            title="Resume DOCX"
                            disabled={!app.latestGenerationId || buildingFile?.key === `${app.latestGenerationId}:RESUME:DOCX`}
                            onClick={() =>
                              app.latestGenerationId &&
                              handleExport(
                                app.latestGenerationId,
                                'RESUME',
                                'DOCX',
                                `${profileName || 'Applicant'}.docx`,
                                files?.resumeDocxId,
                              )
                            }
                            className="text-blue-600 hover:text-blue-700 hover:bg-blue-50"
                          >
                            <FileType2 className="w-3.5 h-3.5" />
                          </IconBtn>
                          <IconBtn
                            title="Resume PDF"
                            disabled={!app.latestGenerationId || buildingFile?.key === `${app.latestGenerationId}:RESUME:PDF`}
                            onClick={() =>
                              app.latestGenerationId &&
                              handleExport(
                                app.latestGenerationId,
                                'RESUME',
                                'PDF',
                                `${profileName || 'Applicant'}.pdf`,
                                files?.resumePdfId,
                              )
                            }
                            className="text-red-600 hover:text-red-700 hover:bg-red-50"
                          >
                            <FileText className="w-3.5 h-3.5" />
                          </IconBtn>
                          <IconBtn
                            title="Regenerate resume"
                            disabled={Boolean(startingGeneration || postCreate || manualFor) || user?.canGenerateResumes === false}
                            onClick={() => void regenerateInPlace(app)}
                            className="text-slate-400 hover:text-slate-700"
                          >
                            <RefreshCw className={cn('w-3.5 h-3.5', startingGeneration === app.id && 'animate-spin')} />
                          </IconBtn>
                          <IconBtn
                            title="Generate manually with another model"
                            disabled={Boolean(startingGeneration || postCreate || manualFor) || user?.canGenerateResumes === false}
                            onClick={() => openManualGeneration({ appId: app.id, jobTitle: app.jobTitle, company: app.company })}
                            className="text-slate-400 hover:text-primary"
                          >
                            <Braces className="w-3.5 h-3.5" />
                          </IconBtn>
                        </div>
                      </td>
                      <td className="px-2 py-2">
                        <div className="flex items-center gap-0.5">
                          <IconBtn
                            title="Cover letter DOCX"
                            disabled={
                              !app.latestGenerationId ||
                              buildingFile?.key === `${app.latestGenerationId}:COVER_LETTER:DOCX`
                            }
                            onClick={() =>
                              app.latestGenerationId &&
                              handleExport(
                                app.latestGenerationId,
                                'COVER_LETTER',
                                'DOCX',
                                `${profileName || 'Applicant'}_cover letter.docx`,
                                files?.coverLetterDocxId,
                              )
                            }
                            className="text-blue-600 hover:text-blue-700 hover:bg-blue-50"
                          >
                            <FileType2 className="w-3.5 h-3.5" />
                          </IconBtn>
                          <IconBtn
                            title="Cover letter PDF"
                            disabled={
                              !app.latestGenerationId ||
                              buildingFile?.key === `${app.latestGenerationId}:COVER_LETTER:PDF`
                            }
                            onClick={() =>
                              app.latestGenerationId &&
                              handleExport(
                                app.latestGenerationId,
                                'COVER_LETTER',
                                'PDF',
                                `${profileName || 'Applicant'}_cover letter.pdf`,
                                files?.coverLetterPdfId,
                              )
                            }
                            className="text-amber-600 hover:text-amber-700 hover:bg-amber-50"
                          >
                            <FileText className="w-3.5 h-3.5" />
                          </IconBtn>
                        </div>
                      </td>
                      <td className="px-2 py-2">
                        <div className="flex items-center gap-0.5">
                          <IconBtn
                            title="Get answers"
                            disabled={!app.latestGenerationId}
                            onClick={() =>
                              app.latestGenerationId &&
                              setAnswersFor({ generationId: app.latestGenerationId, jobTitle: app.jobTitle })
                            }
                            className="text-primary hover:bg-slate-100"
                          >
                            <MessageSquare className="w-3.5 h-3.5" />
                          </IconBtn>
                          <IconBtn title="Detail" href={`/applications/${app.id}`}>
                            <Eye className="w-3.5 h-3.5" />
                          </IconBtn>
                          <IconBtn title="Edit" onClick={() => openEdit(app)}>
                            <Pencil className="w-3.5 h-3.5" />
                          </IconBtn>
                          <IconBtn
                            title="Delete"
                            onClick={() => setDeleteApp(app)}
                            className="hover:text-red-600 hover:bg-red-50"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </IconBtn>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {!loading && filteredApps.length > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 border-t border-slate-100 text-sm text-slate-500">
            <span>
              Showing {(currentPage - 1) * PAGE_SIZE + 1}–
              {Math.min(currentPage * PAGE_SIZE, filteredApps.length)} of {filteredApps.length}
            </span>
            <div className="flex items-center gap-1">
              <button
                type="button"
                disabled={currentPage <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                className="px-2.5 py-1 rounded-lg border border-[var(--border)] hover:bg-slate-50 disabled:opacity-40"
              >
                Prev
              </button>
              <span className="px-2 tabular-nums">
                {currentPage} / {totalPages}
              </span>
              <button
                type="button"
                disabled={currentPage >= totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                className="px-2.5 py-1 rounded-lg border border-[var(--border)] hover:bg-slate-50 disabled:opacity-40"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Create modal */}
      {showCreate && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => {
            if (saving) return;
            setShowCreate(false);
            if (searchParams.get('new') === '1') router.replace('/applications');
          }}
          role="presentation"
        >
          <div
            role="dialog"
            aria-modal
            className="bg-white rounded-xl w-full max-w-lg max-h-[90vh] flex flex-col shadow-xl border border-[var(--border)]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-6 pt-5 pb-3 shrink-0">
              <h2 className="text-lg font-semibold text-slate-800">New Application</h2>
              <button
                type="button"
                aria-label="Close"
                onClick={() => {
                  setShowCreate(false);
                  if (searchParams.get('new') === '1') router.replace('/applications');
                }}
                className="p-1 rounded-lg text-slate-400 hover:bg-slate-100"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="px-6 overflow-y-auto flex-1 min-h-0 pb-2">
              <ApplicationFormFields
                form={form}
                setForm={setForm}
                profiles={profiles}
                templates={createTemplates}
                showTemplateSelect={isTrueAdmin}
                locations={locations}
                sources={sources}
                onOptionsChange={loadOptions}
                validation={draftValidation}
              />
            </div>
            <div className="flex justify-end gap-3 px-6 py-4 border-t border-slate-100 shrink-0">
              <button
                type="button"
                disabled={saving}
                onClick={() => {
                  setShowCreate(false);
                  if (searchParams.get('new') === '1') router.replace('/applications');
                }}
                className="px-4 py-2 text-sm font-medium text-slate-700 border border-[var(--border)] rounded-lg hover:bg-slate-50 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={saving || !draftValidation.canSave}
                onClick={handleCreate}
                className="px-4 py-2 text-sm font-medium text-white bg-primary rounded-lg hover:bg-primary-light disabled:opacity-50"
              >
                {saving ? 'Creating…' : 'Create'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit modal */}
      {editApp && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => !saving && setEditApp(null)}
          role="presentation"
        >
          <div
            role="dialog"
            aria-modal
            className="bg-white rounded-xl w-full max-w-lg max-h-[90vh] flex flex-col shadow-xl border border-[var(--border)]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-6 pt-5 pb-3 shrink-0">
              <h2 className="text-lg font-semibold text-slate-800">Edit Application</h2>
              <button
                type="button"
                aria-label="Close"
                onClick={() => setEditApp(null)}
                className="p-1 rounded-lg text-slate-400 hover:bg-slate-100"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="px-6 overflow-y-auto flex-1 min-h-0 pb-2">
              <ApplicationFormFields
                form={form}
                setForm={setForm}
                profiles={profiles}
                templates={[]}
                showTemplateSelect={false}
                locations={locations}
                sources={sources}
                onOptionsChange={loadOptions}
              />
            </div>
            <div className="flex justify-end gap-3 px-6 py-4 border-t border-slate-100 shrink-0">
              <button
                type="button"
                disabled={saving}
                onClick={() => setEditApp(null)}
                className="px-4 py-2 text-sm font-medium text-slate-700 border border-[var(--border)] rounded-lg hover:bg-slate-50 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={saving}
                onClick={handleEdit}
                className="px-4 py-2 text-sm font-medium text-white bg-primary rounded-lg hover:bg-primary-light disabled:opacity-50"
              >
                {saving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}

      {previewFor && <GenerationPreviewDialog {...previewFor} onClose={() => setPreviewFor(null)} onSaved={() => void load()} />}
      {/* Delete confirm */}
      {deleteApp && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => !deleting && setDeleteApp(null)}
          role="presentation"
        >
          <div
            role="dialog"
            aria-modal
            className="bg-white rounded-xl w-full max-w-md p-6 shadow-xl border border-[var(--border)] space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-lg font-semibold text-slate-800">Delete application?</h3>
            <p className="text-sm text-slate-600">
              <span className="font-medium text-slate-800">{deleteApp.jobTitle}</span> at{' '}
              {deleteApp.company} will be permanently deleted, including generated documents.
            </p>
            <div className="flex justify-end gap-3 pt-2">
              <button
                type="button"
                disabled={deleting}
                onClick={() => setDeleteApp(null)}
                className="px-4 py-2 text-sm font-medium text-slate-700 border border-[var(--border)] rounded-lg hover:bg-slate-50 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={deleting}
                onClick={handleDelete}
                className="px-4 py-2 text-sm font-medium text-white bg-red-600 rounded-lg hover:bg-red-700 disabled:opacity-50"
              >
                {deleting ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Post-create: warnings / confirm / progress / download */}
      {postCreate && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4"
          onClick={() => {
            if (postCreateBusy) return;
            if (postCreate.phase === 'download') {
              setPostCreate(null);
              return;
            }
            closePostCreate(true);
          }}
          role="presentation"
        >
          <div
            role="dialog"
            aria-modal
            className="bg-white rounded-xl w-full max-w-md p-6 shadow-xl border border-[var(--border)] space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            {postCreate.phase === 'warnings' && (
              <>
                <div className="flex items-start gap-3">
                  <div className="mt-0.5 rounded-full bg-amber-50 p-2 text-amber-600">
                    <AlertTriangle className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="text-lg font-semibold text-slate-800">{postCreate.warnings.every(w => w.category === 'DUPLICATE') ? 'Duplicate application found' : 'Application warnings'}</h3>
                    <p className="text-sm text-slate-600 mt-1">
                      Review these before generating a resume for{' '}
                      <span className="font-medium text-slate-800">{postCreate.jobTitle}</span>.
                    </p>
                  </div>
                </div>
                <ul className="max-h-56 overflow-y-auto space-y-2">
                  {postCreate.warnings.map((w, i) => (
                    <li
                      key={w.id || `${w.category}-${i}`}
                      className="rounded-lg border border-amber-100 bg-amber-50/60 px-3 py-2"
                    >
                      <p className="text-sm font-medium text-slate-800">{formatStatus(w.category)}</p>
                      <p className="text-sm text-slate-600 mt-1">{w.matchedText}</p>
                      {w.category !== 'DUPLICATE' && <p className="text-[11px] text-slate-500 mt-1">
                        {w.severity} · {w.behavior}
                      </p>}
                    </li>
                  ))}
                </ul>
                {!warningsAllowGenerate(postCreate.warnings) && (
                  <p className="text-sm text-red-600">
                    Generation is blocked by policy. You can open the application later from the list.
                  </p>
                )}
                <div className="flex flex-wrap justify-end gap-3 pt-1">
                  <button
                    type="button"
                    onClick={() => closePostCreate(false)}
                    className="px-4 py-2 text-sm font-medium text-slate-700 border border-[var(--border)] rounded-lg hover:bg-slate-50"
                  >
                    Cancel
                  </button>
                  <button type="button" disabled={!warningsAllowGenerate(postCreate.warnings)}
                    onClick={() => openManualGeneration(postCreate)}
                    className="px-4 py-2 text-sm font-medium text-primary border border-[var(--border)] rounded-lg hover:bg-slate-50 disabled:opacity-50">
                    Generate manually
                  </button>
                  <button
                    type="button"
                    disabled={!warningsAllowGenerate(postCreate.warnings)}
                    onClick={() => requestPostCreateGeneration(postCreate.appId, postCreate.templateId)}
                    className="px-4 py-2 text-sm font-medium text-white bg-primary rounded-lg hover:bg-primary-light disabled:opacity-50"
                  >
                    {postCreate.warnings.every(w => w.category === 'DUPLICATE') ? 'Confirm and generate' : 'Continue'}
                  </button>
                </div>
              </>
            )}

            {postCreate.phase === 'confirm' && (
              <>
                <h3 className="text-lg font-semibold text-slate-800">Generate resume now?</h3>
                <p className="text-sm text-slate-600">
                  Create a tailored resume and cover letter for{' '}
                  <span className="font-medium text-slate-800">{postCreate.jobTitle}</span> at{' '}
                  {postCreate.company}?
                </p>
                <div className="flex flex-wrap justify-end gap-3 pt-2">
                  <button
                    type="button"
                    onClick={() => closePostCreate(true)}
                    className="px-4 py-2 text-sm font-medium text-slate-700 border border-[var(--border)] rounded-lg hover:bg-slate-50"
                  >
                    Skip
                  </button>
                  <button type="button" onClick={() => openManualGeneration(postCreate)}
                    className="px-4 py-2 text-sm font-medium text-primary border border-[var(--border)] rounded-lg hover:bg-slate-50">
                    Generate manually
                  </button>
                  <button
                    type="button"
                    onClick={() => requestPostCreateGeneration(postCreate.appId, postCreate.templateId)}
                    className="px-4 py-2 text-sm font-medium text-white bg-primary rounded-lg hover:bg-primary-light"
                  >
                    Generate automatically
                  </button>
                </div>
              </>
            )}

            {postCreate.phase === 'default-prompt' && (
              <DefaultPromptWarning
                profileName={postCreate.profileName || ''}
                promptName={postCreate.defaultPromptName || ''}
                onCancel={() => closePostCreate(true)}
                onContinue={() => startPostCreateGeneration(postCreate.appId, postCreate.templateId)}
              />
            )}

            {postCreate.phase === 'progress' && (
              <>
                <div className="flex flex-col items-center text-center gap-3 py-4">
                  <LoadingSpinner size="lg" className="text-primary" />
                  <h3 className="text-lg font-semibold text-slate-800">Writing the resume</h3>
                  <p className="text-sm text-slate-600">
                    {formatGenerationStatus(postCreate.generationStatus)}
                  </p>
                  <p className="text-xs text-slate-400">This usually takes under a minute. Please wait…</p>
                  <button type="button" disabled={!postCreate.generationId || postCreate.generationStatus === 'CANCELLING'} className="btn-secondary" onClick={async () => {
                    const generationId = postCreate.generationId;
                    if (!generationId) return;
                    setPostCreate(prev => prev ? { ...prev, generationStatus: 'CANCELLING' } : prev);
                    try { await api.cancelGeneration(generationId); }
                    catch (error) { toast.error(error instanceof Error ? error.message : 'Could not cancel. Try again.'); setPostCreate(prev => prev ? { ...prev, generationStatus: 'GENERATING' } : prev); }
                  }}>{postCreate.generationStatus === 'CANCELLING' ? 'Cancelling…' : 'Cancel generation'}</button>
                </div>
              </>
            )}

            {postCreate.phase === 'download' && buildingFile && (
              <div className="flex flex-col items-center text-center gap-3 py-4">
                <LoadingSpinner size="lg" className="text-primary" />
                <h3 className="text-lg font-semibold text-slate-800">Building {buildingFile.label}</h3>
                <p className="text-sm text-slate-600">
                  Only this file is being created. The download starts when it is ready.
                </p>
              </div>
            )}

            {postCreate.phase === 'download' && !buildingFile && (
              <>
                <div className="flex items-start gap-3">
                  <div className="mt-0.5 rounded-full bg-emerald-50 p-2 text-emerald-600">
                    <Check className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="text-lg font-semibold text-slate-800">Ready to download</h3>
                    <p className="text-sm text-slate-600 mt-1">
                      The resume for{' '}
                      <span className="font-medium text-slate-800">{postCreate.jobTitle}</span> is
                      ready. Choose one file. Only that file is built.
                    </p>
                  </div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {(
                    [
                      ['RESUME', 'PDF', 'Resume PDF', FileText, 'text-red-600'],
                      ['RESUME', 'DOCX', 'Resume DOCX', FileType2, 'text-blue-600'],
                      ['COVER_LETTER', 'PDF', 'Cover PDF', Download, 'text-amber-600'],
                      ['COVER_LETTER', 'DOCX', 'Cover DOCX', Download, 'text-blue-600'],
                    ] as const
                  ).map(([kind, type, label, Icon, iconClass]) => (
                    <button
                      key={`${kind}:${type}`}
                      type="button"
                      disabled={!postCreate.generationId}
                      onClick={() =>
                        postCreate.generationId &&
                        handleExport(
                          postCreate.generationId,
                          kind,
                          type,
                          `${postCreate.jobTitle}-${kind === 'RESUME' ? 'resume' : 'cover-letter'}.${type.toLowerCase()}`,
                        )
                      }
                      className="flex items-center gap-2 px-3 py-2.5 rounded-lg border border-[var(--border)] text-sm hover:bg-slate-50 disabled:opacity-40"
                    >
                      <Icon className={`w-4 h-4 ${iconClass}`} />
                      {label}
                    </button>
                  ))}
                </div>
                <div className="flex justify-end gap-2 pt-1">
                  <button
                    type="button"
                    disabled={!postCreate.generationId}
                    onClick={() =>
                      postCreate.generationId &&
                      setAnswersFor({
                        generationId: postCreate.generationId,
                        jobTitle: postCreate.jobTitle,
                      })
                    }
                    className="px-4 py-2 text-sm font-medium text-slate-700 border border-[var(--border)] rounded-lg hover:bg-slate-50 disabled:opacity-40"
                  >
                    Get answers
                  </button>
                  <button
                    type="button"
                    onClick={() => setPostCreate(null)}
                    className="px-4 py-2 text-sm font-medium text-white bg-primary rounded-lg hover:bg-primary-light"
                  >
                    Done
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {manualFor && (
        <ManualGenerationDialog
          applicationId={manualFor.appId}
          jobTitle={manualFor.jobTitle}
          company={manualFor.company}
          templateId={manualFor.templateId}
          onClose={() => setManualFor(null)}
          onComplete={completeManualGeneration}
        />
      )}

      {answersFor && (
        <GetAnswersDialog
          generationId={answersFor.generationId}
          jobTitle={answersFor.jobTitle}
          onClose={() => setAnswersFor(null)}
        />
      )}
    </div>
  );
}
