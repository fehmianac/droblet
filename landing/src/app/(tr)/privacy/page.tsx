import { LegalPage, legalMetadata } from '@/components/LegalPage';

export const metadata = legalMetadata('tr', 'privacy');

export default function Page() {
  return <LegalPage locale="tr" doc="privacy" />;
}
