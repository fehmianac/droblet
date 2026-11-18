import { LegalPage, legalMetadata } from '@/components/LegalPage';

export const metadata = legalMetadata('en', 'consents');

export default function Page() {
  return <LegalPage locale="en" doc="consents" />;
}
