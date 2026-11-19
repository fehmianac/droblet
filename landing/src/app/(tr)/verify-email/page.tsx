import { VerifyEmailPage, verifyEmailMetadata } from '@/components/FallbackPages';

export const metadata = verifyEmailMetadata('tr');

export default function Page() {
  return <VerifyEmailPage locale="tr" />;
}
