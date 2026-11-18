'use client';

import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import { Icon } from '@/components/icons';
import { Button, Field, Input } from '@/components/ui';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';

export default function ForgotPasswordPage() {
  const { t, href, errorText } = useI18n();
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post('v1/admin/auth/password/forgot', { email: email.trim() }, { auth: false });
      setSent(true);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight">{t.auth.forgotTitle}</h1>
      <p className="mt-2 text-sm text-muted">{t.auth.forgotSubtitle}</p>
      {sent ? (
        <p className="mt-6 flex items-start gap-2 rounded-lg bg-emerald-50 px-3 py-3 text-sm text-emerald-800" role="status">
          <Icon name="check" className="mt-0.5 h-4 w-4 shrink-0" />
          {t.auth.linkSent}
        </p>
      ) : (
        <form onSubmit={onSubmit} className="mt-6 space-y-4">
          {error && (
            <p className="rounded-lg bg-red-50 px-3 py-2.5 text-sm text-red-700" role="alert">
              {error}
            </p>
          )}
          <Field label={t.auth.email} htmlFor="email">
            <Input id="email" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          <Button type="submit" className="w-full" loading={busy}>
            {t.auth.sendLink}
          </Button>
        </form>
      )}
      <p className="mt-6 text-center text-sm">
        <Link href={href('/login/')} className="font-medium text-brand-600 hover:underline">
          {t.auth.goToLogin}
        </Link>
      </p>
    </div>
  );
}
