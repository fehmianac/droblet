// Writes the thin route files for one language: `node scripts/make-routes.mjs en`.
// The default language (tr) lives in the `(tr)` route group at the site root; every other language in
// `src/app/{locale}/`. Each file only names the locale — the page itself is a shared component.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const locale = process.argv[2];
if (!/^[a-z]{2}$/.test(locale ?? '')) {
  console.error('usage: node scripts/make-routes.mjs <locale>');
  process.exit(1);
}

const defaultLocale = 'tr';
const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'app', locale === defaultLocale ? `(${locale})` : locale);

const page = (imports, metadata, element) => `${imports}

export const metadata = ${metadata};

export default function Page() {
  return ${element};
}
`;

const legal = (doc) =>
  page(
    "import { LegalPage, legalMetadata } from '@/components/LegalPage';",
    `legalMetadata('${locale}', '${doc}')`,
    `<LegalPage locale="${locale}" doc="${doc}" />`,
  );

const files = {
  'layout.tsx': `import { LocaleDocument } from '@/components/LocaleDocument';

export default function Layout({ children }: { children: React.ReactNode }) {
  return <LocaleDocument locale="${locale}">{children}</LocaleDocument>;
}
`,
  'page.tsx': page(
    "import { HomePage, homeMetadata } from '@/components/HomePage';",
    `homeMetadata('${locale}')`,
    `<HomePage locale="${locale}" />`,
  ),
  'terms/page.tsx': legal('terms'),
  'privacy/page.tsx': legal('privacy'),
  'kvkk/page.tsx': legal('kvkk'),
  'consents/page.tsx': legal('consents'),
  'subscription-terms/page.tsx': legal('subscriptionTerms'),
  'cookies/page.tsx': legal('cookies'),
  'community-guidelines/page.tsx': legal('communityGuidelines'),
  'delete-account/page.tsx': page(
    "import { DeleteAccountPage, deleteAccountMetadata } from '@/components/DeleteAccountPage';",
    `deleteAccountMetadata('${locale}')`,
    `<DeleteAccountPage locale="${locale}" />`,
  ),
  'reset-password/page.tsx': page(
    "import { ResetPasswordPage, resetPasswordMetadata } from '@/components/FallbackPages';",
    `resetPasswordMetadata('${locale}')`,
    `<ResetPasswordPage locale="${locale}" />`,
  ),
  'verify-email/page.tsx': page(
    "import { VerifyEmailPage, verifyEmailMetadata } from '@/components/FallbackPages';",
    `verifyEmailMetadata('${locale}')`,
    `<VerifyEmailPage locale="${locale}" />`,
  ),
  'invite/page.tsx': page(
    "import { InvitePage, inviteMetadata } from '@/components/FallbackPages';",
    `inviteMetadata('${locale}')`,
    `<InvitePage locale="${locale}" />`,
  ),
  'l/page.tsx': page(
    "import { LookPage, lookMetadata } from '@/components/FallbackPages';",
    `lookMetadata('${locale}')`,
    `<LookPage locale="${locale}" />`,
  ),
};

for (const [name, content] of Object.entries(files)) {
  const target = join(root, name);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, content);
  console.log(`wrote ${target}`);
}
