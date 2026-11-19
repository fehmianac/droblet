import type { Metadata } from 'next';
import { getDictionary, localePath, type Locale } from '@/lib/i18n';
import { pageMetadata } from '@/lib/metadata';
import { InviteFallback, LookFallback } from './LinkFallback';
import { PageShell } from './PageShell';
import { ResetPasswordFlow } from './ResetPasswordFlow';
import { VerifyEmailFlow } from './VerifyEmailFlow';

/**
 * Deep-link fallbacks: what a shared link shows when the app did not open it. Each is one static file
 * (`out/{route}/index.html`); the parameter is read in the browser. None of them is indexed.
 */
const routes = { reset: '/reset-password/', verify: '/verify-email/', invite: '/invite/', look: '/l/' } as const;

export function resetPasswordMetadata(locale: Locale): Metadata {
  const t = getDictionary(locale).resetPassword;
  return pageMetadata({ locale, page: routes.reset, title: t.metaTitle, description: t.metaDescription, index: false });
}

export function ResetPasswordPage({ locale }: { locale: Locale }) {
  const dictionary = getDictionary(locale);
  const t = dictionary.resetPassword;
  return (
    <PageShell locale={locale} page={routes.reset}>
      <div className="flex flex-col gap-8">
        <header className="flex flex-col gap-3">
          <p className="eyebrow">{t.eyebrow}</p>
          <h1 className="m-0 font-serif text-[clamp(36px,6vw,52px)] leading-[1.05] font-medium">{t.title}</h1>
          <p className="m-0 text-[17px] leading-relaxed text-muted">{t.intro}</p>
        </header>
        <ResetPasswordFlow locale={locale} t={t} common={dictionary.common} homeHref={localePath(locale, '/')} />
      </div>
    </PageShell>
  );
}

export function verifyEmailMetadata(locale: Locale): Metadata {
  const t = getDictionary(locale).verifyEmail;
  return pageMetadata({ locale, page: routes.verify, title: t.metaTitle, description: t.metaDescription, index: false });
}

export function VerifyEmailPage({ locale }: { locale: Locale }) {
  const dictionary = getDictionary(locale);
  const t = dictionary.verifyEmail;
  return (
    <PageShell locale={locale} page={routes.verify}>
      <div className="flex flex-col gap-8">
        <header className="flex flex-col gap-3">
          <p className="eyebrow">{t.eyebrow}</p>
          <h1 className="m-0 font-serif text-[clamp(36px,6vw,52px)] leading-[1.05] font-medium">{t.title}</h1>
          <p className="m-0 text-[17px] leading-relaxed text-muted">{t.intro}</p>
        </header>
        <VerifyEmailFlow locale={locale} t={t} common={dictionary.common} homeHref={localePath(locale, '/')} />
      </div>
    </PageShell>
  );
}

export function inviteMetadata(locale: Locale): Metadata {
  const t = getDictionary(locale).invite;
  return pageMetadata({ locale, page: routes.invite, title: t.metaTitle, description: t.metaDescription, index: false });
}

export function InvitePage({ locale }: { locale: Locale }) {
  const dictionary = getDictionary(locale);
  return (
    <PageShell locale={locale} page={routes.invite}>
      <InviteFallback locale={locale} t={dictionary.invite} common={dictionary.common} />
    </PageShell>
  );
}

export function lookMetadata(locale: Locale): Metadata {
  const t = getDictionary(locale).look;
  return pageMetadata({ locale, page: routes.look, title: t.metaTitle, description: t.metaDescription, index: false });
}

export function LookPage({ locale }: { locale: Locale }) {
  const dictionary = getDictionary(locale);
  return (
    <PageShell locale={locale} page={routes.look}>
      <LookFallback locale={locale} t={dictionary.look} common={dictionary.common} />
    </PageShell>
  );
}
