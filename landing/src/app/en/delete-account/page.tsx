import { DeleteAccountPage, deleteAccountMetadata } from '@/components/DeleteAccountPage';

export const metadata = deleteAccountMetadata('en');

export default function Page() {
  return <DeleteAccountPage locale="en" />;
}
