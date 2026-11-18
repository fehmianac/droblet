'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Icon } from '@/components/icons';
import { Button, Field, Input } from '@/components/ui';
import { ApiError } from '@/lib/api';
import { useAuth, type LogoutReason } from '@/lib/auth';
import { useI18n } from '@/lib/i18n';
import type { LoginChallenge } from '@/lib/types';

export default function LoginPage() {
  const { t, href, fmt, errorText } = useI18n();
  const { status, login, verify, takeReason } = useAuth();
  const router = useRouter();
  const params = useSearchParams();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [challenge, setChallenge] = useState<LoginChallenge | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<LogoutReason | null>(null);
  const codeRef = useRef<HTMLInputElement>(null);

  const next = params.get('next');
  const target = next && next.startsWith('/') && !next.startsWith('//') ? next : '/';

  useEffect(() => {
    setNotice(takeReason());
  }, [takeReason]);

  useEffect(() => {
    if (status === 'authenticated') router.replace(href(target));
  }, [status, router, href, target]);

  useEffect(() => {
    if (challenge) codeRef.current?.focus();
  }, [challenge]);

  const onLogin = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      setChallenge(await login(email.trim(), password));
      setPassword('');
      setCode('');
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  const onVerify = async (e: FormEvent) => {
    e.preventDefault();
    if (!challenge) return;
    setBusy(true);
    setError(null);
    try {
      await verify(challenge.challengeId, code.trim());
    } catch (err) {
      if (err instanceof ApiError && err.code === 'challenge_expired') {
        setChallenge(null);
        setError(errorText(err));
      } else if (err instanceof ApiError && err.code === 'invalid_code' && typeof err.body.attemptsLeft === 'number') {
        setError(`${errorText(err)} ${fmt(t.auth.attemptsLeft, { count: err.body.attemptsLeft })}`);
      } else {
        setError(errorText(err));
      }
      setCode('');
    } finally {
      setBusy(false);
    }
  };

  const noticeText = notice === 'idle' ? t.auth.idleLogout : notice === 'expired' ? t.auth.sessionExpired : notice === 'manual' ? t.auth.loggedOut : notice === 'passwordChanged' ? t.account.changed : null;

  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight">{challenge ? t.auth.codeTitle : t.auth.title}</h1>
      <p className="mt-2 text-sm text-muted">{challenge ? t.auth.codeSubtitle : t.auth.subtitle}</p>

      {noticeText && !challenge && (
        <p className="mt-5 flex items-start gap-2 rounded-lg bg-brand-50 px-3 py-2.5 text-sm text-brand-800" role="status">
          <Icon name="info" className="mt-0.5 h-4 w-4 shrink-0" />
          {noticeText}
        </p>
      )}
      {error && (
        <p className="mt-5 flex items-start gap-2 rounded-lg bg-red-50 px-3 py-2.5 text-sm text-red-700" role="alert">
          <Icon name="alert" className="mt-0.5 h-4 w-4 shrink-0" />
          {error}
        </p>
      )}

      {!challenge ? (
        <form onSubmit={onLogin} className="mt-6 space-y-4">
          <Field label={t.auth.email} htmlFor="email">
            <Input id="email" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          <Field label={t.auth.password} htmlFor="password">
            <div className="relative">
              <Input
                id="password"
                type={show ? 'text' : 'password'}
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="pr-10"
              />
              <button
                type="button"
                onClick={() => setShow((v) => !v)}
                aria-label={show ? t.auth.hidePassword : t.auth.showPassword}
                className="absolute top-1/2 right-2 -translate-y-1/2 rounded p-1 text-muted hover:text-ink"
              >
                <Icon name={show ? 'eyeOff' : 'eye'} className="h-4 w-4" />
              </button>
            </div>
          </Field>
          <Button type="submit" className="w-full" loading={busy}>
            {t.auth.signIn}
          </Button>
          <p className="text-center text-sm">
            <Link href={href('/forgot-password/')} className="font-medium text-brand-600 hover:underline">
              {t.auth.forgot}
            </Link>
          </p>
        </form>
      ) : (
        <form onSubmit={onVerify} className="mt-6 space-y-4">
          <Field label={t.auth.code} htmlFor="code">
            <Input
              id="code"
              ref={codeRef}
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]*"
              maxLength={challenge.codeLength || 6}
              required
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
              className="h-12 text-center font-mono text-2xl tracking-[0.5em]"
            />
          </Field>
          <Button type="submit" className="w-full" loading={busy} disabled={code.length < (challenge.codeLength || 6)}>
            {t.auth.verify}
          </Button>
          <button
            type="button"
            onClick={() => {
              setChallenge(null);
              setError(null);
            }}
            className="w-full text-center text-sm text-muted hover:text-ink"
          >
            {t.auth.otherAccount}
          </button>
        </form>
      )}
    </div>
  );
}
