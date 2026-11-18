import { LegalPage, legalMetadata } from '@/components/LegalPage';

export const metadata = legalMetadata('tr', 'consents');

export default function Page() {
  return <LegalPage locale="tr" doc="consents" />;
}
