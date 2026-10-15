'use client';
import type { ApplicationOption } from '@/lib/api';
import { ManagedApplicationOption } from '@/components/managed-application-option';
type ProfileOption = {
  id: string;
  firstName: string;
  lastName: string;
  profileTitle: string;
  isDefault?: boolean;
};

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

export function ApplicationFormFields({
  form,
  setForm,
  profiles,
  templates,
  showTemplateSelect,
  showProfileSelect = true,
  locations,
  sources,
  onOptionsChange,
}: {
  form: AppForm;
  setForm: (f: AppForm) => void;
  profiles: ProfileOption[];
  templates: { id: string; name: string; isDefault?: boolean }[];
  showTemplateSelect?: boolean;
  showProfileSelect?: boolean;
  locations: ApplicationOption[];
  sources: ApplicationOption[];
  onOptionsChange: () => Promise<{
    locations: ApplicationOption[];
    sources: ApplicationOption[];
  }>;
}) {
  return (
    <div className="space-y-4">
      <div>
        <label className="block text-sm font-medium text-slate-700 mb-1">Job Title *</label>
        <input
          value={form.jobTitle}
          onChange={(e) => setForm({ ...form, jobTitle: e.target.value })}
          className="w-full px-3 py-2 border border-[var(--border)] rounded-lg text-sm"
          required
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-slate-700 mb-1">Company</label>
        <input
          value={form.company}
          onChange={(e) => setForm({ ...form, company: e.target.value })}
          className="w-full px-3 py-2 border border-[var(--border)] rounded-lg text-sm"
        />
      </div>

      <ManagedApplicationOption
        type="LOCATION"
        label="Location"
        value={form.location}
        onChange={(location) => setForm({ ...form, location })}
        options={locations}
        onOptionsChange={onOptionsChange}
      />

      <div>
        <div className="flex items-center justify-between gap-3 mb-1">
          <label className="block text-sm font-medium text-slate-700 mb-0" htmlFor="app-job-url">
            Job URL
          </label>
          <label className="inline-flex items-center gap-1.5 text-xs text-slate-600 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={form.noJobLink}
              onChange={(e) => {
                const checked = e.target.checked;
                setForm({
                  ...form,
                  noJobLink: checked,
                  jobUrl: '',
                });
              }}
              className="rounded border-slate-300"
            />
            No job link
          </label>
        </div>
        <input
          id="app-job-url"
          value={form.jobUrl}
          onChange={(e) => setForm({ ...form, jobUrl: e.target.value, noJobLink: false })}
          className="w-full px-3 py-2 border border-[var(--border)] rounded-lg text-sm disabled:bg-slate-100 disabled:text-slate-500 disabled:cursor-not-allowed"
          type="url"
          placeholder={form.noJobLink ? 'No job link' : 'https://'}
          disabled={form.noJobLink}
        />
        {form.noJobLink && (
          <p className="mt-1 text-xs text-slate-500">
            This application will be saved without a job link.
          </p>
        )}
      </div>

      <div>
        <label className="block text-sm font-medium text-slate-700 mb-1">Job Description</label>
        <textarea
          value={form.jobDescription}
          onChange={(e) => setForm({ ...form, jobDescription: e.target.value })}
          className="w-full px-3 py-2 border border-[var(--border)] rounded-lg text-sm h-36"
          placeholder="Paste the full job description here..."
        />
      </div>

      <ManagedApplicationOption
        type="SOURCE"
        label="Source"
        value={form.source}
        onChange={(source) => setForm({ ...form, source })}
        options={sources}
        onOptionsChange={onOptionsChange}
      />

      {showProfileSelect && <div>
        <label className="block text-sm font-medium text-slate-700 mb-1">Profile</label>
        <select
          value={form.profileId}
          onChange={(e) => setForm({ ...form, profileId: e.target.value })}
          className="w-full px-3 py-2 border border-[var(--border)] rounded-lg text-sm"
        >
          <option value="">Select profile...</option>
          {profiles.map((p) => (
            <option key={p.id} value={p.id}>
              {p.firstName} {p.lastName}
              {p.profileTitle ? ` — ${p.profileTitle}` : ''}
              {p.isDefault ? ' (Default)' : ''}
            </option>
          ))}
        </select>
      </div>}

      {showTemplateSelect && (
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Template</label>
          <select
            value={form.templateId}
            onChange={(e) => setForm({ ...form, templateId: e.target.value })}
            className="w-full px-3 py-2 border border-[var(--border)] rounded-lg text-sm"
          >
            <option value="">Select template...</option>
            {templates.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
                {t.isDefault ? ' (Default)' : ''}
              </option>
            ))}
          </select>
          <p className="mt-1 text-xs text-slate-500">
            Used when generating resume and cover letter after create. Set the default on Templates.
          </p>
        </div>
      )}
    </div>
  );
}


