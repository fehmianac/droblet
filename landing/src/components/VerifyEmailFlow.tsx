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
  t: Dictionary['verifyEmail'];
  common: Dictionary['common'];
  homeHref: string;
};

type View = 'loading' | 'missing' | 'ready' | 'done';

/**
 * Fallback for the e-mail verification link when the app did not open it. The token is read from the query string
 * in the browser, offered to the app through the custom scheme, and can be used right here with one button (never
 * on page load: mail scanners that open links must not verify an address).
 */
export function VerifyEmailFlow({ locale, t, common, homeHref }: Props) {
  const [view, setView] = useState<View>('loading');
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const doneRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    const found = readResetToken(window.location);
    const target = browserLocaleTarget(locale);
    if (target) {
      window.location.replace(`${localePath(target, '/verify-email/')}${found ? `?token=${encodeURIComponent(found)}` : ''}`);
      return;
    }
    setToken(found ?? '');
    setView(found ? 'ready' : 'missing');
  }, [locale]);

  useEffect(() => {
    if (view === 'done') doneRef.current?.focus();
  }, [view]);

  async function verify() {
    if (busy) return;
    setBusy(true);
    setError('');
    const result = await apiRequest<{ emailVerified: boolean }>({
      method: 'POST',
      path: '/v1/auth/email/verify',
      body: { token },
      language: locale,
    });
    setBusy(false);
    if (result.ok) {
      setToken('');
      setView('done');
      return;
    }
    setError(errorMessage(t.errors, result.code));
  }

  if (view === 'loading') {
    return <div aria-hidden="true" className="card min-h-40" />;
  }

  if (view === 'missing') {
    return (
      <section className="card flex flex-col gap-3 p-6" aria-labelledby="verify-missing">
        <h2 id="verify-missing" className="heading-3">
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
      <section className="card flex flex-col gap-3 p-6" aria-labelledby="verify-done">
        <h2 id="verify-done" ref={doneRef} tabIndex={-1} className="heading-3 outline-none">
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
      <a href={appLinks.verifyEmail(token)} className="btn self-start">
        <Icon name="open" size={18} />
        {common.openInApp}
      </a>

      {apiBaseUrl ? (
        <section className="card flex flex-col gap-4 p-6" aria-labelledby="verify-web">
          <h2 id="verify-web" className="heading-3">
            {t.orWeb}
          </h2>
          <p className="body-text text-ink">{t.webBody}</p>
          {error ? (
            <p role="alert" className="m-0 rounded-field border border-danger bg-cream px-4 py-3 text-[15px] text-danger">
              {error}
            </p>
          ) : null}
          <button type="button" className="btn self-start" disabled={busy} onClick={() => void verify()}>
            {busy ? t.submitting : t.submit}
          </button>
        </section>
      ) : (
        <section className="card flex flex-col gap-2 p-6" aria-labelledby="verify-unavailable">
          <h2 id="verify-unavailable" className="heading-3">
            {common.unavailableTitle}
          </h2>
          <p className="body-text text-ink">{t.unavailableBody}</p>
        </section>
      )}
    </div>
  );
}
