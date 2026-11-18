import { LegalPage, legalMetadata } from '@/components/LegalPage';

export const metadata = legalMetadata('en', 'subscriptionTerms');

export default function Page() {
  return <LegalPage locale="en" doc="subscriptionTerms" />;
}
