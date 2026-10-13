'use client';

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { TemplateDocThumbnail } from '@/components/template-doc-thumbnail';
import {
  TemplateDesignerPanel,
  resolveTemplateMeta,
  type DesignerTab,
} from '@/components/template-designer-panel';
import { cn } from '@/lib/utils';
import { TemplatePreviewFrame } from '@/components/template-preview-frame';
import { Check, Eye, Loader2, Plus } from 'lucide-react';
import styles from './templates.module.css';

type Nested = Record<string, unknown>;

interface Template {
  id: string;
  name: string;
  preset: string | null;
  isPublished: boolean;
  version: number;
  isDefault?: boolean;
  updatedAt?: string;
  configJson?: Nested;
}

function asObj(value: unknown): Nested {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Nested) : {};
}

function pageSizeOf(config: Nested) {
  return String(asObj(config.layout).pageSize || 'LETTER').toUpperCase();
}

/** Keep the current card order. Only the default flag changes. */
function markDefaultInPlace(list: Template[], defaultId: string | null): Template[] {
  return list.map((t) => ({ ...t, isDefault: Boolean(defaultId) && t.id === defaultId }));
}

function TemplatesDashboardInner() {
  const { isAdmin, canBid } = useAuth();
  const canManageTemplates = isAdmin || canBid;
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialIdRef = useRef(searchParams.get('id'));

  const [templates, setTemplates] = useState<Template[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(initialIdRef.current);
  const [previewHtml, setPreviewHtml] = useState('');
  const [pageSize, setPageSize] = useState('LETTER');
  const [loadingList, setLoadingList] = useState(true);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [settingDefaultId, setSettingDefaultId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Nested | null>(null);
  const [savedDraft, setSavedDraft] = useState('');
  const [designerTab, setDesignerTab] = useState<DesignerTab>('typography');
  const [saving, setSaving] = useState(false);
  const previewToken = useRef(0);

  const selected = useMemo(
    () => templates.find((t) => t.id === selectedId) || null,
    [templates, selectedId],
  );

  const defaultTemplateId = useMemo(
    () => templates.find((t) => t.isDefault)?.id ?? null,
    [templates],
  );

  const dirty = draft !== null && JSON.stringify(draft) !== savedDraft;

  useEffect(() => {
    let cancelled = false;

    (async () => {
      setLoadingList(true);
      try {
        const data = (await api.getTemplates()) as Template[];
        if (cancelled) return;
        const preferred =
          (initialIdRef.current && data.some((t) => t.id === initialIdRef.current)
            ? initialIdRef.current
            : null) ||
          data.find((t) => t.isDefault)?.id ||
          data[0]?.id ||
          null;
        setTemplates(data);
        setSelectedId(preferred);
      } catch (err) {
        if (!cancelled) {
          toast.error(err instanceof Error ? err.message : 'Failed to load templates');
        }
      } finally {
        if (!cancelled) setLoadingList(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const handleSetDefault = useCallback(async (templateId: string) => {
    setSettingDefaultId(templateId);
    setTemplates((prev) => markDefaultInPlace(prev, templateId));
    try {
      await api.setDefaultTemplate(templateId);
      toast.success('Default template updated');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to set default');
      try {
        const data = (await api.getTemplates()) as Template[];
        const defaultId = data.find((t) => t.isDefault)?.id ?? null;
        setTemplates((prev) => {
          const byId = new Map(data.map((t) => [t.id, t]));
          const kept = prev
            .filter((t) => byId.has(t.id))
            .map((t) => ({ ...byId.get(t.id)!, isDefault: t.id === defaultId }));
          const extras = data.filter((t) => !prev.some((p) => p.id === t.id));
          return markDefaultInPlace([...kept, ...extras], defaultId);
        });
      } catch {
        /* keep the previous list order */
      }
    } finally {
      setSettingDefaultId(null);
    }
  }, []);

  const selectTemplate = useCallback((t: Template) => {
    if (t.id === selectedId) return;
    setDraft(null);
    setSavedDraft('');
    setSelectedId(t.id);
  }, [selectedId]);

  useEffect(() => {
    if (!selectedId) {
      setPreviewHtml('');
      setDraft(null);
      setSavedDraft('');
      return;
    }
    const token = ++previewToken.current;
    setLoadingPreview(true);
    (async () => {
      try {
        const data = await api.getTemplate(selectedId);
        if (token !== previewToken.current) return;
        const cfg = asObj(data.configJson);
        setDraft(cfg);
        setSavedDraft(JSON.stringify(cfg));
        setPageSize(pageSizeOf(cfg));
        setTemplates((prev) =>
          prev.map((t) => (t.id === selectedId ? { ...t, configJson: cfg } : t)),
        );
        const preview = await api.getTemplatePreview(selectedId);
        if (token !== previewToken.current) return;
        setPreviewHtml(preview.html);
        if (typeof window !== 'undefined') {
          if (searchParams.get('id') !== selectedId) window.history.replaceState(null, '', `/templates?id=${encodeURIComponent(selectedId)}`);
        }
      } catch (err) {
        if (token === previewToken.current) {
          toast.error(err instanceof Error ? err.message : 'Failed to load preview');
        }
      } finally {
        if (token === previewToken.current) setLoadingPreview(false);
      }
    })();
  }, [selectedId]);

  useEffect(() => {
    if (!selectedId || !draft || !dirty) return;
    const token = ++previewToken.current;
    const timer = window.setTimeout(() => {
      setLoadingPreview(true);
      api
        .previewTemplateDraft(selectedId, draft)
        .then((preview) => {
          if (token !== previewToken.current) return;
          setPreviewHtml(preview.html);
        })
        .catch((err) => {
          if (token === previewToken.current) {
            toast.error(err instanceof Error ? err.message : 'Failed to update preview');
          }
        })
        .finally(() => {
          if (token === previewToken.current) setLoadingPreview(false);
        });
    }, 280);
    return () => window.clearTimeout(timer);
  }, [draft, dirty, selectedId]);

  const onDesignerChange = (next: Nested) => {
    setDraft(next);
    setPageSize(pageSizeOf(next));
    if (selectedId) {
      setTemplates((prev) =>
        prev.map((t) => (t.id === selectedId ? { ...t, configJson: next } : t)),
      );
    }
  };

  const saveStyle = async () => {
    if (!selectedId || !draft) return;
    setSaving(true);
    try {
      await api.updateTemplate(selectedId, { configJson: draft });
      setSavedDraft(JSON.stringify(draft));
      setTemplates((prev) =>
        prev.map((t) => (t.id === selectedId ? { ...t, configJson: draft } : t)),
      );
      toast.success('Template style saved');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save template style');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div>
          <h1 className={styles.title}>Templates</h1>
          <p className={styles.subtitle}>
            {canManageTemplates
              ? 'Select a template, then customize its style. The default stays in place and is marked with a check.'
              : 'Browse published templates available for generation.'}
          </p>
        </div>
        {isAdmin && (
          <div className={styles.actions}>
            <button
              type="button"
              className={styles.btnPrimary}
              onClick={() => router.push('/templates/new')}
            >
              <Plus className="w-4 h-4" /> Add
            </button>
          </div>
        )}
      </header>

      <div className={styles.workspace}>
        <div className={styles.left}>
          <section className={cn(styles.picker, styles.pickerScroll)}>
            <div className={styles.pickerHead}>
              <h2 className={styles.pickerTitle}>Choose a Template</h2>
              <p className={styles.pickerHint}>Select a template, then customize its style below.</p>
              {defaultTemplateId && (
                <p className={styles.pickerHint}>
                  Default:{' '}
                  <span className={styles.pickerHintStrong}>
                    {templates.find((t) => t.id === defaultTemplateId)?.name || 'Selected'}
                  </span>
                </p>
              )}
            </div>

            {loadingList ? (
              <div className={styles.statusRow}>
                <Loader2 className={cn('w-4 h-4', styles.spin)} /> Loading templates…
              </div>
            ) : templates.length === 0 ? (
              <p className={styles.emptyHint}>No templates yet</p>
            ) : (
              <div className={styles.cardGrid}>
                {templates.map((t) => {
                  const meta = resolveTemplateMeta(t.name, t.preset, asObj(t.configJson));
                  const active = t.id === selectedId;
                  const isDefault = Boolean(t.isDefault);
                  const thumbConfig =
                    active && draft ? draft : asObj(t.configJson);
                  return (
                    <div
                      key={t.id}
                      role="button"
                      tabIndex={0}
                      title={isDefault ? 'Default template' : 'Select to customize'}
                      onClick={() => selectTemplate(t)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          selectTemplate(t);
                        }
                      }}
                      className={cn(
                        styles.card,
                        active && styles.cardActive,
                        isDefault && styles.cardDefault,
                      )}
                    >
                      <div className={styles.cardThumb}>
                        <TemplateDocThumbnail
                          config={thumbConfig as never}
                          className="h-36 border-b border-[var(--border)]"
                        />
                        {isDefault && (
                          <span className={styles.checkBadge} title="Default template">
                            <Check className="w-3.5 h-3.5" />
                          </span>
                        )}
                        {t.isPublished && (
                          <span className={styles.publishedBadge}>Published</span>
                        )}
                      </div>
                      <div className={styles.cardBody}>
                        <p className={styles.cardName}>
                          {t.name}
                          {isDefault ? (
                            <span className={styles.defaultInline}> · Default</span>
                          ) : null}
                        </p>
                        <p className={styles.cardDesc}>{meta.description}</p>
                        <div className={styles.tagRow}>
                          {meta.tags.map((tag) => (
                            <span
                              key={tag}
                              className={cn(styles.tag, active && styles.tagActive)}
                            >
                              {tag}
                            </span>
                          ))}
                        </div>
                        {canManageTemplates && (
                          <button
                            type="button"
                            className={styles.cardDetailBtn}
                            onClick={(e) => {
                              e.stopPropagation();
                              router.push(`/templates/${t.id}`);
                            }}
                          >
                            Detail
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          {canManageTemplates && selected && draft && (
            <section className={styles.customize}>
              <div className={styles.customizeHead}>
                <h2 className={styles.customizeTitle}>Style · {selected.name}</h2>
                <div className={styles.customizeActions}>
                  <button
                    type="button"
                    className={styles.btnSecondary}
                    disabled={selected.isDefault || settingDefaultId === selected.id || !selected.isPublished}
                    onClick={() => void handleSetDefault(selected.id)}
                  >
                    {settingDefaultId === selected.id ? (
                      <Loader2 className={cn('w-4 h-4', styles.spin)} />
                    ) : (
                      <Check className="w-4 h-4" />
                    )}
                    {selected.isDefault ? 'Default' : 'Set as default'}
                  </button>
                  <button
                    type="button"
                    className={styles.btnPrimary}
                    disabled={!dirty || saving}
                    onClick={() => void saveStyle()}
                  >
                    {saving && <Loader2 className={cn('w-4 h-4', styles.spin)} />}
                    Save style
                  </button>
                </div>
              </div>
              <TemplateDesignerPanel
                tab={designerTab}
                onTabChange={setDesignerTab}
                config={draft}
                onChange={onDesignerChange}
              />
            </section>
          )}
        </div>

        <section className={styles.preview}>
          <div className={styles.previewHead}>
            <div className={styles.previewTitle}>
              <Eye className="w-4 h-4" />
              Live Preview
              {selected && <span className={styles.previewName}>— {selected.name}</span>}
            </div>
            {loadingPreview && (
              <span className={styles.previewUpdating}>
                <Loader2 className={cn('w-3 h-3', styles.spin)} /> Updating
              </span>
            )}
          </div>
          <div className={styles.previewBody}>
            {!selectedId ? (
              <p className={styles.emptyHint}>Select a template to preview</p>
            ) : (
              <>
                <TemplatePreviewFrame html={previewHtml} pageSize={pageSize} />
                <p className={styles.paperCaption}>
                  {pageSize === 'A4' ? 'A4' : 'Letter'} · Preview
                </p>
              </>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

export default function TemplatesPage() {
  return (
    <Suspense
      fallback={
        <div className={styles.fallback}>
          <Loader2 className={cn('w-4 h-4', styles.spin)} /> Loading templates…
        </div>
      }
    >
      <TemplatesDashboardInner />
    </Suspense>
  );
}
