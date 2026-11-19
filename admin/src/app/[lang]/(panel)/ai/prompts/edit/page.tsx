'use client';

import { useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  DiffView,
  FallbackBanner,
  PromptEditor,
  TrialResult,
  cacheWarnings,
  renderTemplate,
  staticPrefix,
  useTrial,
  validatePrompt,
} from '@/components/ai';
import { RequirePermission } from '@/components/Shell';
import { LinkButton, UploadButton, fieldErrors } from '@/components/forms';
import { Icon } from '@/components/icons';
import {
  Badge,
  Button,
  Card,
  ConfirmModal,
  DataTable,
  ErrorState,
  Field,
  IconButton,
  Input,
  PageHeader,
  Skeleton,
  Tabs,
  Textarea,
  useAsync,
  useToast,
  type Column,
} from '@/components/ui';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useI18n } from '@/lib/i18n';
import type { AiPromptDetail, AiPromptVersion } from '@/lib/types';

function SchemaCard({ schema, title }: { schema: string; title: string }) {
  const { t } = useI18n();
  return (
    <Card title={title} subtitle={t.ai.schemaHint}>
      <pre className="max-h-[420px] overflow-auto rounded-lg border border-line bg-stone-50 p-3 font-mono text-xs leading-5 text-ink">{schema}</pre>
    </Card>
  );
}

function Editor({ detail, setDetail }: { detail: AiPromptDetail; setDetail: (d: AiPromptDetail) => void }) {
  const { t, fmt, dateTime, number, errorText, fieldError } = useI18n();
  const { can } = useAuth();
  const toast = useToast();
  const key = detail.summary.key;
  const live = detail.publishedText ?? detail.defaultText;
  const saved = detail.draftText ?? live;
  const [text, setText] = useState(saved);
  const [serverErrors, setServerErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [publishOpen, setPublishOpen] = useState(false);
  const [note, setNote] = useState('');
  const [rollback, setRollback] = useState<number | null>(null);
  const [rollbackNote, setRollbackNote] = useState('');
  const [diffTab, setDiffTab] = useState<'published' | 'default'>('published');
  const [input, setInput] = useState(detail.sampleInput ?? '');
  const [images, setImages] = useState<string[]>(() => Array.from({ length: detail.imagesRequired }, () => ''));
  const [expanded, setExpanded] = useState<number | null>(null);
  const editorRef = useRef<HTMLTextAreaElement>(null);
  const trial = useTrial();

  useEffect(() => {
    setText(detail.draftText ?? detail.publishedText ?? detail.defaultText);
  }, [detail.summary.key, detail.draftText, detail.publishedText, detail.defaultText]);

  const errors = useMemo(() => ({ ...validatePrompt(detail, text), ...serverErrors }), [detail, text, serverErrors]);
  const warnings = cacheWarnings(detail, text);
  const dirty = text !== saved;
  const hasDraft = detail.draftText !== null;
  const textError = errors.text ? fieldError(errors.text) : null;
  const placeholderErrors = Object.entries(errors).filter(([k]) => k.startsWith('placeholders.'));

  const act = async (name: string, run: () => Promise<AiPromptDetail>, success: string) => {
    setBusy(name);
    setServerErrors({});
    try {
      setDetail(await run());
      toast.success(success);
      return true;
    } catch (error) {
      setServerErrors(fieldErrors(error, (c) => c));
      toast.error(errorText(error));
      return false;
    } finally {
      setBusy(null);
    }
  };

  const base = `v1/admin/ai/prompt/${encodeURIComponent(key)}`;
  const saveDraft = () => act('draft', () => api.put<AiPromptDetail>(`${base}/draft`, { text }), t.ai.draftSaved);

  const insert = (name: string) => {
    const el = editorRef.current;
    const token = `{{${name}}}`;
    if (!el) return setText((v) => v + token);
    const start = el.selectionStart ?? text.length;
    const end = el.selectionEnd ?? start;
    setText(text.slice(0, start) + token + text.slice(end));
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(start + token.length, start + token.length);
    });
  };

  const tryIt = async () => {
    try {
      await trial.run({
        type: 'prompt',
        key,
        text,
        input: detail.sampleInput !== null ? input : undefined,
        imageUrls: detail.imagesRequired > 0 ? images.filter(Boolean) : undefined,
      });
    } catch (error) {
      setServerErrors(fieldErrors(error, (c) => c));
      toast.error(errorText(error));
    }
  };

  const historyColumns: Column<AiPromptVersion>[] = [
    {
      key: 'version',
      header: t.ai.version,
      render: (v) => (
        <span className="flex items-center gap-2 font-mono text-xs">
          v{v.version}
          {v.live && <Badge tone="green">{t.ai.live}</Badge>}
        </span>
      ),
    },
    {
      key: 'action',
      header: t.ai.action,
      render: (v) => (
        <span className="text-xs">
          {t.ai.actions[v.action]}
          {v.sourceVersion !== null && <span className="text-muted"> · {v.sourceVersion === 0 ? t.ai.codeDefault : fmt(t.ai.fromVersion, { version: v.sourceVersion })}</span>}
          {v.text === null && v.sourceVersion === null && <span className="text-muted"> · {t.ai.codeDefault}</span>}
        </span>
      ),
    },
    { key: 'author', header: t.ai.author, render: (v) => <span className="text-xs">{v.author ?? t.ai.system}</span> },
    { key: 'at', header: t.ai.date, render: (v) => <span className="whitespace-nowrap text-xs text-muted">{dateTime(v.at)}</span> },
    { key: 'note', header: t.ai.note, render: (v) => <span className="text-xs text-muted">{v.note ?? '—'}</span> },
    {
      key: 'actions',
      header: '',
      className: 'text-right',
      render: (v) => (
        <div className="flex justify-end gap-1">
          <IconButton icon="eye" label={t.ai.showText} onClick={() => setExpanded(expanded === v.version ? null : v.version)} />
          {!v.live && (
            <Button size="sm" variant="secondary" icon="refresh" onClick={() => setRollback(v.version)}>
              {t.ai.rollback}
            </Button>
          )}
        </div>
      ),
    },
  ];
  const expandedVersion = detail.history.find((v) => v.version === expanded);

  return (
    <div className="space-y-4">
      <FallbackBanner prompt={detail.summary} onAcknowledged={setDetail} />

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
        <Card
          title={t.ai.text}
          subtitle={
            hasDraft
              ? fmt(t.ai.draftBy, { email: detail.summary.draftUpdatedBy ?? '—', date: dateTime(detail.summary.draftUpdatedAt) })
              : detail.summary.overridden
                ? fmt(t.ai.overridden, { version: detail.summary.publishedVersion })
                : t.ai.codeDefault
          }
          actions={
            <>
              {dirty && <Badge tone="amber">{t.ai.unsaved}</Badge>}
              <Button size="sm" variant="ghost" onClick={() => setText(detail.defaultText)}>
                {t.ai.loadDefault}
              </Button>
              {detail.publishedText !== null && (
                <Button size="sm" variant="ghost" onClick={() => setText(detail.publishedText!)}>
                  {t.ai.loadPublished}
                </Button>
              )}
            </>
          }
        >
          {hasDraft && detail.draftBaseVersion !== null && detail.draftBaseVersion !== detail.summary.publishedVersion && (
            <p className="mb-3 flex items-center gap-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
              <Icon name="alert" className="h-4 w-4" />
              {t.ai.draftBaseChanged}
            </p>
          )}
          <PromptEditor id="prompt-text" value={text} onChange={setText} detail={detail} invalid={!!textError || placeholderErrors.length > 0} editorRef={editorRef} />
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-muted">
            <span>{detail.maxLength !== null ? fmt(t.ai.chars, { count: number(text.length), max: number(detail.maxLength) }) : number(text.length)}</span>
            {detail.variables.length > 0 && <span>{fmt(t.ai.staticPrefix, { count: number(staticPrefix(text)), default: number(detail.defaultStaticPrefix) })}</span>}
          </div>
          {textError && <p className="mt-2 text-xs text-red-600">{textError}</p>}
          {placeholderErrors.map(([k, code]) => (
            <p key={k} className="mt-1 text-xs text-red-600">
              <span className="font-mono">{`{{${k.slice('placeholders.'.length)}}}`}</span> — {code === 'missing' ? t.ai.placeholderMissing : t.ai.placeholderUnknown}
            </p>
          ))}
          {warnings.includes('cache_prefix_shorter') && (
            <p role="status" className="mt-3 flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
              <Icon name="alert" className="mt-0.5 h-4 w-4 shrink-0" />
              {t.ai.cacheWarning}
            </p>
          )}
          <div className="mt-4 flex flex-wrap gap-2">
            <Button icon="check" loading={busy === 'draft'} disabled={!dirty || Object.keys(validatePrompt(detail, text)).length > 0} onClick={() => void saveDraft()}>
              {t.ai.saveDraft}
            </Button>
            <Button variant="secondary" icon="upload" disabled={!hasDraft || dirty} onClick={() => setPublishOpen(true)}>
              {t.ai.publish}
            </Button>
            {hasDraft && (
              <Button variant="ghost" icon="trash" loading={busy === 'discard'} onClick={() => void act('discard', () => api.del<AiPromptDetail>(`${base}/draft`), t.ai.draftDiscarded)}>
                {t.ai.discardDraft}
              </Button>
            )}
          </div>
          {!hasDraft && !dirty && <p className="mt-2 text-xs text-muted">{t.ai.publishNeedsDraft}</p>}
        </Card>

        <div className="space-y-4">
          <Card title={t.ai.variables}>
            {detail.variables.length === 0 ? (
              <p className="text-sm text-muted">{t.ai.noVariables}</p>
            ) : (
              <ul className="space-y-3">
                {detail.variables.map((v) => (
                  <li key={v.name} className="text-sm">
                    <div className="flex items-center justify-between gap-2">
                      <span className={v.required ? 'rounded bg-brand-100 px-1 font-mono text-[13px] text-brand-800' : 'rounded bg-sky-100 px-1 font-mono text-[13px] text-sky-800'}>{`{{${v.name}}}`}</span>
                      <Button size="sm" variant="ghost" icon="plus" onClick={() => insert(v.name)}>
                        {t.ai.insert}
                      </Button>
                    </div>
                    <p className="mt-1 text-xs text-muted">
                      {v.required ? t.ai.requiredVar : t.ai.optionalVar} · {v.description}
                    </p>
                    <p className="mt-0.5 text-xs text-muted">
                      {t.ai.sample}: <span className="font-mono">{JSON.stringify(v.sample)}</span>
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card title={t.ai.about}>
            <dl className="space-y-2 text-xs">
              <div className="flex justify-between gap-3">
                <dt className="text-muted">{t.ai.featureLabel}</dt>
                <dd>{t.ai.features[detail.summary.feature as keyof typeof t.ai.features] ?? detail.summary.feature}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-muted">{t.ai.operation}</dt>
                <dd className="font-mono">{detail.summary.operation}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-muted">{t.ai.position}</dt>
                <dd>{t.ai.kinds[detail.summary.kind]}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-muted">{t.ai.live}</dt>
                <dd>{detail.summary.overridden ? `v${detail.summary.publishedVersion}` : t.ai.codeDefault}</dd>
              </div>
            </dl>
            <p className="mt-3 text-xs text-muted">{t.ai.cacheExplainer}</p>
          </Card>
        </div>
      </div>

      <Card
        title={t.ai.diff}
        actions={
          <Tabs
            label={t.ai.diff}
            value={diffTab}
            onChange={setDiffTab}
            tabs={[
              { id: 'published', label: t.ai.diffPublished },
              { id: 'default', label: t.ai.diffDefault },
            ]}
          />
        }
      >
        <DiffView before={diffTab === 'published' ? live : detail.defaultText} after={text} empty={t.ai.noDiff} />
      </Card>

      {detail.trialMode !== 'none' && (
        <Card title={t.ai.tryTitle} subtitle={detail.trialMode === 'chat' ? t.ai.tryHint : t.ai.tryPreviewHint}>
          <div className="space-y-4">
            {detail.sampleInput !== null && (
              <Field
                label={t.ai.sampleInput}
                htmlFor="sample-input"
                error={serverErrors.input ? fieldError(serverErrors.input) : null}
                hint={
                  <button type="button" className="text-brand-700 hover:underline" onClick={() => setInput(detail.sampleInput ?? '')}>
                    {t.ai.resetSample}
                  </button>
                }
              >
                <Textarea id="sample-input" className="min-h-[160px] font-mono text-xs" spellCheck={false} value={input} onChange={(e) => setInput(e.target.value)} />
              </Field>
            )}
            {detail.trialMode === 'chat' && detail.imagesRequired > 0 && (
              <Field label={t.ai.images} hint={fmt(t.ai.imagesHint, { count: detail.imagesRequired })} error={serverErrors.imageUrls ? fieldError(serverErrors.imageUrls) : null}>
                <div className="space-y-2">
                  {images.map((url, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <Input
                        className="flex-1 font-mono text-xs"
                        placeholder={t.ai.imageUrlPlaceholder}
                        aria-label={`${t.ai.images} ${i + 1}`}
                        value={url}
                        onChange={(e) => setImages((list) => list.map((u, j) => (j === i ? e.target.value : u)))}
                      />
                      {can('image.upload') && (
                        <UploadButton purpose="library" size="sm" onUploaded={(next) => setImages((list) => list.map((u, j) => (j === i ? next : u)))} />
                      )}
                    </div>
                  ))}
                  {detail.summary.operation === 'item_match' && images.length < 6 && (
                    <Button size="sm" variant="ghost" icon="plus" onClick={() => setImages((list) => [...list, ''])}>
                      {t.ai.addCandidate}
                    </Button>
                  )}
                </div>
              </Field>
            )}
            {detail.trialMode === 'preview' && (
              <div>
                <p className="mb-1 text-xs font-medium text-muted">{t.ai.previewLabel}</p>
                <pre className="max-h-60 overflow-auto rounded-lg border border-line bg-stone-50 p-3 font-mono text-[13px] leading-6 whitespace-pre-wrap text-ink">
                  {renderTemplate(text, Object.fromEntries(detail.variables.map((v) => [v.name, v.sample])))}
                </pre>
              </div>
            )}
            {detail.trialMode === 'chat' && (
              <div className="flex items-center gap-3">
                <Button icon="sparkle" loading={trial.busy} disabled={Object.keys(validatePrompt(detail, text)).length > 0 || (detail.imagesRequired > 0 && images.filter(Boolean).length < detail.imagesRequired)} onClick={() => void tryIt()}>
                  {t.ai.tryButton}
                </Button>
                <span className="text-xs text-muted">{t.ai.tryCost}</span>
              </div>
            )}
            {trial.trial && <TrialResult trial={trial.trial} />}
          </div>
        </Card>
      )}

      {detail.schema && <SchemaCard schema={detail.schema} title={t.ai.schemaTitle} />}

      <Card
        title={t.ai.history}
        padded={false}
        actions={
          detail.summary.overridden && (
            <Button size="sm" variant="secondary" icon="refresh" onClick={() => setRollback(0)}>
              {t.ai.rollbackDefault}
            </Button>
          )
        }
      >
        <DataTable columns={historyColumns} rows={detail.history} rowKey={(v) => String(v.version)} empty={<p className="px-5 py-6 text-sm text-muted">{t.ai.noHistory}</p>} />
        {expandedVersion && (
          <div className="border-t border-line p-5">
            <p className="mb-2 text-xs font-medium text-muted">v{expandedVersion.version}</p>
            <DiffView before={live} after={expandedVersion.text ?? detail.defaultText} empty={t.ai.sameAsLive} />
          </div>
        )}
      </Card>

      <ConfirmModal
        open={publishOpen}
        title={fmt(t.ai.publishTitle, { key })}
        confirmLabel={t.ai.publish}
        busy={busy === 'publish'}
        onClose={() => setPublishOpen(false)}
        onConfirm={async () => {
          const ok = await act(
            'publish',
            () => api.post<AiPromptDetail>(`${base}/publish`, { note: note.trim() || null, expectedVersion: detail.summary.publishedVersion }),
            t.ai.published,
          );
          if (ok) {
            setPublishOpen(false);
            setNote('');
          }
        }}
      >
        <p className="mb-3">{fmt(t.ai.publishHint, { version: detail.summary.publishedVersion + 1 })}</p>
        <Field label={t.ai.publishNote} htmlFor="publish-note">
          <Textarea id="publish-note" maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
      </ConfirmModal>

      <ConfirmModal
        open={rollback !== null}
        title={rollback === 0 ? t.ai.rollbackDefaultTitle : fmt(t.ai.rollbackTitle, { version: rollback ?? 0 })}
        confirmLabel={t.ai.rollback}
        busy={busy === 'rollback'}
        onClose={() => setRollback(null)}
        onConfirm={async () => {
          const ok = await act('rollback', () => api.post<AiPromptDetail>(`${base}/rollback`, { version: rollback, note: rollbackNote.trim() || null }), t.ai.rolledBack);
          if (ok) {
            setRollback(null);
            setRollbackNote('');
          }
        }}
      >
        <p className="mb-3">{t.ai.rollbackHint}</p>
        <Field label={t.ai.note} htmlFor="rollback-note">
          <Textarea id="rollback-note" maxLength={500} value={rollbackNote} onChange={(e) => setRollbackNote(e.target.value)} />
        </Field>
      </ConfirmModal>
    </div>
  );
}

function PromptEditInner() {
  const { t, href } = useI18n();
  const key = useSearchParams().get('key') ?? '';
  const prompt = useAsync(() => api.get<AiPromptDetail>(`v1/admin/ai/prompt/${encodeURIComponent(key)}`), [key]);

  return (
    <div>
      <PageHeader
        title={<span className="font-mono text-xl">{key}</span>}
        subtitle={prompt.data?.summary.description}
        actions={
          <LinkButton href={href('/ai/prompts/')} variant="secondary" icon="chevronLeft">
            {t.common.back}
          </LinkButton>
        }
      />
      {prompt.error ? (
        <Card>
          <ErrorState error={prompt.error} onRetry={prompt.reload} />
        </Card>
      ) : !prompt.data ? (
        <div className="space-y-4">
          <Skeleton className="h-[480px] w-full rounded-xl" />
          <Skeleton className="h-48 w-full rounded-xl" />
        </div>
      ) : prompt.data.summary.editable ? (
        <Editor detail={prompt.data} setDetail={prompt.setData} />
      ) : (
        <SchemaCard schema={prompt.data.defaultText} title={t.ai.schemaTitle} />
      )}
    </div>
  );
}

export default function AiPromptEditPage() {
  return (
    <RequirePermission permission="ai.manage">
      <PromptEditInner />
    </RequirePermission>
  );
}
