import { LegalPage, legalMetadata } from '@/components/LegalPage';

export const metadata = legalMetadata('tr', 'terms');

export default function Page() {
  return <LegalPage locale="tr" doc="terms" />;
}
