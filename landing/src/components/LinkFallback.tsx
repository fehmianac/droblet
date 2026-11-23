'use client';

import { useEffect, useState } from 'react';
import { apiRequest } from '@/lib/api';
import { browserLocaleTarget } from '@/lib/browserLocale';
import { format, localePath, type Dictionary, type Locale } from '@/lib/i18n';
import { appLinks, readInviteCode, readLook } from '@/lib/links';
import { Icon } from './Icons';
import { StoreButtons } from './StoreButtons';

type InvitePreview = { code?: string; inviterFirstName?: string | null };

type Common = Dictionary['common'];

type Resolved =
  | { state: 'loading' }
  /** A usable value was in the URL: the page may talk about "this invite" / "this look". */
  | { state: 'ready'; appHref: string; code: string | null; name: string | null }
  /** Nothing usable in the URL, or the API says the code does not exist: store buttons, no promise. */
  | { state: 'generic' };

function Shell(props: {
  eyebrow: string;
  title: string;
  body: string;
  storeTitle: string;
  common: Common;
  appHref: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-3">
        <p className="eyebrow">{props.eyebrow}</p>
        <h1 className="m-0 font-serif text-[clamp(36px,6vw,52px)] leading-[1.05] font-medium" aria-live="polite">
          {props.title}
        </h1>
        <p className="m-0 text-[17px] leading-relaxed text-muted">{props.body}</p>
      </header>

      <a href={props.appHref} className="btn self-start">
        <Icon name="open" size={18} />
        {props.common.openInApp}
      </a>

      {props.children}

      <section className="flex flex-col gap-3 rounded-card bg-sand p-6" aria-labelledby="fallback-store">
        <h2 id="fallback-store" className="heading-3">
          {props.storeTitle}
        </h2>
        <StoreButtons labels={props.common} />
      </section>
    </div>
  );
}

type InviteProps = { locale: Locale; t: Dictionary['invite']; common: Common };

/**
 * `/invite/CODE` (through the Cloudflare rewrite) or `/invite/?c=CODE`. Shows the inviter's first name —
 * the only thing the anonymous preview endpoint returns — and stores nothing in the browser.
 */
export function InviteFallback({ locale, t, common }: InviteProps) {
  const [resolved, setResolved] = useState<Resolved>({ state: 'loading' });
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const code = readInviteCode(window.location);
    const target = browserLocaleTarget(locale);
    if (target) {
      window.location.replace(`${localePath(target, '/invite/')}${code ? `?c=${encodeURIComponent(code)}` : ''}`);
      return;
    }
    if (!code) {
      setResolved({ state: 'generic' });
      return;
    }
    const ready = { state: 'ready' as const, appHref: appLinks.invite(code), code };
    setResolved({ ...ready, name: null });

    let cancelled = false;
    void apiRequest<InvitePreview>({ method: 'GET', path: `/v1/invite/${encodeURIComponent(code)}`, language: locale }).then(
      (result) => {
        if (cancelled) return;
        if (result.ok) {
          const name = typeof result.data?.inviterFirstName === 'string' ? result.data.inviterFirstName.trim() : '';
          if (name) setResolved({ ...ready, name });
        } else if (result.status === 404) {
          // Unknown or expired code: keep the store buttons, stop promising an invite.
          setResolved({ state: 'generic' });
        }
        // API not configured / network error / rate limit: the page already works without the name.
      },
    );
    return () => {
      cancelled = true;
    };
  }, [locale]);

  async function copy(code: string) {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  // Before the URL is read (and without JavaScript) the page is the generic one: it already has the buttons.
  if (resolved.state !== 'ready') {
    return (
      <Shell
        eyebrow={t.eyebrow}
        title={t.genericTitle}
        body={t.genericBody}
        storeTitle={t.storeTitle}
        common={common}
        appHref={appLinks.home()}
      />
    );
  }

  const code = resolved.code;
  return (
    <Shell
      eyebrow={t.eyebrow}
      title={resolved.name ? format(t.titleWithName, { name: resolved.name }) : t.title}
      body={t.body}
      storeTitle={t.storeTitle}
      common={common}
      appHref={resolved.appHref}
    >
      {code ? (
        <section className="card flex flex-col gap-3 p-6" aria-labelledby="invite-code">
          <h2 id="invite-code" className="eyebrow">
            {t.codeLabel}
          </h2>
          <div className="flex flex-wrap items-center gap-3">
            <code className="rounded-field bg-sand px-4 py-3 font-sans text-[18px] font-medium tracking-[0.08em] break-all">
              {code}
            </code>
            <button type="button" className="btn-secondary btn-compact" onClick={() => void copy(code)}>
              {copied ? t.copied : t.copy}
            </button>
            <span role="status" className="sr-only">
              {copied ? t.copied : ''}
            </span>
          </div>
          <p className="small-text">{t.codeHint}</p>
        </section>
      ) : null}
    </Shell>
  );
}

type LookProps = { locale: Locale; t: Dictionary['look']; common: Common };

/**
 * `/l/ID` (through the Cloudflare rewrite) or `/l/?id=ID`. The look itself is never fetched or shown on the
 * web — it opens in the app, where the owner's visibility setting applies.
 */
export function LookFallback({ locale, t, common }: LookProps) {
  const [resolved, setResolved] = useState<Resolved>({ state: 'loading' });

  useEffect(() => {
    const { id, invite } = readLook(window.location);
    const target = browserLocaleTarget(locale);
    if (target) {
      const query = new URLSearchParams();
      if (id) query.set('id', id);
      if (invite) query.set('invite', invite);
      const search = query.toString();
      window.location.replace(`${localePath(target, '/l/')}${search ? `?${search}` : ''}`);
      return;
    }
    setResolved(id ? { state: 'ready', appHref: appLinks.look(id, invite), code: null, name: null } : { state: 'generic' });
  }, [locale]);

  const ready = resolved.state === 'ready';
  return (
    <Shell
      eyebrow={t.eyebrow}
      title={ready ? t.title : t.genericTitle}
      body={ready ? t.body : t.genericBody}
      storeTitle={t.storeTitle}
      common={common}
      appHref={ready ? resolved.appHref : appLinks.home()}
    />
  );
}
