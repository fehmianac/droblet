'use client';

import { useState, type FormEvent } from 'react';
import { PasswordFields, passwordProblem } from '@/components/PasswordFields';
import { Badge, Button, Card, ConfirmModal, Field, Input, PageHeader, useToast } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useI18n } from '@/lib/i18n';

export default function AccountPage() {
  const { t, errorText, fieldError } = useI18n();
  const { me, logoutAll, endLocal } = useAuth();
  const toast = useToast();
  const [current, setCurrent] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmAll, setConfirmAll] = useState(false);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const problem = passwordProblem(password, confirm);
    if (problem) {
      setError(problem === 'mismatch' ? t.auth.passwordMismatch : fieldError(problem));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.put('v1/admin/auth/password', { currentPassword: current, newPassword: password });
      // The server ends every session, this one too: sign in again with the new password.
      toast.success(t.account.changed);
      endLocal('passwordChanged');
    } catch (err) {
      const code = err instanceof ApiError ? Object.values(err.errors)[0]?.[0] : undefined;
      setError(code ? fieldError(code) : errorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <PageHeader title={t.account.title} subtitle={t.account.subtitle} />
      <div className="grid gap-4 xl:grid-cols-3">
        <Card title={t.userDetail.profile}>
          <dl className="space-y-3 text-sm">
            <div>
              <dt className="text-muted">{t.common.name}</dt>
              <dd className="font-medium">{me?.name}</dd>
            </div>
            <div>
              <dt className="text-muted">{t.admins.email}</dt>
              <dd className="font-medium">{me?.email}</dd>
            </div>
            <div>
              <dt className="text-muted">{t.admins.role}</dt>
              <dd>{me && <Badge tone="brand">{t.roles[me.role]}</Badge>}</dd>
            </div>
            <div>
              <dt className="mb-1 text-muted">{t.admins.permissions}</dt>
              <dd className="flex flex-wrap gap-1">
                {me?.permissions.map((p) => (
                  <Badge key={p}>{(t.permissions as Record<string, string>)[p] ?? p}</Badge>
                ))}
              </dd>
            </div>
          </dl>
        </Card>
        <Card title={t.account.changePassword}>
          <form onSubmit={onSubmit} className="space-y-4">
            <Field label={t.auth.currentPassword} htmlFor="cur-password">
              <Input id="cur-password" type="password" autoComplete="current-password" required value={current} onChange={(e) => setCurrent(e.target.value)} />
            </Field>
            <PasswordFields password={password} confirm={confirm} onPassword={setPassword} onConfirm={setConfirm} error={error} />
            <Button type="submit" loading={busy}>
              {t.auth.setPassword}
            </Button>
          </form>
        </Card>
        <Card title={t.account.sessions}>
          <p className="mb-4 text-sm text-muted">{t.account.sessionsHint}</p>
          <Button variant="danger" icon="logout" onClick={() => setConfirmAll(true)}>
            {t.topbar.logoutAll}
          </Button>
        </Card>
      </div>
      <ConfirmModal
        open={confirmAll}
        title={t.topbar.logoutAll}
        body={t.topbar.logoutAllConfirm}
        confirmLabel={t.topbar.logoutAll}
        danger
        onClose={() => setConfirmAll(false)}
        onConfirm={() => void logoutAll()}
      />
    </div>
  );
}
