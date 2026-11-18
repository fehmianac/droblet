import { LocaleDocument } from '@/components/LocaleDocument';

export default function Layout({ children }: { children: React.ReactNode }) {
  return <LocaleDocument locale="tr">{children}</LocaleDocument>;
}
