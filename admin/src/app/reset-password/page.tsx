'use client';

import { useEffect } from 'react';
import { preferredLang } from '@/lib/i18n';

/**
 * The e-mailed link is https://droblet-admin.alatech.co/reset-password?token=… (no language in it):
 * forward to the localized page, keeping the query (the token) and dropping nothing else.
 */
export default function ResetPasswordRedirect() {
  useEffect(() => {
    window.location.replace(`/${preferredLang()}/reset-password/${window.location.search}`);
  }, []);
  return null;
}
