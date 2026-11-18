import type { ReactNode } from 'react';
import { PanelShell } from '@/components/Shell';

export default function PanelLayout({ children }: { children: ReactNode }) {
  return <PanelShell>{children}</PanelShell>;
}
