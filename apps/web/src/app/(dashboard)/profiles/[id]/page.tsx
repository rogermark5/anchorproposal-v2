'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { ProfileGenerationSettings } from '@/components/profile-generation-settings';
import { ArrowLeft, UserRound } from 'lucide-react';
import {
  ProfileForm,
  emptyProfileFormValues,
  profileFormToApiPayload,
  profileToFormValues,
  validateProfileForm,
  type ProfileFormValues,
  type TemplateOption,
} from '@/components/profile-form';

type Dict = Record<string, unknown>;

function asList(value: unknown): Dict[] {
  return Array.isArray(value) ? (value as Dict[]) : [];
}

export default function ProfileDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { isAdmin, canBid } = useAuth();
  const [profile, setProfile] = useState<Dict | null>(null);
  const [form, setForm] = useState<ProfileFormValues>(emptyProfileFormValues());
  const [templates, setTemplates] = useState<TemplateOption[]>([]);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);

  const loadProfile = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.getProfile(id);
      setProfile(data);
      setForm(profileToFormValues(data));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load profile');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    loadProfile();
  }, [loadProfile]);

  useEffect(() => {
    api
      .getTemplates()
      .then((data) => {
        setTemplates((data as TemplateOption[]).filter((t) => t.isPublished !== false));
      })
      .catch(() => undefined);
  }, []);

  const startEdit = () => {
    if (!profile) return;
    setForm(profileToFormValues(profile));
    setEditing(true);
  };

  const cancelEdit = () => {
    if (profile) setForm(profileToFormValues(profile));
    setEditing(false);
  };

  const handleSave = async () => {
    const error = validateProfileForm(form);
    if (error) {
      toast.error(error);
      return;
    }
    setSaving(true);
    try {
      const payload = profileFormToApiPayload(form);
      const updated = (await api.updateProfile(id, payload)) as Dict;
      setProfile(updated);
      setForm(profileToFormValues(updated));
      setEditing(false);
      toast.success('Profile saved');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save profile');
    } finally {
      setSaving(false);
    }
  };

  if (loading || !profile) {
    return <div className="p-8 text-slate-500">Loading…</div>;
  }

  const linkedin =
    asList(profile.links).find((l) => String(l.type || '').toLowerCase() === 'linkedin')?.url ||
    '';
  const experiences = asList(profile.experiences);
  const education = asList(profile.education);
  const certifications = asList(profile.certifications);
  const templateName =
    templates.find((t) => t.id === profile.defaultTemplateId)?.name ||
    (profile.defaultTemplateId ? String(profile.defaultTemplateId) : '—');

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-3xl">
      <Link
        href="/profiles"
        className="flex items-center gap-2 text-sm text-slate-500 hover:text-primary mb-6"
      >
        <ArrowLeft className="w-4 h-4" /> Back to Profiles
      </Link>

      <div className="flex items-start justify-between gap-4 mb-6">
        <div className="flex items-center gap-2 min-w-0">
          <UserRound className="w-6 h-6 text-primary shrink-0" />
          <div className="min-w-0">
            <h1 className="text-2xl font-semibold text-slate-800 tracking-tight truncate">
              {String(profile.firstName || '')} {String(profile.lastName || '')}
            </h1>
            {profile.profileTitle ? (
              <p className="text-sm text-slate-500 truncate">{String(profile.profileTitle)}</p>
            ) : null}
          </div>
        </div>
        {isAdmin && (
          <div className="flex items-center gap-2 shrink-0">
            {editing ? (
              <>
                <button
                  type="button"
                  disabled={saving}
                  onClick={cancelEdit}
                  className="px-3 py-2 text-sm font-medium text-slate-700 border border-[var(--border)] rounded-lg hover:bg-slate-50 disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={saving}
                  onClick={handleSave}
                  className="px-4 py-2 text-sm font-medium text-white bg-primary rounded-lg hover:bg-primary-light disabled:opacity-50"
                >
                  {saving ? 'Saving…' : 'Save'}
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={startEdit}
                className="px-4 py-2 text-sm font-medium text-white bg-primary rounded-lg hover:bg-primary-light"
              >
                Edit
              </button>
            )}
          </div>
        )}
      </div>

      {editing ? (
        <ProfileForm values={form} onChange={setForm} templates={templates} idPrefix="edit" />
      ) : (
        <div className="space-y-5">
          {canBid && <ProfileGenerationSettings profileId={id} />}
          <section className="bg-white border border-[var(--border)] rounded-xl p-5 sm:p-6">
            <h2 className="text-sm font-semibold text-slate-800 uppercase tracking-wide mb-4">
              Personal information
            </h2>
            <dl className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
              <div>
                <dt className="text-slate-500">First Name</dt>
                <dd className="text-slate-800 font-medium">{String(profile.firstName || '—')}</dd>
              </div>
              <div>
                <dt className="text-slate-500">Last Name</dt>
                <dd className="text-slate-800 font-medium">{String(profile.lastName || '—')}</dd>
              </div>
              <div>
                <dt className="text-slate-500">Email</dt>
                <dd className="text-slate-800 font-medium">{String(profile.email || '—')}</dd>
              </div>
              <div>
                <dt className="text-slate-500">Phone</dt>
                <dd className="text-slate-800 font-medium">{String(profile.phone || '—')}</dd>
              </div>
              <div>
                <dt className="text-slate-500">Address</dt>
                <dd className="text-slate-800 font-medium">{String(profile.address || '—')}</dd>
              </div>
              <div>
                <dt className="text-slate-500">LinkedIn</dt>
                <dd className="text-slate-800 font-medium break-all">
                  {linkedin ? (
                    <a
                      href={String(linkedin)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-primary hover:underline"
                    >
                      {String(linkedin)}
                    </a>
                  ) : (
                    '—'
                  )}
                </dd>
              </div>
            </dl>
          </section>

          <section className="bg-white border border-[var(--border)] rounded-xl p-5 sm:p-6">
            <h2 className="text-sm font-semibold text-slate-800 uppercase tracking-wide mb-4">
              Education
            </h2>
            {education.length === 0 ? (
              <p className="text-sm text-slate-400">No education listed</p>
            ) : (
              <div className="space-y-4">
                {education.map((e, i) => (
                  <div key={i} className="text-sm border-b border-slate-100 last:border-0 pb-3 last:pb-0">
                    <p className="font-medium text-slate-800">
                      {String(e.institution || '—')}
                      {e.degree ? ` — ${String(e.degree)}` : ''}
                    </p>
                    <p className="text-slate-500">
                      {[e.location, e.startDate, e.endDate].filter(Boolean).map(String).join(' · ') ||
                        '—'}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="bg-white border border-[var(--border)] rounded-xl p-5 sm:p-6">
            <h2 className="text-sm font-semibold text-slate-800 uppercase tracking-wide mb-4">
              Work Experience
            </h2>
            {experiences.length === 0 ? (
              <p className="text-sm text-slate-400">No experience listed</p>
            ) : (
              <div className="space-y-4">
                {experiences.map((e, i) => (
                  <div key={i} className="text-sm border-b border-slate-100 last:border-0 pb-3 last:pb-0">
                    <p className="font-medium text-slate-800">
                      {String(e.title || '—')}
                      {e.company ? ` @ ${String(e.company)}` : ''}
                    </p>
                    <p className="text-slate-500">
                      {[e.location, e.workArrangement, e.startDate, e.endDate]
                        .filter(Boolean)
                        .map(String)
                        .join(' · ') || '—'}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="bg-white border border-[var(--border)] rounded-xl p-5 sm:p-6">
            <h2 className="text-sm font-semibold text-slate-800 uppercase tracking-wide mb-4">
              Certificates
            </h2>
            {certifications.length === 0 ? (
              <p className="text-sm text-slate-400">No certificates listed</p>
            ) : (
              <div className="space-y-4">
                {certifications.map((c, i) => (
                  <div key={i} className="text-sm border-b border-slate-100 last:border-0 pb-3 last:pb-0">
                    <p className="font-medium text-slate-800">{String(c.name || '—')}</p>
                    <p className="text-slate-500">
                      {[c.issuer, c.issueDate, c.expirationDate]
                        .filter(Boolean)
                        .map(String)
                        .join(' · ') || '—'}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="bg-white border border-[var(--border)] rounded-xl p-5 sm:p-6">
            <h2 className="text-sm font-semibold text-slate-800 uppercase tracking-wide mb-4">
              Resume Template
            </h2>
            <p className="text-sm text-slate-800 font-medium">{templateName}</p>
          </section>
        </div>
      )}
    </div>
  );
}
