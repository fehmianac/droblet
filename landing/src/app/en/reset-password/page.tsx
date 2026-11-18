import { ResetPasswordPage, resetPasswordMetadata } from '@/components/FallbackPages';

export const metadata = resetPasswordMetadata('en');

export default function Page() {
  return <ResetPasswordPage locale="en" />;
}
