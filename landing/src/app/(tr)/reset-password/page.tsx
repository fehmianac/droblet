import { ResetPasswordPage, resetPasswordMetadata } from '@/components/FallbackPages';

export const metadata = resetPasswordMetadata('tr');

export default function Page() {
  return <ResetPasswordPage locale="tr" />;
}
