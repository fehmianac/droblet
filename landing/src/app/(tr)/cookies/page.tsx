import { LegalPage, legalMetadata } from '@/components/LegalPage';

export const metadata = legalMetadata('tr', 'cookies');

export default function Page() {
  return <LegalPage locale="tr" doc="cookies" />;
}
