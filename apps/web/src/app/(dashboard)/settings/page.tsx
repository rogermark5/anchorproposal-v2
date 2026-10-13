'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { api, type ExperienceTitleMode } from '@/lib/api';
import { PromptPositionFlag, TailoredPromptOutputNotice } from '@/components/prompt-position-flag';
import { useAuth } from '@/lib/auth-context';
import { formatDate } from '@/lib/utils';
import { PrivateGenerationSettings } from '@/components/private-generation-settings';
import { DesktopReleaseManager } from '@/components/desktop-release-manager';

type MasterTab = 'prompts' | 'ai' | 'warnings' | 'audit' | 'desktop';
type AdminTab = 'prompt' | 'account';
type BidderTab = 'prompt' | 'account';

type PromptRow = {
  id: string;
  name: string;
  content: string;
  version: number;
  isPublished: boolean;
  isInitial?: boolean;
  experienceTitleMode?: ExperienceTitleMode;
};

function AnswerPromptCard({
  value,
  saving,
  onChange,
  onSave,
}: {
  value: string;
  saving: boolean;
  onChange: (value: string) => void;
  onSave: () => void;
}) {
  return (
    <div className="bg-white border border-[var(--border)] rounded-xl p-4 space-y-3">
      <div>
        <h2 className="font-medium text-slate-800">Get answer prompt</h2>
        <p className="text-sm text-slate-500 mt-1">
          Used after a resume is generated. It is sent on that same conversation, and the first reply
          should be only yes. Questions are sent after that, one at a time.
        </p>
      </div>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full min-h-[10rem] px-3 py-2 border border-[var(--border)] rounded-lg text-sm font-mono whitespace-pre-wrap"
      />
      <button
        type="button"
        disabled={saving || !value.trim()}
        onClick={onSave}
        className="px-4 py-2 bg-primary text-white rounded-lg text-sm disabled:opacity-50"
      >
        {saving ? 'Saving…' : 'Save answer prompt'}
      </button>
    </div>
  );
}

export default function SettingsPage() {
  const { isMaster, isAdmin, user } = useAuth();
  const isAdminOnly = isAdmin && !isMaster;
  const isBidder = user?.role === 'BIDDER';

  const [masterTab, setMasterTab] = useState<MasterTab>('prompts');
  useEffect(() => { if (isMaster && window.location.hash.split('#').pop() === 'desktop') setMasterTab('desktop'); }, [isMaster]);
  const [staffTab, setStaffTab] = useState<AdminTab | BidderTab>('prompt');

  const [prompts, setPrompts] = useState<PromptRow[]>([]);
  const [promptDrafts, setPromptDrafts] = useState<Record<string, string>>({});
  const [promptNameDrafts, setPromptNameDrafts] = useState<Record<string, string>>({});
  const [editingPromptId, setEditingPromptId] = useState<string | null>(null);
  const [promptMode, setPromptMode] = useState<'user' | 'profile' | 'separate'>('profile');
  const [defaultPromptDraft, setDefaultPromptDraft] = useState('');
  const [newPromptName, setNewPromptName] = useState('');
  const [newPromptPositionMode, setNewPromptPositionMode] = useState<ExperienceTitleMode>('saved');
  const [promptPositionDrafts, setPromptPositionDrafts] = useState<Record<string, ExperienceTitleMode>>({});
  const [savingVersionId, setSavingVersionId] = useState<string | null>(null);
  const [deletingVersionId, setDeletingVersionId] = useState<string | null>(null);
  const [newPrompt, setNewPrompt] = useState('');
  const [aiSettings, setAiSettings] = useState<{ hasApiKey: boolean; model: string } | null>(null);
  const [warnings, setWarnings] = useState<Record<string, unknown>[]>([]);
  const [audit, setAudit] = useState<Record<string, unknown>[]>([]);
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState('deepseek-v4-flash');
  const [savingAi, setSavingAi] = useState(false);
  const [savingPrompt, setSavingPrompt] = useState(false);
  const [answerPrompt, setAnswerPrompt] = useState('');
  const [savingAnswerPrompt, setSavingAnswerPrompt] = useState(false);

  const [myPrompt, setMyPrompt] = useState<{
    useMasterPrompt: boolean | null;
    promptSource?: 'initial' | 'custom' | null;
    assignmentMode?: 'user' | 'profile' | 'separate';
    masterPrompt: { id: string; name?: string; content: string } | null;
    myPrompt: { id: string; name?: string; content: string } | null;
    myPrompts?: { id: string; name: string; content: string }[];
    assignedPrompts?: { id: string; name: string; content?: string; isDefault: boolean }[];
    profilePrompts?: { profileName: string; promptName: string }[];
    selectedPromptId?: string | null;
    effectivePrompt: { id: string; name?: string; content: string } | null;
  } | null>(null);

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [savingPassword, setSavingPassword] = useState(false);

  const [newRule, setNewRule] = useState({
    category: 'CITIZENSHIP',
    pattern: '',
    severity: 'CONFIRM',
    behavior: 'WARN',
  });

  const loadMaster = useCallback(async () => {
    const [p, ai, w, a, answer] = await Promise.all([
      api.getPromptLibrary('manage').catch(() => []),
      api.getAiSettings().catch(() => null),
      api.getWarningRules().catch(() => []),
      api.getAuditLog().catch(() => []),
      api.getAnswerPrompt().catch(() => ({ prompt: '' })),
    ]);
    const rows = p as PromptRow[];
    setPrompts(rows);
    setPromptDrafts(Object.fromEntries(rows.map((row) => [row.id, row.content])));
    setPromptNameDrafts(Object.fromEntries(rows.map((row) => [row.id, row.name || 'Prompt'])));
    setPromptPositionDrafts(Object.fromEntries(rows.map(row => [row.id, row.experienceTitleMode || 'saved'])));
    setEditingPromptId(null);
    if (ai) {
      setAiSettings(ai);
      setModel(ai.model || 'deepseek-v4-flash');
    }
    setWarnings(w as Record<string, unknown>[]);
    setAudit(a as Record<string, unknown>[]);
    if (answer.prompt) setAnswerPrompt(answer.prompt);
  }, []);

  const loadMyPrompt = useCallback(async () => {
    const data = await api.getMyPrompt();
    setMyPrompt({
      useMasterPrompt: data.useMasterPrompt,
      promptSource: data.promptSource ?? null,
      assignmentMode: data.assignmentMode,
      masterPrompt: data.masterPrompt,
      myPrompt: data.myPrompt,
      myPrompts: data.myPrompts,
      assignedPrompts: data.assignedPrompts,
      profilePrompts: data.profilePrompts,
      selectedPromptId: data.selectedPromptId,
      effectivePrompt: data.effectivePrompt,
    });
    setDefaultPromptDraft(data.effectivePrompt?.content || '');
    if (data.assignmentMode) setPromptMode(data.assignmentMode);
    if (user?.role === 'ADMIN' || user?.role === 'BIDDER') {
      const answer = await api.getAnswerPrompt().catch(() => ({ prompt: '' }));
      if (answer.prompt) setAnswerPrompt(answer.prompt);
      const library = await api.getPromptLibrary('manage').catch(() => []);
      const rows = library as PromptRow[];
      setPrompts(rows);
      setPromptDrafts(Object.fromEntries(rows.map((row) => [row.id, row.content])));
      setPromptNameDrafts(Object.fromEntries(rows.map((row) => [row.id, row.name || 'Prompt'])));
    setPromptPositionDrafts(Object.fromEntries(rows.map(row => [row.id, row.experienceTitleMode || 'saved'])));
    }
  }, [user?.role]);

  useEffect(() => {
    if (isMaster) {
      loadMaster().catch(() => undefined);
    }
  }, [isMaster, loadMaster, loadMyPrompt]);

  const handleSaveAnswerPrompt = async () => {
    setSavingAnswerPrompt(true);
    try {
      const saved = await api.updateAnswerPrompt(answerPrompt);
      setAnswerPrompt(saved.prompt);
      toast.success('Answer prompt saved');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save answer prompt');
    } finally {
      setSavingAnswerPrompt(false);
    }
  };

  const handlePublishPrompt = async (id: string) => {
    try {
      await api.publishPrompt(id);
      toast.success('Initial prompt published');
      await loadMaster();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to publish prompt');
    }
  };

  const reloadPrompts = async () => {
    if (isMaster) await loadMaster();
    else await loadMyPrompt();
  };

  const handleSavePromptVersion = async (id: string) => {
    const content = (promptDrafts[id] ?? '').trim();
    const name = (promptNameDrafts[id] ?? '').trim();
    if (!name) {
      toast.error('Prompt name is required');
      return;
    }
    if (!content) {
      toast.error('Prompt content is required');
      return;
    }
    setSavingVersionId(id);
    try {
      await api.updateLibraryPrompt(id, { name, content, experienceTitleMode: promptPositionDrafts[id] || 'saved' });
      toast.success('Prompt saved');
      setEditingPromptId(null);
      await reloadPrompts();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save prompt');
    } finally {
      setSavingVersionId(null);
    }
  };

  const handleCancelEditPrompt = (id: string, original: string) => {
    const originalName = prompts.find((p) => p.id === id)?.name || '';
    setPromptDrafts((prev) => ({ ...prev, [id]: original }));
    setPromptNameDrafts((prev) => ({ ...prev, [id]: originalName }));
    setPromptPositionDrafts(prev => ({ ...prev, [id]: prompts.find(p => p.id === id)?.experienceTitleMode || 'saved' }));
    setEditingPromptId(null);
  };

  const handleDeletePromptVersion = async (id: string, version: number) => {
    const ok = window.confirm(
      `Remove prompt version ${version} from the library and its assignments? Existing resumes will be kept.`,
    );
    if (!ok) return;
    setDeletingVersionId(id);
    try {
      await api.deleteLibraryPrompt(id);
      toast.success(`“${prompts.find((p) => p.id === id)?.name || `Version ${version}`}” deleted`);
      if (editingPromptId === id) setEditingPromptId(null);
      await reloadPrompts();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to delete prompt');
    } finally {
      setDeletingVersionId(null);
    }
  };

  const handleCreatePrompt = async () => {
    if (!newPromptName.trim()) {
      toast.error('Prompt name is required');
      return;
    }
    if (!newPrompt.trim()) {
      toast.error('Prompt content is required');
      return;
    }
    setSavingPrompt(true);
    try {
      await api.createLibraryPrompt({ name: newPromptName.trim(), content: newPrompt.trim(), experienceTitleMode: isMaster && !prompts.some(p => p.isInitial) ? 'saved' : newPromptPositionMode });
      setNewPrompt('');
      setNewPromptName('');
      setNewPromptPositionMode('saved');
      toast.success('Prompt added');
      await reloadPrompts();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to create prompt');
    } finally {
      setSavingPrompt(false);
    }
  };

  const handleSaveAi = async () => {
    setSavingAi(true);
    try {
      const updated = await api.updateAiSettings({
        apiKey: apiKey.trim() || undefined,
        model: model.trim() || undefined,
      });
      setAiSettings(updated);
      setApiKey('');
      toast.success('AI settings saved');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save AI settings');
    } finally {
      setSavingAi(false);
    }
  };

  const handleSaveAdminPrompt = async (resetToDefault = false) => {
    setSavingPrompt(true);
    try {
      const updated = await api.updateMyPrompt({
        mode: promptMode,
        ...(resetToDefault ? { resetToDefault: true } : {
          ...(defaultPromptDraft.trim() !== myPrompt?.effectivePrompt?.content.trim()
            ? { content: defaultPromptDraft.trim() } : {}),
        }),
      });
      if (!updated.effectivePrompt?.content.trim()) {
        throw new Error('The default prompt could not be loaded. Your current text is still shown; please try again.');
      }
      setMyPrompt({
        useMasterPrompt: updated.useMasterPrompt,
        promptSource: updated.promptSource ?? null,
        assignmentMode: updated.assignmentMode,
        masterPrompt: updated.masterPrompt,
        myPrompt: updated.myPrompt,
        myPrompts: updated.myPrompts,
        selectedPromptId: updated.selectedPromptId,
        effectivePrompt: updated.effectivePrompt,
      });
      setDefaultPromptDraft(updated.effectivePrompt.content);
      if (updated.assignmentMode) setPromptMode(updated.assignmentMode);
      toast.success(resetToDefault ? 'Shared default restored' : 'Prompt settings saved');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save prompt');
    } finally {
      setSavingPrompt(false);
    }
  };

  const handleChangePassword = async () => {
    if (newPassword !== confirmPassword) {
      toast.error('Passwords do not match');
      return;
    }
    setSavingPassword(true);
    try {
      const res = await api.changePassword({
        currentPassword,
        newPassword,
        confirmPassword,
      });
      toast.success(res.message || 'Password updated');
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to change password');
    } finally {
      setSavingPassword(false);
    }
  };

  const handleCreateRule = async () => {
    if (!newRule.pattern.trim()) {
      toast.error('Pattern is required');
      return;
    }
    try {
      await api.createWarningRule(newRule);
      toast.success('Warning rule created');
      setNewRule({ category: 'CITIZENSHIP', pattern: '', severity: 'CONFIRM', behavior: 'WARN' });
      const w = await api.getWarningRules();
      setWarnings(w as Record<string, unknown>[]);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to create rule');
    }
  };

  const masterTabs = useMemo(
    () =>
      [
        { key: 'prompts' as const, label: 'Resume & cover letter' },
        { key: 'ai' as const, label: 'AI Provider' },
        { key: 'warnings' as const, label: 'Warning Rules' },
        { key: 'audit' as const, label: 'Audit Log' },
        { key: 'desktop' as const, label: 'Desktop app' },
      ] as const,
    [],
  );

  const accountTab = (
    <div className="bg-white border border-[var(--border)] rounded-xl p-6 max-w-md space-y-4">
      <h2 className="font-medium text-slate-800">Change password</h2>
      <div>
        <label className="block text-sm font-medium text-slate-700 mb-1">Current password</label>
        <input
          type="password"
          value={currentPassword}
          onChange={(e) => setCurrentPassword(e.target.value)}
          className="w-full px-3 py-2 border border-[var(--border)] rounded-lg text-sm"
          autoComplete="current-password"
        />
      </div>
      <div>
        <label className="block text-sm font-medium text-slate-700 mb-1">New password</label>
        <input
          type="password"
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
          className="w-full px-3 py-2 border border-[var(--border)] rounded-lg text-sm"
          autoComplete="new-password"
        />
      </div>
      <div>
        <label className="block text-sm font-medium text-slate-700 mb-1">Confirm new password</label>
        <input
          type="password"
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          className="w-full px-3 py-2 border border-[var(--border)] rounded-lg text-sm"
          autoComplete="new-password"
        />
      </div>
      <button
        type="button"
        disabled={savingPassword}
        onClick={handleChangePassword}
        className="px-4 py-2 bg-primary text-white rounded-lg text-sm disabled:opacity-50"
      >
        {savingPassword ? 'Updating…' : 'Update password'}
      </button>
    </div>
  );

  if (isMaster) {
    return (
      <div className="p-4 sm:p-6 lg:p-8">
        <div className="mb-8">
          <h1 className="text-2xl font-semibold text-slate-800">Settings</h1>
          <p className="text-slate-500">Platform configuration (Master)</p>
        </div>

        <div className="flex gap-1 border-b border-[var(--border)] mb-6">
          {masterTabs.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setMasterTab(t.key)}
              className={`px-4 py-2.5 text-sm font-medium border-b-2 -mb-px ${
                masterTab === t.key ? 'border-primary text-primary' : 'border-transparent text-slate-500'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {masterTab === 'desktop' && <DesktopReleaseManager />}
        {masterTab === 'prompts' && <PrivateGenerationSettings />}

        {masterTab === 'ai' && (
          <div className="bg-white border border-[var(--border)] rounded-xl p-6 max-w-lg space-y-4">
            <div>
              <p className="text-sm text-slate-600">
                Provider: <strong>DeepSeek</strong>
              </p>
              <p className="text-sm text-slate-600">
                API Key:{' '}
                <strong className={aiSettings?.hasApiKey ? 'text-green-700' : 'text-amber-700'}>
                  {aiSettings?.hasApiKey ? 'Configured' : 'Not set'}
                </strong>
              </p>
              <p className="text-xs text-slate-400 mt-1">
                Only Master can change the platform API key. Automatic generation uses the key saved here.
              </p>
              {aiSettings && !aiSettings.hasApiKey && (
                <p role="status" className="mt-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-800">
                  Automatic resume generation and AI answers are unavailable until you save an API key.
                </p>
              )}
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Model</label>
              <input
                type="text"
                value={model}
                onChange={(e) => setModel(e.target.value)}
                className="w-full px-3 py-2 border rounded-lg text-sm"
                placeholder="deepseek-v4-flash"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Update API Key</label>
              <input
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                className="w-full px-3 py-2 border rounded-lg text-sm"
                placeholder="sk-... (leave blank to keep current)"
                autoComplete="off"
              />
            </div>
            <button
              type="button"
              onClick={handleSaveAi}
              disabled={savingAi}
              className="px-4 py-2 bg-primary text-white rounded-lg text-sm disabled:opacity-50"
            >
              {savingAi ? 'Saving…' : 'Save AI settings'}
            </button>
          </div>
        )}

        {masterTab === 'warnings' && (
          <div className="space-y-4">
            <div className="bg-white border border-[var(--border)] rounded-xl p-4 space-y-3 max-w-2xl">
              <h2 className="font-medium text-slate-800">Add warning rule</h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <select
                  value={newRule.category}
                  onChange={(e) => setNewRule({ ...newRule, category: e.target.value })}
                  className="px-3 py-2 border rounded-lg text-sm"
                >
                  {[
                    'REMOTE_CONFLICT',
                    'CLEARANCE',
                    'TRUST_BACKGROUND',
                    'CITIZENSHIP',
                    'TRAVEL_LOCATION',
                    'DUPLICATE',
                  ].map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
                <select
                  value={newRule.severity}
                  onChange={(e) => setNewRule({ ...newRule, severity: e.target.value })}
                  className="px-3 py-2 border rounded-lg text-sm"
                >
                  {['INFO', 'CONFIRM', 'ADMIN_REVIEW', 'BLOCK'].map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
                <select
                  value={newRule.behavior}
                  onChange={(e) => setNewRule({ ...newRule, behavior: e.target.value })}
                  className="px-3 py-2 border rounded-lg text-sm col-span-2"
                >
                  {['WARN', 'CONFIRM', 'ADMIN_REVIEW', 'BLOCK'].map((b) => (
                    <option key={b} value={b}>
                      {b}
                    </option>
                  ))}
                </select>
                <input
                  value={newRule.pattern}
                  onChange={(e) => setNewRule({ ...newRule, pattern: e.target.value })}
                  className="px-3 py-2 border rounded-lg text-sm col-span-2 font-mono"
                  placeholder="Regex pattern"
                />
              </div>
              <button
                type="button"
                onClick={handleCreateRule}
                className="px-4 py-2 bg-primary text-white rounded-lg text-sm"
              >
                Create rule
              </button>
            </div>
            <div className="bg-white border border-[var(--border)] rounded-xl overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-slate-50 border-b">
                    <th className="text-left px-4 py-3">Category</th>
                    <th className="text-left px-4 py-3">Pattern</th>
                    <th className="text-left px-4 py-3">Severity</th>
                    <th className="text-left px-4 py-3">Behavior</th>
                  </tr>
                </thead>
                <tbody>
                  {warnings.map((w) => (
                    <tr key={w.id as string} className="border-b border-slate-100">
                      <td className="px-4 py-3">{w.category as string}</td>
                      <td className="px-4 py-3 font-mono text-xs">{w.pattern as string}</td>
                      <td className="px-4 py-3">{w.severity as string}</td>
                      <td className="px-4 py-3">{w.behavior as string}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {masterTab === 'audit' && (
          <div className="space-y-2">
            {audit.map((e) => (
              <div
                key={e.id as string}
                className="bg-white border border-[var(--border)] rounded-lg p-3 flex justify-between text-sm"
              >
                <div>
                  <span className="font-medium">{e.action as string}</span>
                  <span className="text-slate-500 ml-2">{e.targetType as string}</span>
                </div>
                <span className="text-slate-400">{formatDate(e.createdAt as string)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  // Admin or Bidder
  const tabs =
    isAdminOnly
      ? ([
          { key: 'prompt' as const, label: 'Resume & cover letter' },
          { key: 'account' as const, label: 'Account' },
        ] as const)
      : ([
          { key: 'prompt' as const, label: 'Resume & cover letter' },
          { key: 'account' as const, label: 'Account' },
        ] as const);

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold text-slate-800">Settings</h1>
        <p className="text-slate-500">
          Your private generation prompts and account
        </p>
      </div>

      <div className="flex gap-1 border-b border-[var(--border)] mb-6">
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setStaffTab(t.key)}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 -mb-px ${
              staffTab === t.key ? 'border-primary text-primary' : 'border-transparent text-slate-500'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {staffTab === 'prompt' && <PrivateGenerationSettings />}

      {staffTab === 'account' && accountTab}
    </div>
  );
}
