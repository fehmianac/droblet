import { ParentConsentPage, parentConsentMetadata } from '@/components/ParentConsentPage';

export const metadata = parentConsentMetadata('tr');

export default function Page() {
  return <ParentConsentPage locale="tr" />;
}
