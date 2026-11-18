import { LegalPage, legalMetadata } from '@/components/LegalPage';

export const metadata = legalMetadata('tr', 'communityGuidelines');

export default function Page() {
  return <LegalPage locale="tr" doc="communityGuidelines" />;
}
