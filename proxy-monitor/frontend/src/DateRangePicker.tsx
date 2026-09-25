import { createPortal } from 'preact/compat';
import { useEffect, useRef, useState } from 'preact/hooks';

type Range = { start: Date; end: Date };
type Preset = 'today' | 'yesterday' | 'week' | 'month' | 'year' | '1h' | '12h' | '24h' | '7d' | '30d';

const presets: [Preset, string][] = [
  ['today', 'Today'], ['yesterday', 'Yesterday'], ['week', 'This week'],
  ['month', 'This month'], ['year', 'This year'], ['1h', 'Last hour'],
  ['12h', 'Last 12 hours'], ['24h', 'Last 24 hours'],
  ['7d', 'Last 7 days'], ['30d', 'Last 30 days'],
];
const weekdays = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

function startOfDay(date: Date) { return new Date(date.getFullYear(), date.getMonth(), date.getDate()); }
function sameDay(a: Date, b: Date) { return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate(); }
function rangeLabel(start: Date, end: Date, timeFormat: '12h' | '24h' = '24h') {
  const format = (date: Date) => {
    const monthDay = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(date);
    const time = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit', hour12: timeFormat === '12h' }).format(date);
    return `${monthDay}, ${time}`;
  };
  return `${format(start)} – ${format(end)}`;
}

function TimeInput({
  date,
  disabled,
  timeFormat,
  onChange,
}: {
  date?: Date;
  disabled?: boolean;
  timeFormat: '12h' | '24h';
  onChange: (value: string) => void;
}) {
  const hourRef = useRef<HTMLInputElement>(null);
  const minuteRef = useRef<HTMLInputElement>(null);
  const pad = (n: number) => String(n).padStart(2, '0');
  const is12 = timeFormat === '12h';
  const rawH = date ? date.getHours() : 0;
  const rawM = date ? date.getMinutes() : 0;
  const isPm = rawH >= 12;
  const dispH = is12 ? (rawH % 12 === 0 ? 12 : rawH % 12) : rawH;

  const [hourText, setHourText] = useState(() => (date ? pad(dispH) : ''));
  const [minuteText, setMinuteText] = useState(() => (date ? pad(rawM) : ''));

  useEffect(() => {
    if (date) {
      setHourText(pad(dispH));
      setMinuteText(pad(rawM));
    } else {
      setHourText('');
      setMinuteText('');
    }
  }, [date?.getTime(), timeFormat, dispH, rawM]);

  const commit = (h: number, m: number, pm: boolean) => {
    let finalH = h;
    if (is12) {
      if (pm && h < 12) finalH = h + 12;
      if (!pm && h === 12) finalH = 0;
    }
    finalH = Math.max(0, Math.min(23, finalH));
    const finalM = Math.max(0, Math.min(59, m));
    onChange(`${pad(finalH)}:${pad(finalM)}`);
  };

  const handleHourInput = (event: Event) => {
    const target = event.currentTarget as HTMLInputElement;
    const clean = target.value.replace(/\D/g, '').slice(0, 2);
    setHourText(clean);
    const num = Number(clean);
    if (clean.length > 0 && !isNaN(num)) {
      const maxH = is12 ? 12 : 23;
      if (num <= maxH && (is12 ? num >= 1 : num >= 0)) {
        commit(num, Number(minuteText) || 0, isPm);
      }
    }
    if (clean.length === 2 || (!is12 && Number(clean) > 2) || (is12 && Number(clean) > 1)) {
      minuteRef.current?.focus();
      minuteRef.current?.select();
    }
  };

  const handleMinuteInput = (event: Event) => {
    const target = event.currentTarget as HTMLInputElement;
    const clean = target.value.replace(/\D/g, '').slice(0, 2);
    setMinuteText(clean);
    const num = Number(clean);
    if (clean.length > 0 && !isNaN(num) && num <= 59) {
      commit(Number(hourText) || (is12 ? 12 : 0), num, isPm);
    }
  };

  const handleHourBlur = () => {
    if (!date) return;
    let num = Number(hourText);
    if (isNaN(num) || hourText.trim() === '') num = dispH;
    if (is12) {
      if (num < 1) num = 1;
      if (num > 12) num = 12;
    } else {
      if (num < 0) num = 0;
      if (num > 23) num = 23;
    }
    setHourText(pad(num));
    commit(num, Number(minuteText) || 0, isPm);
  };

  const handleMinuteBlur = () => {
    if (!date) return;
    let num = Number(minuteText);
    if (isNaN(num) || minuteText.trim() === '') num = rawM;
    if (num < 0) num = 0;
    if (num > 59) num = 59;
    setMinuteText(pad(num));
    commit(Number(hourText) || (is12 ? 12 : 0), num, isPm);
  };

  const stepHour = (delta: number) => {
    if (!date || disabled) return;
    let cur = Number(hourText);
    if (isNaN(cur)) cur = dispH;
    let next: number;
    if (is12) {
      next = cur + delta;
      if (next > 12) next = 1;
      if (next < 1) next = 12;
    } else {
      next = (cur + delta + 24) % 24;
    }
    setHourText(pad(next));
    commit(next, Number(minuteText) || 0, isPm);
  };

  const stepMinute = (delta: number) => {
    if (!date || disabled) return;
    let cur = Number(minuteText);
    if (isNaN(cur)) cur = rawM;
    const next = (cur + delta + 60) % 60;
    setMinuteText(pad(next));
    commit(Number(hourText) || (is12 ? 12 : 0), next, isPm);
  };

  const handleHourKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      stepHour(1);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      stepHour(-1);
    } else if (e.key === ':' || e.key === 'ArrowRight' || e.key === 'Enter') {
      e.preventDefault();
      minuteRef.current?.focus();
      minuteRef.current?.select();
    }
  };

  const handleMinuteKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      stepMinute(e.shiftKey ? 5 : 1);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      stepMinute(e.shiftKey ? -5 : -1);
    } else if (e.key === 'ArrowLeft' && minuteRef.current?.selectionStart === 0) {
      e.preventDefault();
      hourRef.current?.focus();
      hourRef.current?.select();
    } else if (e.key === 'Backspace' && minuteText === '') {
      e.preventDefault();
      hourRef.current?.focus();
      hourRef.current?.select();
    }
  };

  const toggleAmPm = () => {
    if (!date || disabled) return;
    commit(Number(hourText) || (is12 ? 12 : 0), Number(minuteText) || 0, !isPm);
  };

  return (
    <div class={`time-input ${disabled ? 'disabled' : ''}`}>
      <input
        ref={hourRef}
        type="text"
        inputMode="numeric"
        class="time-part"
        value={hourText}
        disabled={disabled}
        aria-label="Hours"
        maxLength={2}
        onFocus={e => (e.currentTarget as HTMLInputElement).select()}
        onInput={handleHourInput}
        onBlur={handleHourBlur}
        onKeyDown={handleHourKeyDown}
        onWheel={e => {
          e.preventDefault();
          stepHour(e.deltaY < 0 ? 1 : -1);
        }}
      />
      <span class="time-sep">:</span>
      <input
        ref={minuteRef}
        type="text"
        inputMode="numeric"
        class="time-part"
        value={minuteText}
        disabled={disabled}
        aria-label="Minutes"
        maxLength={2}
        onFocus={e => (e.currentTarget as HTMLInputElement).select()}
        onInput={handleMinuteInput}
        onBlur={handleMinuteBlur}
        onKeyDown={handleMinuteKeyDown}
        onWheel={e => {
          e.preventDefault();
          stepMinute(e.deltaY < 0 ? 1 : -1);
        }}
      />
      {is12 && (
        <button
          type="button"
          class="time-ampm"
          disabled={disabled}
          onClick={toggleAmPm}
          aria-label="Toggle AM/PM"
        >
          {isPm ? 'PM' : 'AM'}
        </button>
      )}
    </div>
  );
}
function presetRange(preset: Preset, now: Date): Range {
  const end = new Date(now);
  const start = startOfDay(now);
  if (preset === 'today') return { start, end };
  if (preset === 'yesterday') {
    start.setDate(start.getDate() - 1);
    return { start, end: new Date(start.getFullYear(), start.getMonth(), start.getDate(), 23, 59) };
  }
  if (preset === 'week') start.setDate(start.getDate() - (start.getDay() + 6) % 7);
  else if (preset === 'month') start.setDate(1);
  else if (preset === 'year') { start.setMonth(0); start.setDate(1); }
  else {
    const hours = { '1h': 1, '12h': 12, '24h': 24, '7d': 168, '30d': 720 }[preset];
    return { start: new Date(now.getTime() - hours * 3600000), end };
  }
  return { start, end };
}

export function DateRangePicker({ fromTs, toTs, hours, retentionDays, timeFormat = '24h', onChange }: {
  fromTs?: number; toTs?: number; hours: number; retentionDays: number; timeFormat?: '12h' | '24h';
  onChange: (from: number, to: number) => void;
}) {
  const trigger = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0, width: 540 });
  const [month, setMonth] = useState(() => startOfDay(new Date()));
  const [draftStart, setDraftStart] = useState<Date>();
  const [draftEnd, setDraftEnd] = useState<Date>();
  const [choosingEnd, setChoosingEnd] = useState(false);
  const now = new Date();
  const from = new Date(fromTs ? fromTs * 1000 : now.getTime() - hours * 3600000);
  const to = new Date(toTs ? toTs * 1000 : now.getTime());
  const earliest = new Date(now.getTime() - retentionDays * 86400000);

  const place = () => {
    const rect = trigger.current?.getBoundingClientRect();
    if (!rect) return;
    const width = Math.min(540, window.innerWidth - 24);
    const height = Math.min(panel.current?.getBoundingClientRect().height ?? 510, window.innerHeight - 24);
    const left = Math.max(12, Math.min(rect.left, window.innerWidth - width - 12));
    const top = rect.bottom + 4 + height <= window.innerHeight - 12
      ? rect.bottom + 4 : Math.max(12, rect.top - height - 4);
    setPosition({ top, left, width });
  };
  const show = () => {
    setDraftStart(from);
    setDraftEnd(to);
    setChoosingEnd(false);
    setMonth(new Date(from.getFullYear(), from.getMonth(), 1));
    place();
    setOpen(true);
  };

  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (!panel.current?.contains(event.target as Node) && !trigger.current?.contains(event.target as Node)) setOpen(false);
    };
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.stopPropagation(); setOpen(false); } };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', key, true);
    window.addEventListener('resize', place);
    const frame = window.requestAnimationFrame(place);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', key, true);
      window.removeEventListener('resize', place);
    };
  }, [open]);

  const choosePreset = (preset: Preset) => {
    const range = presetRange(preset, new Date());
    setDraftStart(range.start);
    setDraftEnd(range.end);
    setChoosingEnd(false);
    setMonth(new Date(range.start.getFullYear(), range.start.getMonth(), 1));
  };
  const chooseDay = (day: Date) => {
    if (!choosingEnd || !draftStart) {
      setDraftStart(new Date(Math.max(startOfDay(day).getTime(), earliest.getTime())));
      setDraftEnd(undefined);
      setChoosingEnd(true);
    } else {
      const end = new Date(day.getFullYear(), day.getMonth(), day.getDate(), 23, 59);
      if (day < startOfDay(draftStart)) {
        setDraftEnd(new Date(draftStart.getFullYear(), draftStart.getMonth(), draftStart.getDate(), 23, 59));
        setDraftStart(new Date(Math.max(startOfDay(day).getTime(), earliest.getTime())));
      } else setDraftEnd(end > new Date() ? new Date() : end);
      setChoosingEnd(false);
    }
    setMonth(new Date(day.getFullYear(), day.getMonth(), 1));
  };
  const changeTime = (which: 'start' | 'end', value: string) => {
    const [hour = NaN, minute = NaN] = value.split(':').map(Number);
    if (!Number.isFinite(hour) || !Number.isFinite(minute)) return;
    const date = which === 'start' ? draftStart : draftEnd;
    if (!date) return;
    const next = new Date(date);
    next.setHours(hour, minute, 0, 0);
    if (which === 'start') setDraftStart(next);
    else setDraftEnd(next);
  };
  const apply = () => {
    if (!draftStart || !draftEnd || draftEnd <= draftStart || draftEnd > new Date()) return;
    onChange(Math.floor(draftStart.getTime() / 1000), Math.floor(draftEnd.getTime() / 1000));
    setOpen(false);
  };
  const shift = (direction: -1 | 1) => {
    const duration = to.getTime() - from.getTime();
    const nextStart = from.getTime() + direction * duration;
    const nextEnd = to.getTime() + direction * duration;
    if (nextEnd > Date.now() || nextStart < earliest.getTime()) return;
    onChange(Math.floor(nextStart / 1000), Math.floor(nextEnd / 1000));
  };

  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  const offset = (first.getDay() + 6) % 7;
  const dayCount = Math.ceil((offset + new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate()) / 7) * 7;
  const days = Array.from({ length: dayCount }, (_, index) => new Date(month.getFullYear(), month.getMonth(), index - offset + 1));
  const monthStart = new Date(month.getFullYear(), month.getMonth(), 1);
  const earliestMonth = new Date(earliest.getFullYear(), earliest.getMonth(), 1);
  const currentMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const valid = !!draftStart && !!draftEnd && draftEnd > draftStart && draftEnd <= now && draftStart >= earliest;
  const earliestLabel = new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
    hour12: timeFormat === '12h',
  }).format(earliest);

  return <>
    <div class="range-trigger" ref={trigger}>
      <button type="button" class="range-nav" aria-label="Previous range" disabled={from.getTime() - (to.getTime() - from.getTime()) < earliest.getTime()} onClick={() => shift(-1)}>‹</button>
      <button type="button" class="range-main" aria-label={`Date range: ${rangeLabel(from, to, timeFormat)}`} aria-expanded={open} onClick={() => open ? setOpen(false) : show()}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M7 3v4m10-4v4M3 10h18" /></svg>
        <span>{rangeLabel(from, to, timeFormat)}</span>
      </button>
      <button type="button" class="range-nav" aria-label="Next range" disabled={to.getTime() + (to.getTime() - from.getTime()) > now.getTime()} onClick={() => shift(1)}>›</button>
    </div>
    {open && createPortal(<div class="range-popover" ref={panel} style={{ top: position.top, left: position.left, width: position.width }} role="dialog" aria-label="Select date range">
      <div class="range-picker-body">
        <div class="range-presets">{presets.map(([value, label]) => {
          const unavailable = presetRange(value, now).start < earliest;
          return <button type="button" key={value} disabled={unavailable} title={unavailable ? `History is available from ${earliestLabel}` : undefined}
            onClick={() => choosePreset(value)}>{label}</button>;
        })}</div>
        <div class="range-calendar">
          <div class="range-month-heading">
            <button type="button" aria-label="Previous month" disabled={monthStart <= earliestMonth} onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}>‹</button>
            <strong>{new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' }).format(month)}</strong>
            <button type="button" aria-label="Current month" onClick={() => setMonth(new Date(now.getFullYear(), now.getMonth(), 1))}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M7 3v4m10-4v4M3 10h18" /></svg></button>
            <button type="button" aria-label="Next month" disabled={monthStart >= currentMonth} onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}>›</button>
          </div>
          <div class="range-days" role="grid" aria-label={new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' }).format(month)}>
            {weekdays.map((day, index) => <span class="weekday" key={index}>{day}</span>)}
            {days.map(day => {
              const selectedStart = draftStart && sameDay(day, draftStart);
              const selectedEnd = draftEnd && sameDay(day, draftEnd);
              const between = draftStart && draftEnd && day > startOfDay(draftStart) && day < startOfDay(draftEnd);
              const outside = day.getMonth() !== month.getMonth();
              const disabled = day < startOfDay(earliest) || day > startOfDay(now);
              return <button type="button" key={day.getTime()} class={`range-day ${outside ? 'outside' : ''} ${between ? 'between' : ''} ${selectedStart ? 'range-start' : ''} ${selectedEnd ? 'range-end' : ''} ${sameDay(day, now) ? 'today' : ''}`}
                aria-label={new Intl.DateTimeFormat(undefined, { dateStyle: 'full' }).format(day)} aria-pressed={!!(selectedStart || selectedEnd || between)} disabled={disabled} onClick={() => chooseDay(day)}>{day.getDate()}</button>;
            })}
          </div>
          <div class="range-times">
            <label>Time from
              <TimeInput date={draftStart} disabled={!draftStart} timeFormat={timeFormat} onChange={val => changeTime('start', val)} />
            </label>
            <label>Time to
              <TimeInput date={draftEnd} disabled={!draftEnd} timeFormat={timeFormat} onChange={val => changeTime('end', val)} />
            </label>
          </div>
        </div>
      </div>
      <div class="range-picker-footer"><span class="range-hint">History available from {earliestLabel}</span>
        <button type="button" class="text-button" onClick={() => setOpen(false)}>Cancel</button><button type="button" class="btn btn-primary" disabled={!valid} onClick={apply}>Select</button></div>
    </div>, document.body)}
  </>;
}
