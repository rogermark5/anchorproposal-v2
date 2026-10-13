'use client';

export function ResumePromptSettings({ mode, content, custom, saving, loaded, dirty, onModeChange, onContentChange, onSave, onReset }: {
  mode: 'user' | 'profile' | 'separate';
  content: string;
  custom: boolean;
  saving: boolean;
  loaded: boolean;
  dirty: boolean;
  onModeChange: (mode: 'user' | 'profile' | 'separate') => void;
  onContentChange: (content: string) => void;
  onSave: () => void;
  onReset: () => void;
}) {
  return (
    <section className="bg-white border border-[var(--border)] rounded-xl p-4 sm:p-6 space-y-4" aria-labelledby="resume-prompt-heading">
      <h2 id="resume-prompt-heading" className="font-medium text-slate-800">Resume prompt</h2>
      <fieldset disabled={saving || !loaded} className="space-y-2">
        <legend className="sr-only">Choose the prompt for your generations</legend>
        <label className="flex items-start gap-3 rounded-lg border border-[var(--border)] p-3 text-sm text-slate-700 has-[:checked]:border-primary has-[:checked]:bg-slate-50">
          <input className="mt-1" type="radio" name="generation-prompt-mode" checked={mode === 'user'} onChange={() => onModeChange('user')} />
          <span>Use one prompt for all my profiles<span className="mt-1 block text-xs text-slate-500">Generate a resume and cover letter together using your prompt below.</span></span>
        </label>
        <label className="flex items-start gap-3 rounded-lg border border-[var(--border)] p-3 text-sm text-slate-700 has-[:checked]:border-primary has-[:checked]:bg-slate-50">
          <input className="mt-1" type="radio" name="generation-prompt-mode" checked={mode === 'profile'} onChange={() => onModeChange('profile')} />
          <span>Use one combined prompt per profile<span className="mt-1 block text-xs text-slate-500">If a profile has no assigned prompt, you’ll be warned before using your default.</span></span>
        </label>
        <label className="flex items-start gap-3 rounded-lg border border-[var(--border)] p-3 text-sm text-slate-700">
          <input className="mt-1" type="radio" name="generation-prompt-mode" checked={mode === 'separate'} onChange={() => onModeChange('separate')} />
          <span>Use separate resume and cover letter prompts per profile<span className="mt-1 block text-xs text-slate-500">Assign both prompts on each profile. The resume is generated first, then the cover letter in a second request.</span></span>
        </label>
      </fieldset>
      <div className="space-y-2">
        <label htmlFor="default-resume-prompt" className="block text-sm font-medium text-slate-700">
          {mode === 'profile' ? 'Default prompt (fallback)' : 'Default prompt'}
        </label>
        <p className="text-xs text-slate-500">{custom ? 'Your custom default.' : 'Shared default.'} Edits are saved only for your account.</p>
        {mode === 'separate' && <p className="text-xs text-slate-500">Separate mode requires both prompts on each profile. The default below is used when you switch to one of the combined modes.</p>}
        <p className="text-xs text-slate-500">Default prompts always use fixed profile positions.</p>
        <textarea id="default-resume-prompt" value={content} onChange={(event) => onContentChange(event.target.value)}
          disabled={saving || !loaded} maxLength={80000} spellCheck={false}
          className="w-full min-h-[18rem] px-3 py-2 border border-[var(--border)] rounded-lg text-sm font-mono whitespace-pre-wrap disabled:opacity-60"
          placeholder={loaded ? 'Enter your default resume prompt…' : 'Loading default prompt…'} />
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" disabled={saving || !loaded || !dirty || !content.trim()} onClick={onSave}
          className="px-4 py-2 bg-primary text-white rounded-lg text-sm disabled:opacity-50">{saving ? 'Saving…' : 'Save resume prompt'}</button>
        {custom && <button type="button" disabled={saving} onClick={onReset}
          className="px-4 py-2 border border-[var(--border)] text-slate-700 rounded-lg text-sm hover:bg-slate-50 disabled:opacity-50">Restore shared default</button>}
      </div>
    </section>
  );
}
