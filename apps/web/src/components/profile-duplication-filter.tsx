'use client';
type Profile = { id: string; firstName: string; lastName: string };
export function ProfileDuplicationFilter({ profiles, selected, onChange }: { profiles: Profile[]; selected: string[]; onChange: (ids: string[]) => void }) {
  return <details className="relative col-span-2 text-sm sm:col-span-4 xl:col-span-full">
    <summary className="w-fit cursor-pointer rounded-lg border border-slate-300 bg-white px-3 py-2 font-medium text-slate-700">Exclude companies applied with profiles {selected.length ? `(${selected.length} selected)` : '(off)'}</summary>
    <div className="absolute left-0 top-full z-30 mt-2 w-[min(24rem,85vw)] rounded-xl border border-slate-200 bg-white p-4 shadow-xl">
      <p className="mb-3 text-xs text-slate-500">Hide companies in your applications or Applied marks for any selected profile. Company matching ignores capitalization and spaces.</p>
      <div className="max-h-60 space-y-1 overflow-y-auto">{profiles.map(profile => <label key={profile.id} className="flex cursor-pointer items-center gap-2 rounded p-2 hover:bg-slate-50"><input type="checkbox" checked={selected.includes(profile.id)} onChange={event => onChange(event.target.checked ? [...selected, profile.id] : selected.filter(id => id !== profile.id))}/>{profile.firstName} {profile.lastName}</label>)}</div>
      {!profiles.length && <p className="text-xs text-slate-500">No profiles are available.</p>}
      <button type="button" className="mt-3 text-xs text-primary underline" onClick={() => onChange([])}>Clear selection</button>
    </div>
  </details>;
}
