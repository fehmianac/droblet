import { VerifyEmailPage, verifyEmailMetadata } from '@/components/FallbackPages';

export const metadata = verifyEmailMetadata('en');

export default function Page() {
  return <VerifyEmailPage locale="en" />;
}
