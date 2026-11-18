import { LegalPage, legalMetadata } from '@/components/LegalPage';

export const metadata = legalMetadata('en', 'kvkk');

export default function Page() {
  return <LegalPage locale="en" doc="kvkk" />;
}
