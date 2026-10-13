'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { TemplateEditor } from '@/components/template-editor';
import { type DesignerTab } from '@/components/template-designer-panel';
import { ArrowLeft, Loader2, Save, Trash2, Upload } from 'lucide-react';
import styles from '../templates.module.css';
import { cn } from '@/lib/utils';

type Nested = Record<string, unknown>;

function asObj(value: unknown): Nested {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Nested) : {};
}

export default function TemplateDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { isAdmin, canBid, loading: authLoading } = useAuth();
  const canManageTemplates = isAdmin || canBid;
  const router = useRouter();

  const [name, setName] = useState('');
  const [savedName, setSavedName] = useState('');
  const [config, setConfig] = useState<Nested>({});
  const [savedConfig, setSavedConfig] = useState<Nested>({});
  const [isPublished, setIsPublished] = useState(false);
  const [tab, setTab] = useState<DesignerTab>('typography');
  const [previewHtml, setPreviewHtml] = useState('');
  const [previewLoading, setPreviewLoading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const userEdited = useRef(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const dirty = useMemo(
    () =>
      name.trim() !== savedName.trim() ||
      JSON.stringify(config) !== JSON.stringify(savedConfig),
    [name, savedName, config, savedConfig],
  );

  useEffect(() => {
    if (authLoading) return;
    if (!canManageTemplates) router.replace('/templates');
  }, [authLoading, canManageTemplates, router]);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    userEdited.current = false;
    try {
      const data = await api.getTemplate(id);
      const cfg = asObj(data.configJson);
      const n = String(data.name || '');
      setName(n);
      setSavedName(n);
      setConfig(cfg);
      setSavedConfig(cfg);
      setIsPublished(Boolean(data.isPublished));
      const preview = await api.getTemplatePreview(id);
      setPreviewHtml(preview.html);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load template');
      router.replace('/templates');
    } finally {
      setLoading(false);
    }
  }, [id, router]);

  useEffect(() => {
    if (!canManageTemplates || !id) return;
    load().catch(() => undefined);
  }, [canManageTemplates, id, load]);

  useEffect(() => {
    if (!id || !userEdited.current) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      setPreviewLoading(true);
      try {
        const { html } = await api.previewTemplateDraft(id, config);
        setPreviewHtml(html);
      } catch (err) {
        console.error(err);
      } finally {
        setPreviewLoading(false);
      }
    }, 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [config, id]);

  const handleConfigChange = (next: Nested) => {
    userEdited.current = true;
    setConfig(next);
  };

  const handleBack = () => {
    if (dirty) {
      const ok = window.confirm('Discard unsaved changes?');
      if (!ok) return;
    }
    router.push('/templates');
  };

  const handleSave = async () => {
    if (!id) return;
    if (!name.trim()) {
      toast.error('Template name is required');
      return;
    }
    setSaving(true);
    try {
      await api.updateTemplate(id, { name: name.trim(), configJson: config });
      setSavedName(name.trim());
      setSavedConfig(config);
      userEdited.current = false;
      const preview = await api.getTemplatePreview(id);
      setPreviewHtml(preview.html);
      toast.success('Your template customization was saved');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const handlePublish = async () => {
    if (!id) return;
    if (dirty) {
      toast.error('Save your changes before publishing');
      return;
    }
    setPublishing(true);
    try {
      await api.publishTemplate(id);
      setIsPublished(true);
      toast.success('Template published');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to publish');
    } finally {
      setPublishing(false);
    }
  };

  const handleDelete = async () => {
    if (!id) return;
    const ok = window.confirm(
      'Delete this template? It will be archived and removed from the list.',
    );
    if (!ok) return;
    setDeleting(true);
    try {
      await api.archiveTemplate(id);
      toast.success('Template deleted');
      router.push('/templates');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to delete');
    } finally {
      setDeleting(false);
    }
  };

  if (authLoading || !canManageTemplates || loading) {
    return (
      <div className={styles.fallback}>
        <Loader2 className={cn('w-4 h-4', styles.spin)} /> Loading template…
      </div>
    );
  }

  return (
    <TemplateEditor
      title="Customize my template"
      subtitle={
        isPublished
          ? 'Your private customization. The shared template stays unchanged.'
          : 'Draft · Publish when ready for bidders.'
      }
      name={name}
      onNameChange={setName}
      tab={tab}
      onTabChange={setTab}
      config={config}
      onConfigChange={handleConfigChange}
      previewHtml={previewHtml}
      previewLoading={previewLoading}
      actions={
        <>
          <button type="button" className={styles.btnSecondary} onClick={handleBack}>
            <ArrowLeft className="w-4 h-4" /> Back
          </button>
          <button
            type="button"
            className={styles.btnPrimary}
            disabled={saving || !dirty}
            onClick={handleSave}
          >
            <Save className="w-4 h-4" />
            {saving ? 'Saving…' : 'Save'}
          </button>
        </>
      }
    />
  );
}
