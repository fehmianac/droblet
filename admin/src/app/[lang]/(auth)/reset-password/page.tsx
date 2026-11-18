'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useEffect, useState, type FormEvent } from 'react';
import { Icon } from '@/components/icons';
import { PasswordFields, passwordProblem } from '@/components/PasswordFields';
import { Button } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { useI18n } from '@/lib/i18n';

export default function ResetPasswordPage() {
  const { t, href, errorText, fieldError } = useI18n();
  const params = useSearchParams();
  const [token, setToken] = useState<string | null | undefined>(undefined);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Read the token once, then drop it from the address bar (and so from history and referrers).
  useEffect(() => {
    const value = params.get('token');
    setToken(value);
    if (value) window.history.replaceState(null, '', window.location.pathname);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const problem = passwordProblem(password, confirm);
    if (problem) {
      setError(problem === 'mismatch' ? t.auth.passwordMismatch : fieldError(problem));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.post('v1/admin/auth/password/reset', { token, newPassword: password }, { auth: false });
      setDone(true);
    } catch (err) {
      const code = err instanceof ApiError ? Object.values(err.errors)[0]?.[0] : undefined;
      setError(code ? fieldError(code) : errorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight">{t.auth.resetTitle}</h1>
      <p className="mt-2 text-sm text-muted">{t.auth.resetSubtitle}</p>
      {done ? (
        <p className="mt-6 flex items-start gap-2 rounded-lg bg-emerald-50 px-3 py-3 text-sm text-emerald-800" role="status">
          <Icon name="check" className="mt-0.5 h-4 w-4 shrink-0" />
          {t.auth.resetDone}
        </p>
      ) : token === undefined ? null : token === null ? (
        <p className="mt-6 rounded-lg bg-amber-50 px-3 py-3 text-sm text-amber-800" role="alert">
          {t.auth.missingToken}
        </p>
      ) : (
        <form onSubmit={onSubmit} className="mt-6 space-y-4">
          {error && (
            <p className="rounded-lg bg-red-50 px-3 py-2.5 text-sm text-red-700" role="alert">
              {error}
            </p>
          )}
          <PasswordFields password={password} confirm={confirm} onPassword={setPassword} onConfirm={setConfirm} />
          <Button type="submit" className="w-full" loading={busy}>
            {t.auth.setPassword}
          </Button>
        </form>
      )}
      <p className="mt-6 text-center text-sm">
        <Link href={href(done || token === null ? '/login/' : '/forgot-password/')} className="font-medium text-brand-600 hover:underline">
          {done || token === null ? t.auth.goToLogin : t.auth.forgot}
        </Link>
      </p>
    </div>
  );
}
