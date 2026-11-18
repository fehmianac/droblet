'use client';

import { useEffect, useRef, useState } from 'react';
import { apiRequest, errorMessage } from '@/lib/api';
import type { Dictionary, Locale } from '@/lib/i18n';
import { apiBaseUrl } from '@/lib/site';

type Props = {
  locale: Locale;
  t: Dictionary['deleteAccount'];
  common: Dictionary['common'];
  homeHref: string;
};

type Step = 'signin' | 'confirm' | 'done';
type LoginResponse = { accessToken?: string };

/**
 * Web account deletion (store requirement): sign in -> type the confirmation word -> DELETE /v1/auth/me.
 * The access token lives in React state only — never in a cookie, localStorage or sessionStorage — and is
 * dropped as soon as the flow ends or the tab closes.
 */
export function DeleteAccountFlow({ locale, t, common, homeHref }: Props) {
  const [step, setStep] = useState<Step>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [token, setToken] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const headingRef = useRef<HTMLHeadingElement>(null);
  const firstRender = useRef(true);

  // Move focus to the new step's heading so screen-reader and keyboard users follow the change.
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    headingRef.current?.focus();
  }, [step]);

  if (!apiBaseUrl) {
    return (
      <section className="card flex flex-col gap-2 p-6" aria-labelledby="delete-unavailable">
        <h2 id="delete-unavailable" className="heading-3">
          {common.unavailableTitle}
        </h2>
        <p className="body-text text-ink">{t.unavailableBody}</p>
      </section>
    );
  }

  // "sil", "SİL" and "SIL" (a keyboard without the dotted capital) all count as the Turkish word.
  const fold = (value: string) => value.trim().toLocaleUpperCase(locale).replace(/İ/g, 'I');
  const confirmed = fold(confirmation) === fold(t.confirmWord);

  async function signIn(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    const result = await apiRequest<LoginResponse>({
      method: 'POST',
      path: '/v1/auth/login',
      body: { email: email.trim(), password },
      language: locale,
    });
    setBusy(false);
    if (result.ok && result.data?.accessToken) {
      setToken(result.data.accessToken);
      setPassword('');
      setStep('confirm');
      return;
    }
    setError(errorMessage(t.errors, result.ok ? 'unknown' : result.code));
  }

  async function deleteAccount(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !confirmed) return;
    setBusy(true);
    setError('');
    const result = await apiRequest<null>({ method: 'DELETE', path: '/v1/auth/me', token, language: locale });
    setBusy(false);
    if (result.ok) {
      setToken('');
      setEmail('');
      setConfirmation('');
      setStep('done');
      return;
    }
    if (result.status === 401) {
      // The short-lived token ran out while the confirmation was open: start again.
      setToken('');
      setConfirmation('');
      setStep('signin');
      setError(t.errors.session_expired);
      return;
    }
    setError(errorMessage(t.errors, result.code));
  }

  function cancel() {
    setToken('');
    setConfirmation('');
    setError('');
    setStep('signin');
  }

  const alert = error ? (
    <p role="alert" className="m-0 rounded-field border border-danger bg-cream px-4 py-3 text-[15px] text-danger">
      {error}
    </p>
  ) : null;

  if (step === 'done') {
    return (
      <section className="card flex flex-col gap-3 p-6" aria-labelledby="delete-done">
        <h2 id="delete-done" ref={headingRef} tabIndex={-1} className="heading-3 outline-none">
          {t.successTitle}
        </h2>
        <p role="status" className="body-text text-ink">
          {t.successBody}
        </p>
        <a href={homeHref} className="btn-secondary self-start">
          {common.backHome}
        </a>
      </section>
    );
  }

  if (step === 'confirm') {
    return (
      <section className="card flex flex-col gap-4 border-danger p-6" aria-labelledby="delete-confirm">
        <h2 id="delete-confirm" ref={headingRef} tabIndex={-1} className="heading-3 outline-none">
          {t.confirmTitle}
        </h2>
        <p className="body-text text-ink">{t.confirmBody}</p>
        <p className="body-text text-ink">{t.subscriptionNote}</p>
        <form onSubmit={deleteAccount} className="flex flex-col gap-4" noValidate>
          <div>
            <label htmlFor="delete-confirmation" className="field-label">
              {t.confirmLabel}
            </label>
            <input
              id="delete-confirmation"
              className="field"
              type="text"
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              value={confirmation}
              onChange={(event) => setConfirmation(event.target.value)}
            />
          </div>
          {alert}
          <div className="flex flex-wrap gap-3">
            <button type="submit" className="btn btn-danger" disabled={!confirmed || busy}>
              {busy ? t.deleting : t.deleteButton}
            </button>
            <button type="button" className="btn-secondary" onClick={cancel} disabled={busy}>
              {t.cancel}
            </button>
          </div>
        </form>
      </section>
    );
  }

  return (
    <section className="card flex flex-col gap-4 p-6" aria-labelledby="delete-signin">
      <h2 id="delete-signin" ref={headingRef} tabIndex={-1} className="heading-3 outline-none">
        {t.signInTitle}
      </h2>
      <p className="body-text text-ink">{t.signInBody}</p>
      <form onSubmit={signIn} className="flex flex-col gap-4">
        <div>
          <label htmlFor="delete-email" className="field-label">
            {t.email}
          </label>
          <input
            id="delete-email"
            className="field"
            type="email"
            inputMode="email"
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            required
            maxLength={254}
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </div>
        <div>
          <label htmlFor="delete-password" className="field-label">
            {t.password}
          </label>
          <input
            id="delete-password"
            className="field"
            type="password"
            autoComplete="current-password"
            required
            maxLength={128}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </div>
        {alert}
        <button type="submit" className="btn self-start" disabled={busy}>
          {busy ? t.signingIn : t.signIn}
        </button>
      </form>
    </section>
  );
}
