'use client';

import { useState } from 'react';
import { lastDays } from '@/lib/dates';
import { useI18n } from '@/lib/i18n';
import { Button, Input } from './ui';

export function useRange(days = 30) {
  return useState(lastDays(days));
}

export function DateRange({ value, onChange }: { value: { from: string; to: string }; onChange: (v: { from: string; to: string }) => void }) {
  const { t, fmt } = useI18n();
  const [draft, setDraft] = useState(value);
  return (
    <form
      className="flex flex-wrap items-center gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (draft.from && draft.to && draft.from <= draft.to) onChange(draft);
      }}
    >
      {[7, 30, 90].map((n) => (
        <Button
          key={n}
          size="sm"
          variant="ghost"
          onClick={() => {
            const r = lastDays(n);
            setDraft(r);
            onChange(r);
          }}
        >
          {fmt(t.common.lastDays, { n })}
        </Button>
      ))}
      <Input type="date" aria-label={t.common.from} value={draft.from} onChange={(e) => setDraft({ ...draft, from: e.target.value })} className="h-9 w-40" />
      <span className="text-muted" aria-hidden="true">
        –
      </span>
      <Input type="date" aria-label={t.common.to} value={draft.to} onChange={(e) => setDraft({ ...draft, to: e.target.value })} className="h-9 w-40" />
      <Button type="submit" size="sm" variant="secondary">
        {t.common.apply}
      </Button>
    </form>
  );
}
