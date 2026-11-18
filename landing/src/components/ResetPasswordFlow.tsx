'use client';

import { useEffect, useRef, useState } from 'react';
import { apiRequest, errorMessage } from '@/lib/api';
import { browserLocaleTarget } from '@/lib/browserLocale';
import { localePath, type Dictionary, type Locale } from '@/lib/i18n';
import { appLinks, readResetToken } from '@/lib/links';
import { apiBaseUrl } from '@/lib/site';
import { Icon } from './Icons';

type Props = {
  locale: Locale;
  t: Dictionary['resetPassword'];
  common: Dictionary['common'];
  homeHref: string;
};

type View = 'loading' | 'missing' | 'form' | 'done';

const MIN_LENGTH = 8;
const MAX_LENGTH = 128;

/**
 * Fallback for the password reset link when the app did not open it. The token is read from the query
 * string in the browser, offered to the app through the custom scheme, and can also be used right here.
 * Nothing is stored; the token only lives in this component.
 */
export function ResetPasswordFlow({ locale, t, common, homeHref }: Props) {
  const [view, setView] = useState<View>('loading');
  const [token, setToken] = useState('');
  const [password, setPassword] = useState('');
  const [repeat, setRepeat] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const doneRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    const found = readResetToken(window.location);
    const target = browserLocaleTarget(locale);
    if (target) {
      window.location.replace(`${localePath(target, '/reset-password/')}${found ? `?token=${encodeURIComponent(found)}` : ''}`);
      return;
    }
    setToken(found ?? '');
    setView(found ? 'form' : 'missing');
  }, [locale]);

  useEffect(() => {
    if (view === 'done') doneRef.current?.focus();
  }, [view]);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    if (password.length < MIN_LENGTH) {
      setError(t.errors.too_short);
      return;
    }
    if (password !== repeat) {
      setError(t.errors.mismatch);
      return;
    }
    setBusy(true);
    setError('');
    const result = await apiRequest<null>({
      method: 'POST',
      path: '/v1/auth/password/reset',
      body: { token, newPassword: password },
      language: locale,
    });
    setBusy(false);
    if (result.ok) {
      setPassword('');
      setRepeat('');
      setToken('');
      setView('done');
      return;
    }
    setError(errorMessage(t.errors, result.code));
  }

  if (view === 'loading') {
    // Same height as the form's first block so the page does not jump once the token is read.
    return <div aria-hidden="true" className="card min-h-40" />;
  }

  if (view === 'missing') {
    return (
      <section className="card flex flex-col gap-3 p-6" aria-labelledby="reset-missing">
        <h2 id="reset-missing" className="heading-3">
          {t.missingTitle}
        </h2>
        <p className="body-text text-ink">{t.missingBody}</p>
        <a href={homeHref} className="btn-secondary self-start">
          {common.backHome}
        </a>
      </section>
    );
  }

  if (view === 'done') {
    return (
      <section className="card flex flex-col gap-3 p-6" aria-labelledby="reset-done">
        <h2 id="reset-done" ref={doneRef} tabIndex={-1} className="heading-3 outline-none">
          {t.successTitle}
        </h2>
        <p role="status" className="body-text text-ink">
          {t.successBody}
        </p>
        <a href={appLinks.home()} className="btn self-start">
          <Icon name="open" size={18} />
          {common.openInApp}
        </a>
      </section>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <a href={appLinks.resetPassword(token)} className="btn self-start">
        <Icon name="open" size={18} />
        {common.openInApp}
      </a>

      {apiBaseUrl ? (
        <section className="card flex flex-col gap-4 p-6" aria-labelledby="reset-web">
          <h2 id="reset-web" className="heading-3">
            {t.orWeb}
          </h2>
          <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
            <div>
              <label htmlFor="reset-password" className="field-label">
                {t.newPassword}
              </label>
              <input
                id="reset-password"
                className="field"
                type="password"
                autoComplete="new-password"
                minLength={MIN_LENGTH}
                maxLength={MAX_LENGTH}
                aria-describedby="reset-password-hint"
                aria-invalid={error === t.errors.too_short ? true : undefined}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
              <p id="reset-password-hint" className="small-text mt-1.5">
                {t.passwordHint}
              </p>
            </div>
            <div>
              <label htmlFor="reset-repeat" className="field-label">
                {t.repeatPassword}
              </label>
              <input
                id="reset-repeat"
                className="field"
                type="password"
                autoComplete="new-password"
                maxLength={MAX_LENGTH}
                aria-invalid={error === t.errors.mismatch ? true : undefined}
                value={repeat}
                onChange={(event) => setRepeat(event.target.value)}
              />
            </div>
            {error ? (
              <p role="alert" className="m-0 rounded-field border border-danger bg-cream px-4 py-3 text-[15px] text-danger">
                {error}
              </p>
            ) : null}
            <button type="submit" className="btn self-start" disabled={busy}>
              {busy ? t.submitting : t.submit}
            </button>
          </form>
        </section>
      ) : (
        <section className="card flex flex-col gap-2 p-6" aria-labelledby="reset-unavailable">
          <h2 id="reset-unavailable" className="heading-3">
            {common.unavailableTitle}
          </h2>
          <p className="body-text text-ink">{t.unavailableBody}</p>
        </section>
      )}
    </div>
  );
}
