import { LegalPage, legalMetadata } from '@/components/LegalPage';

export const metadata = legalMetadata('en', 'communityGuidelines');

export default function Page() {
  return <LegalPage locale="en" doc="communityGuidelines" />;
}
