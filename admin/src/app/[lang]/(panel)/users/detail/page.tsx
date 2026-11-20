'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useState, type ReactNode } from 'react';
import { RequirePermission } from '@/components/Shell';
import { UserAiUsageTab } from '@/components/UserAiUsage';
import { LinkButton } from '@/components/forms';
import { Icon } from '@/components/icons';
import { Badge, Button, Card, ConfirmModal, ErrorState, Field, Input, PageHeader, Skeleton, Tabs, Textarea, useAsync, useToast } from '@/components/ui';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useI18n } from '@/lib/i18n';
import type { AppUserDetail } from '@/lib/types';

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex justify-between gap-4 border-b border-line py-2.5 text-sm last:border-b-0">
      <dt className="text-muted">{label}</dt>
      <dd className="text-right font-medium break-all text-ink">{children}</dd>
    </div>
  );
}

function Meter({ value, max }: { value: number; max: number }) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  return (
    <svg viewBox="0 0 100 6" preserveAspectRatio="none" className="mt-2 h-1.5 w-full" aria-hidden="true">
      <rect width="100" height="6" rx="3" fill="#f0ece6" />
      <rect width={pct} height="6" rx="3" fill="#6e5640" />
    </svg>
  );
}

function UserDetailInner() {
  const { t, fmt, href, date, dateTime, number, errorText, fieldError } = useI18n();
  const { can } = useAuth();
  const toast = useToast();
  const router = useRouter();
  const params = useSearchParams();
  const id = params.get('id') ?? '';
  const user = useAsync(() => api.get<AppUserDetail>(`v1/admin/user/${encodeURIComponent(id)}`), [id]);
  const [modal, setModal] = useState<'suspend' | 'delete' | null>(null);
  const [reason, setReason] = useState('');
  const [confirmText, setConfirmText] = useState('');
  const [days, setDays] = useState('14');
  const [credits, setCredits] = useState('20');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [tab, setTab] = useState<'profile' | 'ai'>(() => (params.get('tab') === 'ai' ? 'ai' : 'profile'));

  const base = `v1/admin/user/${encodeURIComponent(id)}`;
  const act = async (key: string, run: () => Promise<AppUserDetail | void>, success: string) => {
    setBusy(key);
    try {
      const next = await run();
      if (next) user.setData(next);
      toast.success(success);
      setModal(null);
      return true;
    } catch (error) {
      toast.error(errorText(error));
      return false;
    } finally {
      setBusy(null);
    }
  };

  if (user.error) {
    return (
      <Card>
        <ErrorState error={user.error} onRetry={user.reload} />
      </Card>
    );
  }
  const u = user.data;
  if (!u) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-16 w-96" />
        <div className="grid gap-4 xl:grid-cols-3">
          <Skeleton className="h-80 xl:col-span-2" />
          <Skeleton className="h-80" />
        </div>
      </div>
    );
  }

  const daysN = Number(days);
  const creditsN = Number(credits);
  const daysValid = Number.isInteger(daysN) && daysN >= 1 && daysN <= 90;
  const creditsValid = Number.isInteger(creditsN) && creditsN >= 1 && creditsN <= 500;
  const counts: [string, number][] = [
    [t.userDetail.items, u.counts.items],
    [t.userDetail.looks, u.counts.looks],
    [t.userDetail.trips, u.counts.trips],
    [t.userDetail.followers, u.counts.followers],
    [t.userDetail.following, u.counts.following],
  ];
  const enumText = (map: Record<string, string>, key: string | null) => (key ? (map[key] ?? key) : '—');

  return (
    <div>
      <PageHeader
        title={
          <span className="flex items-center gap-3">
            <span className="flex h-11 w-11 items-center justify-center rounded-full bg-brand-600 text-lg font-semibold text-white">
              {(u.displayName || u.email || '?').slice(0, 1)}
            </span>
            <span>
              {u.displayName || u.email || u.id}
              <span className="ml-2 align-middle">{u.suspended ? <Badge tone="red">{t.users.suspended}</Badge> : <Badge tone="green">{t.common.active}</Badge>}</span>
            </span>
          </span>
        }
        subtitle={[u.email, u.handle ? `@${u.handle}` : null].filter(Boolean).join(' · ')}
        actions={
          <>
            <LinkButton href={href('/users/')} variant="secondary" icon="chevronLeft">
              {t.common.back}
            </LinkButton>
            {can('users.suspend') &&
              (u.suspended ? (
                <Button variant="secondary" icon="check" loading={busy === 'unsuspend'} onClick={() => void act('unsuspend', () => api.post<AppUserDetail>(`${base}/unsuspend`), t.common.saved)}>
                  {t.userDetail.unsuspend}
                </Button>
              ) : (
                <Button variant="danger" icon="ban" onClick={() => setModal('suspend')}>
                  {t.userDetail.suspend}
                </Button>
              ))}
          </>
        }
      />
      <p className="mb-4 flex items-center gap-2 text-xs text-muted">
        <Icon name="shield" className="h-4 w-4" />
        {t.userDetail.privacyNote}
      </p>

      {u.suspended && (
        <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-5 py-4 text-sm text-red-900">
          <p className="font-medium">{fmt(t.userDetail.suspendedSince, { date: dateTime(u.suspendedAt) })}</p>
          {u.suspendReason && (
            <p className="mt-1">
              {t.userDetail.reason}: {u.suspendReason}
            </p>
          )}
        </div>
      )}

      {can('ai.usage.view') && (
        <div className="mb-4">
          <Tabs
            label={t.userDetail.title}
            value={tab}
            onChange={setTab}
            tabs={[
              { id: 'profile', label: t.userDetail.tabProfile },
              { id: 'ai', label: t.userDetail.tabAiUsage },
            ]}
          />
        </div>
      )}

      {tab === 'ai' && can('ai.usage.view') ? (
        <UserAiUsageTab userId={u.id} />
      ) : (
        <div className="grid gap-4 xl:grid-cols-3">
          <div className="space-y-4 xl:col-span-2">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
              {counts.map(([label, value]) => (
                <div key={label} className="rounded-xl border border-line bg-white px-4 py-3">
                  <p className="text-xs text-muted">{label}</p>
                  <p className="mt-1 text-xl font-semibold tabular-nums">{number(value)}</p>
                </div>
              ))}
            </div>
            <Card title={t.userDetail.profile}>
              <dl>
                <Row label={t.common.id}>
                  <span className="font-mono text-xs">{u.id}</span>
                </Row>
                <Row label={t.userDetail.tenantId}>
                  <span className="font-mono text-xs">{u.tenantId}</span>
                </Row>
                <Row label={t.users.email}>{u.email ?? '—'}</Row>
                <Row label={t.users.handle}>{u.handle ? `@${u.handle}` : '—'}</Row>
                <Row label={t.userDetail.language}>{u.language}</Row>
                <Row label={t.userDetail.visibility}>{enumText(t.enums.visibility, u.closetVisibility)}</Row>
                <Row label={t.userDetail.providers}>{u.providers.map((p) => enumText(t.enums.provider, p)).join(', ') || '—'}</Row>
                <Row label={t.common.createdAt}>{dateTime(u.createdAt)}</Row>
              </dl>
            </Card>
            <Card title={t.userDetail.devices} padded={u.devices.length === 0}>
              {u.devices.length === 0 ? (
                <p className="text-sm text-muted">{t.userDetail.noDevices}</p>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-line bg-stone-50/60 text-left text-xs text-muted">
                      <th className="px-5 py-2.5 font-medium">{t.common.id}</th>
                      <th className="px-5 py-2.5 font-medium">{t.common.name}</th>
                      <th className="px-5 py-2.5 font-medium">{t.userDetail.push}</th>
                      <th className="px-5 py-2.5 font-medium">{t.common.updatedAt}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {u.devices.map((d) => (
                      <tr key={d.deviceId} className="border-b border-line last:border-b-0">
                        <td className="px-5 py-2.5 font-mono text-xs">{d.deviceId}</td>
                        <td className="px-5 py-2.5">{enumText(t.enums.platform, d.platform)}</td>
                        <td className="px-5 py-2.5">{d.pushEnabled ? <Badge tone="green">{t.settings.on}</Badge> : <Badge>{t.settings.off}</Badge>}</td>
                        <td className="px-5 py-2.5 text-muted">{dateTime(d.updatedAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Card>
          </div>

          <div className="space-y-4">
            <Card title={t.userDetail.entitlement}>
              <dl>
                <Row label={t.userDetail.tier}>
                  <Badge tone={u.entitlement.tier === 'premium' ? 'brand' : 'neutral'}>{t.enums.tier[u.entitlement.tier]}</Badge>
                </Row>
                <Row label={t.userDetail.source}>{enumText(t.enums.entitlementSource, u.entitlement.source)}</Row>
                <Row label={t.userDetail.expiresAt}>{dateTime(u.entitlement.expiresAt)}</Row>
              </dl>
              <div className="mt-4 space-y-4 border-t border-line pt-4">
                <div>
                  <div className="flex justify-between text-sm">
                    <span className="text-muted">{t.userDetail.allowance}</span>
                    <span className="font-medium tabular-nums">
                      {fmt(t.userDetail.allowanceLeft, { left: u.credits.allowanceRemaining, total: u.credits.allowanceTotal })}
                    </span>
                  </div>
                  <Meter value={u.credits.allowanceRemaining} max={u.credits.allowanceTotal} />
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted">{t.userDetail.packBalance}</span>
                  <span className="font-medium tabular-nums">{number(u.credits.packBalance)}</span>
                </div>
                <div>
                  <div className="flex justify-between text-sm">
                    <span className="text-muted">{t.userDetail.recognition}</span>
                    <span className="font-medium tabular-nums">
                      {u.itemRecognition.unlimited ? t.userDetail.unlimited : fmt(t.userDetail.recognitionUsed, { used: u.itemRecognition.used, limit: u.itemRecognition.limit })}
                    </span>
                  </div>
                  {!u.itemRecognition.unlimited && <Meter value={u.itemRecognition.used} max={u.itemRecognition.limit} />}
                </div>
              </div>
            </Card>

            {can('users.grant') && (
              <section className="rounded-xl border-2 border-dashed border-amber-300 bg-amber-50/60 p-5">
                <h2 className="flex items-center gap-2 text-sm font-semibold tracking-wide text-amber-900">
                  <Icon name="gift" className="h-4 w-4" />
                  {t.userDetail.testTitle}
                </h2>
                <p className="mt-1 text-xs text-amber-900/80">{t.userDetail.testHint}</p>

                <div className="mt-4 space-y-3 rounded-lg bg-white p-4">
                  <p className="text-sm font-medium">{t.userDetail.testPremium}</p>
                  <p className="text-xs text-muted">
                    {u.entitlement.testPremiumExpiresAt ? fmt(t.userDetail.testPremiumActive, { date: date(u.entitlement.testPremiumExpiresAt) }) : t.userDetail.testPremiumNone}
                  </p>
                  <div className="flex items-end gap-2">
                    <Field label={t.userDetail.days} htmlFor="tp-days" className="w-24" error={daysValid ? null : fieldError('days_invalid')}>
                      <Input id="tp-days" type="number" min={1} max={90} value={days} onChange={(e) => setDays(e.target.value)} />
                    </Field>
                    <Button
                      size="md"
                      disabled={!daysValid}
                      loading={busy === 'premium'}
                      onClick={() => void act('premium', () => api.put<AppUserDetail>(`${base}/test-premium`, { days: daysN, note: note.trim() || null }), t.userDetail.granted)}
                    >
                      {t.userDetail.grantPremium}
                    </Button>
                  </div>
                  {u.entitlement.testPremiumExpiresAt && (
                    <Button variant="ghost" size="sm" icon="x" loading={busy === 'revoke'} onClick={() => void act('revoke', () => api.del<AppUserDetail>(`${base}/test-premium`), t.common.saved)}>
                      {t.userDetail.revokePremium}
                    </Button>
                  )}
                </div>

                <div className="mt-3 space-y-3 rounded-lg bg-white p-4">
                  <p className="text-sm font-medium">{t.userDetail.addCredits}</p>
                  <div className="flex items-end gap-2">
                    <Field label={t.userDetail.creditsLabel} htmlFor="tc-credits" className="w-24" error={creditsValid ? null : fieldError('credits_invalid')}>
                      <Input id="tc-credits" type="number" min={1} max={500} value={credits} onChange={(e) => setCredits(e.target.value)} />
                    </Field>
                    <Button
                      disabled={!creditsValid}
                      loading={busy === 'credits'}
                      onClick={() => void act('credits', () => api.post<AppUserDetail>(`${base}/credits`, { credits: creditsN, note: note.trim() || null }), t.userDetail.granted)}
                    >
                      {t.userDetail.addCredits}
                    </Button>
                  </div>
                </div>
                <Field label={t.userDetail.note} htmlFor="tg-note" className="mt-3">
                  <Input id="tg-note" value={note} maxLength={200} onChange={(e) => setNote(e.target.value)} />
                </Field>
              </section>
            )}

            {can('users.delete') && (
              <Card title={t.userDetail.danger} className="border-red-200">
                <p className="mb-3 text-sm text-muted">{t.userDetail.deleteHint}</p>
                <Button variant="danger" icon="trash" onClick={() => setModal('delete')}>
                  {t.userDetail.deleteAccount}
                </Button>
              </Card>
            )}
          </div>
        </div>
      )}

      <ConfirmModal
        open={modal === 'suspend'}
        title={t.userDetail.suspendTitle}
        body={t.userDetail.suspendHint}
        confirmLabel={t.userDetail.suspend}
        danger
        busy={busy === 'suspend'}
        disabled={!reason.trim()}
        onClose={() => setModal(null)}
        onConfirm={() => void act('suspend', () => api.post<AppUserDetail>(`${base}/suspend`, { reason: reason.trim() }), t.common.saved)}
      >
        <Field label={t.userDetail.reason} htmlFor="sus-reason" className="mt-3">
          <Textarea id="sus-reason" maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
      </ConfirmModal>
      <ConfirmModal
        open={modal === 'delete'}
        title={t.userDetail.deleteTitle}
        body={t.userDetail.deleteHint}
        confirmLabel={t.userDetail.deleteAccount}
        danger
        busy={busy === 'delete'}
        disabled={confirmText.trim() !== (u.email ?? u.id) && confirmText.trim() !== u.id}
        onClose={() => setModal(null)}
        onConfirm={() =>
          void act('delete', () => api.del(base), t.common.deleted).then((ok) => {
            if (ok) router.replace(href('/users/'));
          })
        }
      >
        <Field label={t.userDetail.deleteConfirmLabel} htmlFor="del-confirm" hint={u.email ?? u.id} className="mt-3">
          <Input id="del-confirm" value={confirmText} onChange={(e) => setConfirmText(e.target.value)} autoComplete="off" />
        </Field>
      </ConfirmModal>
    </div>
  );
}

export default function UserDetailPage() {
  return (
    <RequirePermission permission="users.read">
      <UserDetailInner />
    </RequirePermission>
  );
}
