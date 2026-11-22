'use client';

import Link from 'next/link';
import { useRef, useState, type ReactNode } from 'react';
import { dictionaries, languages, locales, type Lang } from '@/i18n';
import { api, ApiError, uploadToSlot } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import type { Localized, UploadSlot } from '@/lib/types';
import { Icon } from './icons';
import { Button, Field, Input, Textarea, cx, useToast } from './ui';

export function LinkButton({
  href,
  children,
  variant = 'primary',
  icon,
}: {
  href: string;
  children: ReactNode;
  variant?: 'primary' | 'secondary';
  icon?: Parameters<typeof Icon>[0]['name'];
}) {
  return (
    <Link
      href={href}
      className={cx(
        'inline-flex h-10 items-center justify-center gap-2 rounded-lg px-4 text-sm font-medium shadow-sm transition-colors',
        variant === 'primary' ? 'bg-brand-600 text-white hover:bg-brand-700' : 'border border-line bg-white text-ink hover:bg-stone-50',
      )}
    >
      {icon && <Icon name={icon} className="h-[18px] w-[18px]" />}
      {children}
    </Link>
  );
}

/** Field errors of a 400 validation_failed, translated; the first error per field. */
export function fieldErrors(error: unknown, translate: (code: string) => string): Record<string, string> {
  if (!(error instanceof ApiError)) return {};
  const out: Record<string, string> = {};
  for (const [field, codes] of Object.entries(error.errors)) {
    const code = codes[0];
    if (code) out[field] = translate(code);
  }
  return out;
}

export function emptyToNull(map: Localized | null | undefined): Localized | null {
  if (!map) return null;
  const clean = Object.fromEntries(Object.entries(map).filter(([, v]) => v.trim() !== '').map(([k, v]) => [k, v.trim()]));
  return Object.keys(clean).length ? clean : null;
}

export function splitList(text: string): string[] {
  return text
    .split(/[,\n|]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** One input per language as tabs (TR / EN …). The default language (first in the registry) is the required one. */
export function LocalizedField({
  label,
  value,
  onChange,
  multiline,
  required,
  error,
  maxLength,
  id,
}: {
  label: string;
  value: Localized | null;
  onChange: (next: Localized) => void;
  multiline?: boolean;
  required?: boolean;
  error?: string | null;
  maxLength?: number;
  id: string;
}) {
  const { t, lang } = useI18n();
  const [active, setActive] = useState<Lang>(lang);
  const current = value?.[active] ?? '';
  const set = (text: string) => onChange({ ...(value ?? {}), [active]: text });
  return (
    <Field label={label} required={required} error={error} htmlFor={`${id}-${active}`}>
      <div className="rounded-lg border border-line">
        <div role="tablist" aria-label={`${label} — ${t.common.language}`} className="flex gap-1 border-b border-line bg-stone-50 px-2 pt-1.5">
          {languages.map((l) => {
            const filled = !!value?.[l]?.trim();
            return (
              <button
                key={l}
                type="button"
                role="tab"
                aria-selected={l === active}
                onClick={() => setActive(l)}
                className={cx(
                  '-mb-px flex items-center gap-1.5 rounded-t-md border border-b-0 px-3 py-1 text-xs font-semibold',
                  l === active ? 'border-line bg-white text-ink' : 'border-transparent text-muted hover:text-ink',
                )}
              >
                {l.toLocaleUpperCase(locales[l])}
                <span className={cx('h-1.5 w-1.5 rounded-full', filled ? 'bg-emerald-500' : 'bg-stone-300')} aria-hidden="true" />
                <span className="sr-only">{dictionaries[l].meta.languageName}</span>
              </button>
            );
          })}
        </div>
        <div className="p-2">
          {multiline ? (
            <Textarea
              id={`${id}-${active}`}
              value={current}
              maxLength={maxLength}
              onChange={(e) => set(e.target.value)}
              className="border-0 focus:ring-0"
              invalid={!!error}
            />
          ) : (
            <Input id={`${id}-${active}`} value={current} maxLength={maxLength} onChange={(e) => set(e.target.value)} className="border-0 focus:ring-0" invalid={!!error} />
          )}
        </div>
      </div>
    </Field>
  );
}

export type UploadPurpose = 'product' | 'brand' | 'edit' | 'collection' | 'library' | 'feed';
const ACCEPT = 'image/jpeg,image/png,image/webp';

export function useImageUpload(purpose: UploadPurpose) {
  const { errorText } = useI18n();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const upload = async (file: File): Promise<string | null> => {
    setBusy(true);
    try {
      const slot = await api.post<UploadSlot>('v1/admin/image/upload-url', { purpose, contentType: file.type });
      if (file.size > slot.maxBytes) throw new ApiError(400, 'upload_failed');
      await uploadToSlot(slot, file);
      return slot.publicUrl;
    } catch (error) {
      toast.error(errorText(error));
      return null;
    } finally {
      setBusy(false);
    }
  };
  return { upload, busy };
}

export function UploadButton({ purpose, onUploaded, size = 'md' }: { purpose: UploadPurpose; onUploaded: (url: string) => void; size?: 'sm' | 'md' }) {
  const { t } = useI18n();
  const input = useRef<HTMLInputElement>(null);
  const { upload, busy } = useImageUpload(purpose);
  return (
    <>
      <input
        ref={input}
        type="file"
        accept={ACCEPT}
        className="hidden"
        aria-label={t.common.upload}
        onChange={async (e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (!file) return;
          const url = await upload(file);
          if (url) onUploaded(url);
        }}
      />
      <Button variant="secondary" size={size} icon="upload" loading={busy} onClick={() => input.current?.click()}>
        {busy ? t.common.uploading : t.common.upload}
      </Button>
    </>
  );
}

/** A single image: preview, upload, or paste an https URL. */
export function ImageField({
  label,
  value,
  onChange,
  purpose,
  error,
  id,
}: {
  label: string;
  value: string | null;
  onChange: (url: string | null) => void;
  purpose: UploadPurpose;
  error?: string | null;
  id: string;
}) {
  const { t } = useI18n();
  return (
    <Field label={label} error={error} htmlFor={id}>
      <div className="flex gap-3">
        <div className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-line bg-stone-50 text-stone-400">
          {value ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={value} alt="" className="h-full w-full object-cover" />
          ) : (
            <Icon name="image" />
          )}
        </div>
        <div className="flex flex-1 flex-col gap-2">
          <Input id={id} value={value ?? ''} placeholder="https://…" onChange={(e) => onChange(e.target.value.trim() || null)} invalid={!!error} />
          <div className="flex gap-2">
            <UploadButton purpose={purpose} size="sm" onUploaded={onChange} />
            {value && (
              <Button variant="ghost" size="sm" icon="x" onClick={() => onChange(null)}>
                {t.common.remove}
              </Button>
            )}
          </div>
        </div>
      </div>
    </Field>
  );
}

/** Text helper for minor units entered as a decimal (129,90 or 129.90). */
export function parseMoney(text: string): number | null {
  const clean = text.replace(/\s/g, '').replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.');
  if (!clean) return null;
  const n = Number(clean);
  return Number.isFinite(n) ? Math.round(n * 100) : null;
}

export function formatMoneyInput(minor: number | null | undefined): string {
  return minor === null || minor === undefined ? '' : (minor / 100).toFixed(2);
}
