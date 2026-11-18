import { DeleteAccountPage, deleteAccountMetadata } from '@/components/DeleteAccountPage';

export const metadata = deleteAccountMetadata('tr');

export default function Page() {
  return <DeleteAccountPage locale="tr" />;
}
