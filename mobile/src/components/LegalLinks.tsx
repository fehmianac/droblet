import * as WebBrowser from 'expo-web-browser';
import { Trans } from 'react-i18next';

import { legalUrls, linkDomain } from '@/api/config';
import { currentLanguage } from '@/i18n';
import { Text } from '@/components/ui/Text';

function open(url: string | null) {
  if (url) void WebBrowser.openBrowserAsync(url);
}

/** "Devam ederek Kullanım Koşulları ve Gizlilik Politikası'nı kabul edersin." with tappable links. */
export function LegalConsent() {
  const { terms, privacy } = legalUrls();
  return (
    <Text variant="caption" tone="muted" className="text-center text-[11px] leading-[16.5px]">
      <Trans
        i18nKey="welcome.legal"
        components={{
          terms: <Text variant="caption" tone="ink" className="text-[11px] leading-[16.5px] underline" accessibilityRole="link" onPress={() => open(terms)} />,
          privacy: (
            <Text variant="caption" tone="ink" className="text-[11px] leading-[16.5px] underline" accessibilityRole="link" onPress={() => open(privacy)} />
          ),
        }}
      />
    </Text>
  );
}

/** The site's own page when the build has no explicit URL (`/terms/`, English under `/en/`). */
function sitePage(page: 'terms' | 'privacy'): string {
  return `https://${linkDomain()}${currentLanguage() === 'en' ? '/en' : ''}/${page}/`;
}

export function openTerms() {
  open(legalUrls().terms ?? sitePage('terms'));
}

export function openPrivacy() {
  open(legalUrls().privacy ?? sitePage('privacy'));
}
