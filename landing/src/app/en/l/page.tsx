import { LookPage, lookMetadata } from '@/components/FallbackPages';

export const metadata = lookMetadata('en');

export default function Page() {
  return <LookPage locale="en" />;
}
