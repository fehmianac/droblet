import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { AuthProvider } from '@/lib/auth';
import { ToastProvider } from '@/components/ui';
import './globals.css';

export const metadata: Metadata = {
  title: 'Droblet Admin',
  icons: { icon: '/favicon.svg' },
  // An admin panel is never indexed.
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};

export const viewport: Viewport = { themeColor: '#1c1a17' };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="tr">
      <body>
        <AuthProvider>
          <ToastProvider>{children}</ToastProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
