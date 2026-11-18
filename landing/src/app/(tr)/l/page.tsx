import { LookPage, lookMetadata } from '@/components/FallbackPages';

export const metadata = lookMetadata('tr');

export default function Page() {
  return <LookPage locale="tr" />;
}
