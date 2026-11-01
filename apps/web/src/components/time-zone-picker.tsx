'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown, Search } from 'lucide-react';
import { timeZoneOffset } from '@anchorproposal/shared';

const fallbackZones = ['America/Los_Angeles', 'America/New_York', 'Europe/London', 'Europe/Dublin', 'Asia/Kolkata', 'Asia/Tokyo'];
export function TimeZonePicker({ value, onChange, disabled = false }: { value: string; onChange: (zone: string) => void; disabled?: boolean }) {
  const id = useId(), trigger = useRef<HTMLButtonElement>(null), panel = useRef<HTMLDivElement>(null), input = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false), [query, setQuery] = useState(''), [active, setActive] = useState(0);
  const [position, setPosition] = useState({ left: 0, top: 0, width: 0, height: 320 });
  const options = useMemo(() => {
    const supported = (Intl as typeof Intl & { supportedValuesOf?: (key: string) => string[] }).supportedValuesOf?.('timeZone') || fallbackZones;
    const now = new Date();
    return [...new Set(['UTC', value, ...supported])].map(zone => ({ zone, name: zone.replace(/_/g, ' '), offset: timeZoneOffset(zone, now) })).sort((a, b) => a.name.localeCompare(b.name));
  }, [value, open]);
  const filtered = useMemo(() => {
    const words = query.toLowerCase().trim().split(/\s+/);
    return options.filter(option => words.every(word => `${option.name} ${option.offset} ${option.offset.replace(/:00$/, '').replace(/([+-])0/, '$1')}`.toLowerCase().includes(word)));
  }, [query, options]);
  const selected = options.find(option => option.zone === value)!;
  const close = (focus = false) => { setOpen(false); if (focus) trigger.current?.focus(); };
  const show = () => { setQuery(''); setActive(Math.max(0, options.findIndex(option => option.zone === value))); setOpen(true); };
  const choose = (zone: string) => { onChange(zone); close(true); };
  useEffect(() => {
    if (!open) return;
    const place = () => {
      const rect = trigger.current?.getBoundingClientRect();
      if (!rect) return;
      const below = window.innerHeight - rect.bottom - 12, above = rect.top - 12;
      const height = Math.min(360, Math.max(150, below >= 220 || below >= above ? below : above));
      const width = Math.min(Math.max(rect.width, 300), window.innerWidth - 24);
      setPosition({ left: Math.max(12, Math.min(rect.left, window.innerWidth - width - 12)), top: below >= 220 || below >= above ? rect.bottom + 6 : rect.top - height - 6, width, height });
    };
    place(); input.current?.focus();
    const outside = (event: PointerEvent) => { if (!panel.current?.contains(event.target as Node) && !trigger.current?.contains(event.target as Node)) close(); };
    const scroll = (event: Event) => { if (!panel.current?.contains(event.target as Node)) place(); };
    document.addEventListener('pointerdown', outside); window.addEventListener('resize', place); window.addEventListener('scroll', scroll, true);
    return () => { document.removeEventListener('pointerdown', outside); window.removeEventListener('resize', place); window.removeEventListener('scroll', scroll, true); };
  }, [open]);
  useEffect(() => { if (open) document.getElementById(`${id}-option-${active}`)?.scrollIntoView({ block: 'nearest' }); }, [active, open, id]);
  return <div className="max-w-lg">
    <span id={`${id}-label`} className="block text-sm">Display time zone</span>
    <button ref={trigger} type="button" disabled={disabled} aria-label="Display time zone" aria-haspopup="listbox" aria-expanded={open} aria-controls={open ? `${id}-list` : undefined}
      className="mt-2 flex w-full items-center justify-between gap-3 rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-left text-sm hover:border-teal-600 focus:outline-none focus:ring-2 focus:ring-teal-500 disabled:opacity-50"
      onKeyDown={event => { if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); show(); } }}
      onClick={() => { if (open) close(); else show(); }}>
      <span className="min-w-0 truncate"><span className="mr-2 font-medium text-teal-700">{selected.offset}</span>{selected.name}</span><ChevronDown className="h-4 w-4 shrink-0 text-slate-500" />
    </button>
    {open && createPortal(<div ref={panel} className="fixed z-[100] flex flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl" style={{ left: position.left, top: position.top, width: position.width, height: position.height }}
      onKeyDown={event => {
        if (event.key === 'Escape') { event.preventDefault(); close(true); }
        if (event.key === 'Tab') close();
      }}>
      <div className="relative shrink-0 border-b border-slate-100 p-3"><Search className="absolute left-6 top-6 h-4 w-4 text-slate-400" />
        <input ref={input} role="combobox" aria-label="Search time zones" aria-autocomplete="list" aria-expanded="true" aria-controls={`${id}-list`} aria-activedescendant={filtered[active] ? `${id}-option-${active}` : undefined}
          placeholder="Search city, zone or GMT offset…" value={query} onChange={event => { setQuery(event.target.value); setActive(0); }}
          className="w-full rounded-lg border border-slate-300 py-2 pl-9 pr-3 text-sm outline-none focus:border-teal-600 focus:ring-1 focus:ring-teal-600"
          onKeyDown={event => {
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); setActive(index => Math.max(0, Math.min(filtered.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1)))); }
            if (event.key === 'Enter') { event.preventDefault(); if (filtered[active]) choose(filtered[active].zone); }
          }} />
      </div>
      <ul id={`${id}-list`} role="listbox" aria-labelledby={`${id}-label`} className="min-h-0 flex-1 overflow-y-auto p-1">
        {filtered.map((option, index) => <li key={option.zone} id={`${id}-option-${index}`} role="option" aria-selected={option.zone === value}
          className={`flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2 text-sm ${active === index ? 'bg-teal-50 text-teal-900' : 'text-slate-700 hover:bg-slate-50'}`}
          onPointerMove={() => setActive(index)} onMouseDown={event => event.preventDefault()} onClick={() => choose(option.zone)}>
          <span className="w-24 shrink-0 font-mono text-xs text-teal-700">{option.offset}</span><span className="min-w-0 flex-1 break-words">{option.name}</span>{option.zone === value && <Check className="h-4 w-4 shrink-0 text-teal-700" />}
        </li>)}
        {!filtered.length && <li className="p-4 text-sm text-slate-500" role="presentation">No matching time zones.</li>}
      </ul>
      <p className="shrink-0 border-t border-slate-100 px-3 py-2 text-xs text-slate-500" role="status">{filtered.length} time zones · GMT offsets include current daylight saving.</p>
    </div>, document.body)}
  </div>;
}
