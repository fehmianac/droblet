'use client';

import { useI18n } from '@/lib/i18n';
import { Field, Input } from './ui';

export const MIN_PASSWORD = 10;
export const MAX_PASSWORD = 128;

/** Client-side mirror of the server rules (the server decides; this only saves a round trip). */
export function passwordProblem(
  password: string,
  confirm: string,
): 'password_too_short' | 'password_too_long' | 'password_too_weak' | 'mismatch' | null {
  if (password.length < MIN_PASSWORD) return 'password_too_short';
  if (password.length > MAX_PASSWORD) return 'password_too_long';
  if (!/\p{L}/u.test(password) || !/\p{N}/u.test(password)) return 'password_too_weak';
  if (password !== confirm) return 'mismatch';
  return null;
}

export function PasswordFields({
  password,
  confirm,
  onPassword,
  onConfirm,
  error,
}: {
  password: string;
  confirm: string;
  onPassword: (v: string) => void;
  onConfirm: (v: string) => void;
  error?: string | null;
}) {
  const { t } = useI18n();
  return (
    <>
      <Field label={t.auth.newPassword} htmlFor="new-password" hint={t.auth.passwordRule} error={error}>
        <Input
          id="new-password"
          type="password"
          autoComplete="new-password"
          required
          minLength={MIN_PASSWORD}
          maxLength={MAX_PASSWORD}
          value={password}
          onChange={(e) => onPassword(e.target.value)}
        />
      </Field>
      <Field label={t.auth.confirmPassword} htmlFor="confirm-password">
        <Input id="confirm-password" type="password" autoComplete="new-password" required value={confirm} onChange={(e) => onConfirm(e.target.value)} />
      </Field>
    </>
  );
}
