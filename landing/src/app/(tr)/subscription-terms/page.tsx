import { LegalPage, legalMetadata } from '@/components/LegalPage';

export const metadata = legalMetadata('tr', 'subscriptionTerms');

export default function Page() {
  return <LegalPage locale="tr" doc="subscriptionTerms" />;
}
