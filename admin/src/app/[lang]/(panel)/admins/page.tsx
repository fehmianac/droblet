'use client';

import { useState } from 'react';
import { RequirePermission } from '@/components/Shell';
import { fieldErrors } from '@/components/forms';
import {
  Badge,
  Button,
  Card,
  ConfirmModal,
  DataTable,
  Drawer,
  ErrorState,
  Field,
  IconButton,
  Input,
  PageHeader,
  Select,
  TableSkeleton,
  Toggle,
  useAsync,
  useToast,
  type Column,
} from '@/components/ui';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useI18n } from '@/lib/i18n';
import { ROLES, type AdminUser, type Role } from '@/lib/types';

interface Form {
  id: string | null;
  email: string;
  name: string;
  role: Role;
  disabled: boolean;
}

type Pending = { kind: 'revoke' | 'delete' | 'invite'; admin: AdminUser };

function AdminsInner() {
  const { t, fmt, dateTime, errorText, fieldError } = useI18n();
  const { me } = useAuth();
  const toast = useToast();
  const list = useAsync(() => api.get<AdminUser[]>('v1/admin/admin-user'), []);
  const [form, setForm] = useState<Form | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<Pending | null>(null);

  const set = <K extends keyof Form>(key: K, value: Form[K]) => setForm((f) => (f ? { ...f, [key]: value } : f));
  const isSelf = form?.id === me?.id;

  const save = async () => {
    if (!form) return;
    setBusy(true);
    setErrors({});
    try {
      if (form.id) await api.put(`v1/admin/admin-user/${encodeURIComponent(form.id)}`, { name: form.name.trim(), role: form.role, disabled: form.disabled });
      else await api.post('v1/admin/admin-user', { email: form.email.trim(), name: form.name.trim(), role: form.role });
      toast.success(form.id ? t.common.saved : t.admins.inviteSent);
      setForm(null);
      list.reload();
    } catch (error) {
      setErrors(fieldErrors(error, fieldError));
      toast.error(errorText(error));
    } finally {
      setBusy(false);
    }
  };

  const confirm = async () => {
    if (!pending) return;
    const path = `v1/admin/admin-user/${encodeURIComponent(pending.admin.id)}`;
    setBusy(true);
    try {
      if (pending.kind === 'delete') await api.del(path);
      else if (pending.kind === 'revoke') await api.post(`${path}/revoke-sessions`);
      else await api.post(`${path}/invite`);
      toast.success(pending.kind === 'delete' ? t.common.deleted : pending.kind === 'revoke' ? t.admins.sessionsRevoked : t.admins.inviteSent);
      setPending(null);
      list.reload();
    } catch (error) {
      toast.error(errorText(error));
    } finally {
      setBusy(false);
    }
  };

  const columns: Column<AdminUser>[] = [
    {
      key: 'name',
      header: t.common.name,
      sortValue: (a) => a.email,
      render: (a) => (
        <div className="flex items-center gap-3">
          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-side-700 text-sm font-semibold text-white">{(a.name || a.email).slice(0, 1)}</span>
          <div>
            <p className="font-medium">
              {a.name} {a.id === me?.id && <Badge tone="brand">{t.admins.you}</Badge>}
            </p>
            <p className="text-xs text-muted">{a.email}</p>
          </div>
        </div>
      ),
    },
    { key: 'role', header: t.admins.role, sortValue: (a) => a.role, render: (a) => <Badge tone={a.role === 'superAdmin' ? 'brand' : a.role === 'moderator' ? 'amber' : 'blue'}>{t.roles[a.role]}</Badge> },
    { key: 'status', header: t.common.status, render: (a) => (a.disabled ? <Badge tone="red">{t.admins.disabled}</Badge> : <Badge tone="green">{t.admins.enabled}</Badge>) },
    { key: 'password', header: t.admins.passwordSet, render: (a) => (a.passwordSet ? <Badge tone="green">{t.admins.passwordOk}</Badge> : <Badge tone="amber">{t.admins.passwordPending}</Badge>) },
    { key: 'last', header: t.admins.lastLogin, sortValue: (a) => a.lastLoginAt ?? '', render: (a) => <span className="text-muted">{a.lastLoginAt ? dateTime(a.lastLoginAt) : t.admins.never}</span> },
    {
      key: 'actions',
      header: <span className="sr-only">{t.common.actions}</span>,
      className: 'text-right',
      render: (a) => (
        <div className="flex justify-end gap-1">
          <IconButton icon="key" label={t.admins.resendInvite} onClick={() => setPending({ kind: 'invite', admin: a })} />
          <IconButton icon="logout" label={t.admins.revokeSessions} onClick={() => setPending({ kind: 'revoke', admin: a })} />
          <IconButton
            icon="pencil"
            label={t.common.edit}
            onClick={() => {
              setErrors({});
              setForm({ id: a.id, email: a.email, name: a.name, role: a.role, disabled: a.disabled });
            }}
          />
          {a.id !== me?.id && <IconButton icon="trash" label={t.common.delete} onClick={() => setPending({ kind: 'delete', admin: a })} />}
        </div>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title={t.admins.title}
        subtitle={t.admins.subtitle}
        actions={
          <Button
            icon="plus"
            onClick={() => {
              setErrors({});
              setForm({ id: null, email: '', name: '', role: 'contentEditor', disabled: false });
            }}
          >
            {t.admins.invite}
          </Button>
        }
      />
      <Card padded={false}>
        {list.loading ? <TableSkeleton /> : list.error ? <ErrorState error={list.error} onRetry={list.reload} /> : <DataTable columns={columns} rows={list.data ?? []} rowKey={(a) => a.id} />}
      </Card>
      <Card title={t.admins.permissions} className="mt-4" padded={false}>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line bg-stone-50/60 text-left text-xs text-muted">
                <th className="px-5 py-2.5 font-medium">{t.admins.permissions}</th>
                {ROLES.map((r) => (
                  <th key={r} className="px-5 py-2.5 text-center font-medium">
                    {t.roles[r]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(Object.keys(t.permissions) as (keyof typeof t.permissions)[]).map((p) => (
                <tr key={p} className="border-b border-line last:border-b-0">
                  <td className="px-5 py-2">
                    {t.permissions[p]} <span className="font-mono text-xs text-muted">{p}</span>
                  </td>
                  {ROLES.map((r) => (
                    <td key={r} className="px-5 py-2 text-center">
                      {ROLE_MATRIX[r].includes(p) ? <span className="text-emerald-600">●</span> : <span className="text-stone-300">○</span>}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      <Drawer
        open={!!form}
        title={form?.id ? t.admins.editTitle : t.admins.inviteTitle}
        onClose={() => setForm(null)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setForm(null)}>
              {t.common.cancel}
            </Button>
            <Button loading={busy} onClick={() => void save()}>
              {form?.id ? t.common.save : t.admins.invite}
            </Button>
          </>
        }
      >
        {form && (
          <div className="space-y-4">
            {!form.id && <p className="rounded-lg bg-brand-50 px-3 py-2 text-sm text-brand-800">{t.admins.inviteHint}</p>}
            <Field label={t.admins.email} htmlFor="a-email" required error={errors.email}>
              <Input id="a-email" type="email" value={form.email} disabled={!!form.id} onChange={(e) => set('email', e.target.value)} />
            </Field>
            <Field label={t.common.name} htmlFor="a-name" required error={errors.name}>
              <Input id="a-name" value={form.name} maxLength={80} onChange={(e) => set('name', e.target.value)} />
            </Field>
            <Field label={t.admins.role} htmlFor="a-role" error={errors.role}>
              <Select id="a-role" value={form.role} disabled={isSelf} onChange={(e) => set('role', e.target.value as Role)}>
                {ROLES.map((r) => (
                  <option key={r} value={r}>
                    {t.roles[r]}
                  </option>
                ))}
              </Select>
            </Field>
            {form.id && (
              <label className="flex items-center justify-between rounded-lg border border-line px-4 py-3 text-sm">
                {t.admins.disableLabel}
                <Toggle checked={form.disabled} disabled={isSelf} onChange={(v) => set('disabled', v)} label={t.admins.disableLabel} />
              </label>
            )}
          </div>
        )}
      </Drawer>
      <ConfirmModal
        open={!!pending}
        title={pending?.kind === 'delete' ? t.common.delete : pending?.kind === 'revoke' ? t.admins.revokeSessions : t.admins.resendInvite}
        body={
          pending
            ? pending.kind === 'delete'
              ? fmt(t.admins.deleteConfirm, { email: pending.admin.email })
              : pending.kind === 'revoke'
                ? fmt(t.admins.revokeConfirm, { email: pending.admin.email })
                : pending.admin.email
            : ''
        }
        confirmLabel={pending?.kind === 'delete' ? t.common.delete : t.common.confirm}
        danger={pending?.kind !== 'invite'}
        busy={busy}
        onClose={() => setPending(null)}
        onConfirm={() => void confirm()}
      />
    </div>
  );
}

// Display only; the server is the authority (docs/api/admin.md §2).
const ROLE_MATRIX: Record<Role, string[]> = {
  superAdmin: [
    'dashboard.view', 'analytics.view', 'catalog.manage', 'content.manage', 'image.upload', 'users.read', 'users.suspend', 'users.delete',
    'users.grant', 'moderation.manage', 'settings.manage', 'admins.manage', 'audit.view', 'maintenance.manage',
  ],
  contentEditor: ['dashboard.view', 'analytics.view', 'catalog.manage', 'content.manage', 'image.upload'],
  moderator: ['dashboard.view', 'users.read', 'users.suspend', 'moderation.manage'],
};

export default function AdminsPage() {
  return (
    <RequirePermission permission="admins.manage">
      <AdminsInner />
    </RequirePermission>
  );
}
