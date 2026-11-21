import { ParentConsentPage, parentConsentMetadata } from '@/components/ParentConsentPage';

export const metadata = parentConsentMetadata('en');

export default function Page() {
  return <ParentConsentPage locale="en" />;
}
