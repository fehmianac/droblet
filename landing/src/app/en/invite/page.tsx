import { InvitePage, inviteMetadata } from '@/components/FallbackPages';

export const metadata = inviteMetadata('en');

export default function Page() {
  return <InvitePage locale="en" />;
}
