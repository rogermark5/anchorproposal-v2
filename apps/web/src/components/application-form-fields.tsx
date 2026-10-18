'use client';
import type { ApplicationOption } from '@/lib/api';
import { ManagedApplicationOption } from '@/components/managed-application-option';
import type { DraftValidation } from '@/lib/use-application-validation';
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
  validation,
}: {
  form: AppForm;
  setForm: (f: AppForm) => void;
  profiles: ProfileOption[];
  templates: { id: string; name: string; isDefault?: boolean }[];
  showTemplateSelect?: boolean;
  showProfileSelect?: boolean;
  validation?: DraftValidation;
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
        <label htmlFor="app-job-title" className="block text-sm font-medium text-slate-700 mb-1">Job Title *</label>
        <input
          id="app-job-title"
          value={form.jobTitle}
          onChange={(e) => setForm({ ...form, jobTitle: e.target.value })}
          className="w-full px-3 py-2 border border-[var(--border)] rounded-lg text-sm"
          required
        />
      </div>

      <div>
        <label htmlFor="app-company" className="block text-sm font-medium text-slate-700 mb-1">Company</label>
        <input
          id="app-company"
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
        <label htmlFor="app-job-description" className="block text-sm font-medium text-slate-700 mb-1">Job Description</label>
        <textarea
          id="app-job-description"
          value={form.jobDescription}
          onChange={(e) => setForm({ ...form, jobDescription: e.target.value })}
          className="w-full px-3 py-2 border border-[var(--border)] rounded-lg text-sm h-36"
          placeholder="Paste the full job description here..."
        />
        {validation && <div className="mt-2 text-sm" aria-live="polite" data-testid="jd-validation">
          {validation.needsProfile && <p className="text-slate-500">Select a profile to check the description.</p>}
          {validation.pending && <p role="status" className="text-slate-500">Checking job description…</p>}
          {validation.error && <p role="alert" className="text-red-700">{validation.error} Edit the description to retry.</p>}
          {validation.result && (validation.result.warnings.length ? <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-amber-900">
            <p className="font-medium">Review before creating an application</p>
            {validation.result.warnings.map((warning, index) => <p key={index} className="mt-2">{warning.matchedText}</p>)}
            {!validation.result.allowed ? <p className="mt-2 font-medium" role="alert">Resolve blocked warnings or contact your admin before creating this application.</p> : <label className="mt-3 flex items-start gap-2"><input type="checkbox" checked={validation.reviewed} onChange={event => validation.setReviewed(event.target.checked)} className="mt-1"/>I reviewed these warnings and want to save this application.</label>}
          </div> : <p className="text-emerald-700">Job description checked. No warnings found.</p>)}
        </div>}
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


