'use client';

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { apiRequest, errorMessage, type ApiResult } from '@/lib/api';
import { browserLocaleTarget } from '@/lib/browserLocale';
import { format, localePath, type Dictionary, type Locale } from '@/lib/i18n';
import { readResetToken } from '@/lib/links';
import { apiBaseUrl } from '@/lib/site';
import { Icon } from './Icons';

type Props = {
  locale: Locale;
  /** BCP 47 tag for date formatting. */
  htmlLang: string;
  /** Draft texts (without the notice sections) — passed only when the draft flag is on (see ParentConsentPage). */
  t: ParentConsentTexts;
  common: Dictionary['common'];
  homeHref: string;
  /** The notice sections, rendered on the server from the same draft texts. */
  notice: ReactNode;
};

/** `GET / POST v1/parent-consent*` answer (docs/api/teen.md §5). */
type ConsentLink = {
  kind: 'request' | 'manage';
  status: 'pending' | 'approved' | 'declined' | 'withdrawn' | 'ended';
  teenName: string | null;
  language: string | null;
  expiresAt: string | null;
  textVersion: string;
  tryOnOffered: boolean;
  parentAllowedTryOn: boolean;
  decidedAt: string | null;
};

export type ParentConsentTexts = Omit<Dictionary['parentConsent']['draft'], 'sections' | 'draftNote'>;

type View = 'loading' | 'missing' | 'failed' | 'ready';
type Busy = '' | 'approve' | 'decline' | 'withdraw';

const PAGE = '/parent-consent/';

/**
 * The parent's page of the e-mailed consent link. The token is read from the query string in the browser; the page
 * only reads the link on load (GET) and never decides on its own: approving, declining and withdrawing each need a
 * click (mail scanners open links).
 */
export function ParentConsentFlow({ locale, htmlLang, t, common, homeHref, notice }: Props) {
  const [view, setView] = useState<View>('loading');
  const [token, setToken] = useState('');
  const [link, setLink] = useState<ConsentLink | null>(null);
  const [loadError, setLoadError] = useState({ code: '', message: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState<Busy>('');
  const [confirmParent, setConfirmParent] = useState(false);
  const [confirmNotice, setConfirmNotice] = useState(false);
  const [confirmProcessing, setConfirmProcessing] = useState(false);
  const [allowTryOn, setAllowTryOn] = useState(false);
  const [confirmingWithdraw, setConfirmingWithdraw] = useState(false);
  const resultRef = useRef<HTMLHeadingElement>(null);

  const formatDate = (iso: string | null) => {
    if (!iso) return '';
    const date = new Date(iso);
    return Number.isNaN(date.getTime()) ? '' : new Intl.DateTimeFormat(htmlLang, { dateStyle: 'long' }).format(date);
  };
  const name = link?.teenName?.trim() || t.childFallbackName;

  const load = useCallback(
    async (value: string): Promise<ApiResult<ConsentLink>> => {
      const result = await apiRequest<ConsentLink>({
        method: 'GET',
        path: `/v1/parent-consent?token=${encodeURIComponent(value)}`,
        language: locale,
      });
      if (result.ok) {
        setLink(result.data);
        setLoadError({ code: '', message: '' });
        setView('ready');
      } else {
        setLoadError({ code: result.code, message: errorMessage(t.errors, result.code) });
        setView('failed');
      }
      return result;
    },
    [locale, t.errors],
  );

  useEffect(() => {
    const found = readResetToken(window.location);
    const target = browserLocaleTarget(locale);
    if (target) {
      window.location.replace(`${localePath(target, PAGE)}${found ? `?token=${encodeURIComponent(found)}` : ''}`);
      return;
    }
    if (!found) {
      setView('missing');
      return;
    }
    setToken(found);
    if (apiBaseUrl) void load(found);
    else setView('ready');
  }, [locale, load]);

  function resetBoxes() {
    setConfirmParent(false);
    setConfirmNotice(false);
    setConfirmProcessing(false);
    setAllowTryOn(false);
  }

  async function settle(result: ApiResult<ConsentLink>) {
    setBusy('');
    if (result.ok) {
      setLink(result.data);
      setConfirmingWithdraw(false);
      return;
    }
    const message = errorMessage(t.errors, result.code);
    if (result.code === 'consent_version_outdated' || result.code === 'parental_consent_already_decided') {
      // The text or the state changed on the server: read the link again and show where it stands now.
      if (result.code === 'consent_version_outdated') resetBoxes();
      await load(token);
    }
    setError(message);
  }

  async function decide(approve: boolean) {
    if (busy || !link) return;
    setBusy(approve ? 'approve' : 'decline');
    setError('');
    const result = await apiRequest<ConsentLink>({
      method: 'POST',
      path: '/v1/parent-consent/decision',
      body: {
        token,
        approve,
        textVersion: link.textVersion,
        confirmParent: approve && confirmParent,
        confirmNotice: approve && confirmNotice,
        confirmProcessing: approve && confirmProcessing,
        allowTryOn: approve && link.tryOnOffered && allowTryOn,
      },
      language: locale,
    });
    await settle(result);
  }

  async function withdraw() {
    if (busy) return;
    setBusy('withdraw');
    setError('');
    const result = await apiRequest<ConsentLink>({
      method: 'POST',
      path: '/v1/parent-consent/withdraw',
      body: { token },
      language: locale,
    });
    await settle(result);
  }

  useEffect(() => {
    if (link && link.status !== 'pending') resultRef.current?.focus();
  }, [link]);

  if (view === 'loading') {
    return <div aria-hidden="true" className="card min-h-40" />;
  }

  if (view === 'missing') {
    return (
      <section className="card flex flex-col gap-3 p-6" aria-labelledby="consent-missing">
        <h2 id="consent-missing" className="heading-3">
          {t.missingTitle}
        </h2>
        <p className="body-text text-ink">{t.missingBody}</p>
        <a href={homeHref} className="btn-secondary self-start">
          {common.backHome}
        </a>
      </section>
    );
  }

  if (!apiBaseUrl) {
    return (
      <section className="card flex flex-col gap-2 p-6" aria-labelledby="consent-unavailable">
        <h2 id="consent-unavailable" className="heading-3">
          {common.unavailableTitle}
        </h2>
        <p className="body-text text-ink">{t.apiUnavailableBody}</p>
      </section>
    );
  }

  if (view === 'failed' || !link) {
    const linkProblem = ['parental_consent_link_invalid', 'parental_consent_link_expired', 'validation'].includes(loadError.code);
    return (
      <section className="card flex flex-col gap-3 p-6" aria-labelledby="consent-failed">
        <h2 id="consent-failed" className="heading-3">
          {linkProblem ? t.missingTitle : common.unavailableTitle}
        </h2>
        <p role="alert" className="body-text text-ink">
          {loadError.message}
        </p>
        {linkProblem ? null : (
          <button type="button" className="btn-secondary self-start" onClick={() => void load(token)}>
            {t.retry}
          </button>
        )}
      </section>
    );
  }

  const alert = error ? (
    <p role="alert" className="m-0 rounded-field border border-danger bg-cream px-4 py-3 text-[15px] text-danger">
      {error}
    </p>
  ) : null;

  const noticeSection = (
    <section className="flex flex-col gap-6" aria-labelledby="consent-notice">
      <h2 id="consent-notice" className="heading-3">
        {t.noticeTitle}
      </h2>
      {notice}
      <p className="small-text">{format(t.textVersion, { version: link.textVersion })}</p>
    </section>
  );

  // ── Pending request: notice + the decision ────────────────────────────────────────────────────────
  if (link.kind === 'request' && link.status === 'pending') {
    const canApprove = confirmParent && confirmNotice && confirmProcessing;
    const box = (id: string, checked: boolean, set: (value: boolean) => void, label: string) => (
      <label htmlFor={id} className="flex min-h-11 cursor-pointer items-start gap-3 text-[15px] leading-normal">
        <input
          id={id}
          type="checkbox"
          checked={checked}
          onChange={(event) => set(event.target.checked)}
          className="mt-0.5 size-5 flex-none accent-ink"
        />
        <span>{label}</span>
      </label>
    );
    return (
      <div className="flex flex-col gap-8">
        <div className="flex flex-col gap-2">
          <p className="m-0 text-[17px] leading-relaxed">{format(t.intro, { name })}</p>
          {link.expiresAt ? <p className="small-text">{format(t.expires, { date: formatDate(link.expiresAt) })}</p> : null}
        </div>

        {noticeSection}

        <section className="card flex flex-col gap-5 p-6" aria-labelledby="consent-decision">
          <h2 id="consent-decision" ref={resultRef} tabIndex={-1} className="heading-3 outline-none">
            {t.decisionTitle}
          </h2>
          <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
            <legend className="sr-only">{t.decisionTitle}</legend>
            {box('consent-parent', confirmParent, setConfirmParent, t.confirmParent)}
            {box('consent-notice-read', confirmNotice, setConfirmNotice, t.confirmNotice)}
            {box('consent-processing', confirmProcessing, setConfirmProcessing, t.confirmProcessing)}
          </fieldset>
          <p className="small-text">{t.confirmHint}</p>

          {link.tryOnOffered ? (
            <fieldset className="m-0 flex flex-col gap-2 rounded-field border border-line p-4">
              <legend className="px-1 text-[14px] font-medium">{t.tryOnTitle}</legend>
              {box('consent-try-on', allowTryOn, setAllowTryOn, t.allowTryOn)}
              <p className="small-text">{t.allowTryOnHelp}</p>
            </fieldset>
          ) : null}

          {alert}

          <div className="flex flex-wrap gap-3">
            <button type="button" className="btn" disabled={!canApprove || busy !== ''} onClick={() => void decide(true)}>
              {busy === 'approve' ? t.approving : t.approve}
            </button>
            <button type="button" className="btn-secondary" disabled={busy !== ''} onClick={() => void decide(false)}>
              {busy === 'decline' ? t.declining : t.decline}
            </button>
          </div>
        </section>
      </div>
    );
  }

  // ── Withdrawal link of an active consent ──────────────────────────────────────────────────────────
  if (link.kind === 'manage' && link.status === 'approved') {
    return (
      <div className="flex flex-col gap-8">
        <section className="card flex flex-col gap-4 p-6" aria-labelledby="consent-manage">
          <h2 id="consent-manage" ref={resultRef} tabIndex={-1} className="heading-3 outline-none">
            {t.manage.title}
          </h2>
          <p className="body-text text-ink">{format(t.manage.body, { name })}</p>
          <ul className="m-0 flex list-none flex-col gap-1 p-0">
            {link.decidedAt ? <li className="small-text">{format(t.statuses.decidedAt, { date: formatDate(link.decidedAt) })}</li> : null}
            <li className="small-text">{link.parentAllowedTryOn ? t.statuses.tryOnAllowed : t.statuses.tryOnNotAllowed}</li>
          </ul>

          {confirmingWithdraw ? (
            <div role="group" aria-labelledby="consent-withdraw-confirm" className="flex flex-col gap-3 rounded-field border border-danger p-4">
              <p id="consent-withdraw-confirm" className="m-0 flex items-center gap-2 font-medium text-danger">
                <Icon name="alert" className="flex-none" />
                {t.manage.confirmTitle}
              </p>
              <p className="body-text text-ink">{t.manage.confirmBody}</p>
              {alert}
              <div className="flex flex-wrap gap-3">
                <button type="button" className="btn btn-danger" disabled={busy !== ''} onClick={() => void withdraw()}>
                  {busy === 'withdraw' ? t.manage.withdrawing : t.manage.confirmWithdraw}
                </button>
                <button
                  type="button"
                  className="btn-secondary"
                  disabled={busy !== ''}
                  onClick={() => {
                    setConfirmingWithdraw(false);
                    setError('');
                  }}
                >
                  {t.manage.cancel}
                </button>
              </div>
            </div>
          ) : (
            <button type="button" className="btn-secondary self-start" onClick={() => setConfirmingWithdraw(true)}>
              {t.manage.withdraw}
            </button>
          )}
        </section>
        {noticeSection}
      </div>
    );
  }

  // ── Every other state: where the link stands ──────────────────────────────────────────────────────
  const titles = {
    pending: [t.statuses.pendingTitle, t.statuses.pendingBody],
    approved: [t.statuses.approvedTitle, t.statuses.approvedBody],
    declined: [t.statuses.declinedTitle, t.statuses.declinedBody],
    withdrawn: [t.statuses.withdrawnTitle, t.statuses.withdrawnBody],
    ended: [t.statuses.endedTitle, t.statuses.endedBody],
  } as const;
  const [title, body] = titles[link.status] ?? titles.pending;
  return (
    <section className="card flex flex-col gap-3 p-6" aria-labelledby="consent-status">
      <h2 id="consent-status" ref={resultRef} tabIndex={-1} className="heading-3 outline-none">
        {title}
      </h2>
      {alert}
      <p role="status" className="body-text text-ink">
        {format(body, { name })}
      </p>
      {link.decidedAt && link.status !== 'ended' ? (
        <p className="small-text">{format(t.statuses.decidedAt, { date: formatDate(link.decidedAt) })}</p>
      ) : null}
      {link.status === 'approved' ? (
        <p className="small-text">{link.parentAllowedTryOn ? t.statuses.tryOnAllowed : t.statuses.tryOnNotAllowed}</p>
      ) : null}
    </section>
  );
}
