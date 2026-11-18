import { LegalPage, legalMetadata } from '@/components/LegalPage';

export const metadata = legalMetadata('en', 'cookies');

export default function Page() {
  return <LegalPage locale="en" doc="cookies" />;
}
