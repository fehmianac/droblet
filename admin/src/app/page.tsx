'use client';

import { useEffect } from 'react';
import { preferredLang } from '@/lib/i18n';

export default function RootRedirect() {
  useEffect(() => {
    window.location.replace(`/${preferredLang()}/`);
  }, []);
  return null;
}
