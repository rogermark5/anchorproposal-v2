'use client';
import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react';
import { shiftCalendarDay } from '@anchorproposal/shared';
import { todayInTimeZone } from '@/lib/time-zone';
import { useTimeZone } from './time-zone-settings';
export type DateRange = { from: string; to: string };
const label = (day: string) => new Date(day + 'T12:00:00Z').toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric', year: 'numeric' });
export function DateRangePicker({ value, onChange }: { value: DateRange; onChange: (value: DateRange) => void }) {
  const { timeZone } = useTimeZone();
  const [open, setOpen] = useState(false), [start, setStart] = useState<string | null>(null), [month, setMonth] = useState(value.from.slice(0, 7));
  const box = useRef<HTMLDivElement>(null), trigger = useRef<HTMLButtonElement>(null), id = useId();
  const popup = useRef<HTMLDivElement>(null);
  const previousToday = useRef(todayInTimeZone());
  useEffect(() => {
    const today = todayInTimeZone();
    if (today !== previousToday.current && value.from === previousToday.current && value.to === previousToday.current) onChange({ from: today, to: today });
    previousToday.current = today;
  }, [timeZone]);
  const [position, setPosition] = useState({ left: 8, top: 80 });
  useEffect(() => {
    if (!open) return;
    const place = () => { const rect = trigger.current?.getBoundingClientRect(); if (rect) setPosition({ left: Math.max(8, Math.min(rect.left + rect.width / 2 - 168, window.innerWidth - 344)), top: Math.max(8, Math.min(rect.bottom + 8, window.innerHeight - (popup.current?.offsetHeight || 450) - 8)) }); };
    place();
    const outside = (event: PointerEvent) => { if (!box.current?.contains(event.target as Node) && !popup.current?.contains(event.target as Node)) { setOpen(false); setStart(null); } };
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') { setOpen(false); setStart(null); trigger.current?.focus(); } };
    document.addEventListener('pointerdown', outside); document.addEventListener('keydown', key);
    window.addEventListener('resize', place); window.addEventListener('scroll', place, true);
    popup.current?.querySelector<HTMLButtonElement>('button')?.focus();
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', key); window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true); };
  }, [open]);
  const move = (by: number) => { const date = new Date(month + '-01T12:00:00Z'); date.setUTCMonth(date.getUTCMonth() + by); setMonth(date.toISOString().slice(0, 7)); };
  const select = (day: string) => {
    if (!start) { setStart(day); return; }
    onChange({ from: day < start ? day : start, to: day < start ? start : day }); setStart(null); setOpen(false); trigger.current?.focus();
  };
  const first = month + '-01', offset = new Date(first + 'T12:00:00Z').getUTCDay();
  return <div ref={box} className="relative inline-block text-sm">
    <button ref={trigger} type="button" aria-expanded={open} aria-controls={id} aria-label="Application creation date range" onClick={() => { setMonth(value.from.slice(0, 7)); setStart(null); setOpen(!open); }} className="flex items-center gap-3 rounded-lg border border-slate-300 bg-white px-4 py-2 text-primary"><CalendarDays size={17}/><span>{label(value.from)}{value.to !== value.from && ` - ${label(value.to)}`}</span></button>
    {open && createPortal(<div ref={popup} id={id} role="dialog" aria-label="Choose application creation dates" style={position} className="fixed z-[200] max-h-[calc(100dvh-1rem)] w-[min(21rem,calc(100vw-1rem))] overflow-y-auto rounded-xl border border-slate-200 bg-white p-4 text-slate-700 shadow-xl">
      <div className="mb-3 grid grid-cols-2 gap-2 text-xs"><div className="rounded-lg bg-slate-50 p-2">From<strong className="mt-1 block">{label(start || value.from)}</strong></div><div className="rounded-lg bg-slate-50 p-2">To<strong className="mt-1 block">{start ? 'Choose end date' : label(value.to)}</strong></div></div>
      <div className="flex items-center justify-between"><button aria-label="Previous month" type="button" onClick={() => move(-1)} className="rounded p-2 hover:bg-slate-100"><ChevronLeft size={18}/></button><strong>{new Date(first + 'T12:00:00Z').toLocaleDateString('en-US', { timeZone: 'UTC', month: 'long', year: 'numeric' })}</strong><button aria-label="Next month" type="button" onClick={() => move(1)} className="rounded p-2 hover:bg-slate-100"><ChevronRight size={18}/></button></div>
      <div className="mt-2 grid grid-cols-7 gap-1">{['Su','Mo','Tu','We','Th','Fr','Sa'].map(day => <span key={day} className="py-1 text-center text-xs text-slate-400">{day}</span>)}{Array.from({ length: 42 }, (_, index) => {
        const day = shiftCalendarDay(first, index - offset), selected = start ? day === start : day >= value.from && day <= value.to;
        return <button type="button" key={day} aria-label={label(day)} aria-pressed={selected} onClick={() => select(day)} className={`rounded py-2 text-center focus-visible:outline-primary ${selected ? 'bg-primary text-white' : day.startsWith(month) ? 'hover:bg-teal-50' : 'text-slate-300 hover:bg-slate-50'}`}>{Number(day.slice(-2))}</button>;
      })}</div>
      <p className="mt-2 text-xs text-slate-500" role="status">{start ? 'Choose the last day. Both dates are included.' : 'Choose a first day, then a last day.'} · {timeZone.replace(/_/g, ' ')}</p>
      <div className="mt-3 flex justify-between"><button type="button" className="rounded border border-slate-300 px-3 py-1" onClick={() => { const today = todayInTimeZone(); onChange({ from: today, to: today }); setOpen(false); setStart(null); trigger.current?.focus(); }}>Today</button><button type="button" onClick={() => { setOpen(false); setStart(null); trigger.current?.focus(); }}>Close</button></div>
    </div>, document.body)}
  </div>;
}
