'use client';

import { useRef, useState } from 'react';
import { RequirePermission } from '@/components/Shell';
import { Icon } from '@/components/icons';
import { Badge, Button, Card, DataTable, EmptyState, KpiTile, PageHeader, useToast, type Column } from '@/components/ui';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { downloadText, parseCsv, toCsv } from '@/lib/text';
import { CATALOG_SEGMENTS, PRICE_BANDS, PRODUCT_CATEGORIES, type BulkResult, type BulkRow } from '@/lib/types';

const MAX_ROWS = 200;
const COLUMNS = [
  'id', 'brandId', 'name_tr', 'name_en', 'description_tr', 'description_en', 'category', 'colors', 'sizes', 'priceMinor',
  'priceBand', 'images', 'affiliateUrl', 'affiliateSource', 'retired', 'segment',
] as const;
const REQUIRED = ['id', 'brandId', 'name_tr', 'category', 'priceMinor', 'priceBand'];

interface Parsed {
  index: number;
  body: Record<string, unknown>;
  problems: string[];
}

const list = (v: string | undefined) => (v ? v.split('|').map((s) => s.trim()).filter(Boolean) : []);

function rowToProduct(row: Record<string, string>, index: number): Parsed {
  const problems: string[] = [];
  const text = (prefix: string) => {
    const map: Record<string, string> = {};
    for (const [k, v] of Object.entries(row)) if (k.startsWith(`${prefix}_`) && v.trim()) map[k.slice(prefix.length + 1)] = v.trim();
    return Object.keys(map).length ? map : null;
  };
  const price = Number(row.priceMinor);
  if (!/^[a-z0-9][a-z0-9-]{1,62}$/.test(row.id ?? '')) problems.push('id_invalid');
  if (!row.brandId) problems.push('brand_id_invalid');
  if (!row.name_tr?.trim()) problems.push('name_invalid');
  if (!(PRODUCT_CATEGORIES as readonly string[]).includes(row.category ?? '')) problems.push('category_invalid');
  if (!Number.isInteger(price) || price <= 0) problems.push('price_invalid');
  if (!(PRICE_BANDS as string[]).includes(row.priceBand ?? '')) problems.push('price_band_invalid');
  const images = list(row.images);
  if (images.some((u) => !u.startsWith('https://'))) problems.push('images_invalid');
  // Optional column: empty = women (older files without the column keep working).
  const segment = (row.segment ?? '').trim().toLowerCase();
  if (segment && !(CATALOG_SEGMENTS as string[]).includes(segment)) problems.push('segment_invalid');
  return {
    index,
    problems,
    body: {
      id: row.id,
      brandId: row.brandId,
      name: text('name'),
      description: text('description'),
      category: row.category,
      colors: list(row.colors).map((c) => c.toLowerCase()),
      sizes: list(row.sizes),
      priceMinor: Number.isFinite(price) ? price : 0,
      currency: 'TRY',
      priceBand: row.priceBand,
      images,
      affiliateUrl: row.affiliateUrl?.trim() || null,
      affiliateSource: row.affiliateSource?.trim() || null,
      retired: ['true', '1', 'yes', 'evet'].includes((row.retired ?? '').trim().toLowerCase()),
      segment: segment || null,
    },
  };
}

function ImportInner() {
  const { t, fmt, fieldError, errorText } = useI18n();
  const toast = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [rows, setRows] = useState<Parsed[]>([]);
  const [fileError, setFileError] = useState<string | null>(null);
  const [result, setResult] = useState<BulkResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [drag, setDrag] = useState(false);
  const [check, setCheck] = useState<BulkResult | null>(null);
  const [checking, setChecking] = useState(false);

  // Validation preview: the bulk endpoint with dryRun=true answers per row without writing anything.
  const dryRun = async (parsed: Parsed[]) => {
    setCheck(null);
    if (!parsed.length) return;
    setChecking(true);
    try {
      setCheck(await api.post<BulkResult>('v1/admin/product/bulk', { products: parsed.map((r) => r.body) }, { query: { dryRun: true } }));
    } catch (error) {
      toast.error(errorText(error));
    } finally {
      setChecking(false);
    }
  };

  const load = async (file: File) => {
    setResult(null);
    setFileError(null);
    setFileName(file.name);
    const table = parseCsv(await file.text());
    const header = (table[0] ?? []).map((h) => h.trim());
    const missing = REQUIRED.filter((c) => !header.includes(c));
    if (missing.length) {
      setRows([]);
      setFileError(fmt(t.importCsv.missingColumns, { columns: missing.join(', ') }));
      return;
    }
    const data = table.slice(1);
    if (!data.length) {
      setRows([]);
      setFileError(t.importCsv.empty);
      return;
    }
    if (data.length > MAX_ROWS) setFileError(fmt(t.importCsv.tooMany, { max: MAX_ROWS }));
    const parsed = data.slice(0, MAX_ROWS).map((cells, i) => rowToProduct(Object.fromEntries(header.map((h, j) => [h, cells[j] ?? ''])), i));
    setRows(parsed);
    void dryRun(parsed);
  };

  const send = async () => {
    setBusy(true);
    try {
      const res = await api.post<BulkResult>('v1/admin/product/bulk', { products: rows.map((r) => r.body) });
      setResult(res);
      if (res.failed === 0) toast.success(t.common.saved);
      else toast.info(`${t.importCsv.failed}: ${res.failed}`);
    } catch (error) {
      toast.error(errorText(error));
    } finally {
      setBusy(false);
    }
  };

  const problemText = (codes: string[]) => codes.map(fieldError).join(' ');
  const errorsOf = (row: BulkRow) =>
    row.errors ? Object.entries(row.errors).map(([field, codes]) => `${field}: ${codes.map(fieldError).join(', ')}`) : [];

  const downloadReport = () => {
    if (!result) return;
    const lines: unknown[][] = [['row', 'id', 'outcome', 'errors']];
    for (const r of result.rows.filter((x) => x.outcome !== 'created' && x.outcome !== 'updated'))
      lines.push([r.index + 2, r.id, r.outcome, Object.entries(r.errors ?? {}).map(([f, c]) => `${f}: ${c.join('|')}`).join('; ')]);
    downloadText(`import-errors-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.csv`, toCsv(lines));
  };

  const downloadTemplate = () =>
    downloadText(
      'products-template.csv',
      toCsv([
        [...COLUMNS],
        ['hs-white-shirt', 'gap', 'Beyaz Poplin Gömlek', 'White Poplin Shirt', '', '', 'shirt', 'white', 'S|M|L', '129990', 'highStreet', 'https://example.com/1.jpg', 'https://shop.example/p', '', 'false', 'unisex'],
      ]),
    );

  const previewCols: Column<Parsed>[] = [
    { key: 'row', header: t.importCsv.row, render: (r) => <span className="text-muted tabular-nums">{r.index + 2}</span> },
    { key: 'id', header: t.common.id, render: (r) => <span className="font-mono text-xs">{String(r.body.id ?? '')}</span> },
    { key: 'brand', header: t.products.brand, render: (r) => String(r.body.brandId ?? '') },
    { key: 'name', header: t.common.name, render: (r) => (r.body.name as Record<string, string> | null)?.tr ?? '—' },
    { key: 'cat', header: t.products.category, render: (r) => String(r.body.category ?? '') },
    { key: 'price', header: t.products.price, render: (r) => <span className="tabular-nums">{String(r.body.priceMinor)}</span> },
    {
      key: 'problems',
      header: t.importCsv.problems,
      render: (r) => {
        const server = check?.rows.find((x) => x.index === r.index);
        if (server && server.outcome !== 'created' && server.outcome !== 'updated')
          return (
            <span className="text-xs text-red-700">
              {t.importCsv.outcomes[server.outcome]} {errorsOf(server).join(' · ')}
            </span>
          );
        if (r.problems.length) return <span className="text-xs text-red-700">{problemText(r.problems)}</span>;
        if (server) return <Badge tone={server.outcome === 'created' ? 'green' : 'blue'}>{t.importCsv.outcomes[server.outcome]}</Badge>;
        return <Icon name="check" className="h-4 w-4 text-emerald-600" />;
      },
    },
  ];

  const resultCols: Column<BulkRow>[] = [
    { key: 'row', header: t.importCsv.row, sortValue: (r) => r.index, render: (r) => <span className="text-muted tabular-nums">{r.index + 2}</span> },
    { key: 'id', header: t.common.id, render: (r) => <span className="font-mono text-xs">{r.id}</span> },
    {
      key: 'outcome',
      header: t.importCsv.outcome,
      sortValue: (r) => r.outcome,
      render: (r) => (
        <Badge tone={r.outcome === 'created' ? 'green' : r.outcome === 'updated' ? 'blue' : 'red'}>{t.importCsv.outcomes[r.outcome] ?? r.outcome}</Badge>
      ),
    },
    { key: 'errors', header: t.importCsv.problems, render: (r) => <span className="text-xs text-red-700">{errorsOf(r).join(' · ')}</span> },
  ];

  const clientProblems = check ? check.failed : rows.filter((r) => r.problems.length).length;

  return (
    <div>
      <PageHeader
        title={t.importCsv.title}
        subtitle={t.importCsv.subtitle}
        actions={
          <Button variant="secondary" icon="download" onClick={downloadTemplate}>
            {t.importCsv.template}
          </Button>
        }
      />
      <Card>
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDrag(true);
          }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDrag(false);
            const file = e.dataTransfer.files[0];
            if (file) void load(file);
          }}
          className={`flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed px-6 py-10 text-center ${drag ? 'border-brand-500 bg-brand-50' : 'border-line'}`}
        >
          <span className="flex h-12 w-12 items-center justify-center rounded-full bg-brand-50 text-brand-600">
            <Icon name="file" />
          </span>
          <input
            ref={input}
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            aria-label={t.importCsv.pick}
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (file) void load(file);
            }}
          />
          <div>
            <Button icon="upload" onClick={() => input.current?.click()}>
              {t.importCsv.pick}
            </Button>
            <p className="mt-2 text-xs text-muted">{t.importCsv.drop}</p>
          </div>
          {fileName && <p className="text-sm font-medium">{fileName}</p>}
        </div>
        <details className="mt-4 text-sm text-muted">
          <summary className="cursor-pointer font-medium text-ink">{t.importCsv.columns}</summary>
          <p className="mt-2 font-mono text-xs">{t.importCsv.columnsHelp}</p>
        </details>
        {fileError && (
          <p className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
            {fileError}
          </p>
        )}
      </Card>

      {rows.length > 0 && !result && (
        <Card
          className="mt-4"
          title={t.importCsv.preview}
          subtitle={`${fmt(t.importCsv.rowsFound, { count: rows.length })}${clientProblems ? ` ${fmt(t.importCsv.clientErrors, { count: clientProblems })}` : ''} ${checking ? t.importCsv.checking : check ? t.importCsv.dryRunNote : ''}`}
          actions={
            <Button icon="upload" loading={busy} disabled={checking} onClick={() => void send()}>
              {busy ? t.importCsv.sending : fmt(t.importCsv.send, { count: rows.length })}
            </Button>
          }
          padded={false}
        >
          <DataTable columns={previewCols} rows={rows} rowKey={(r) => String(r.index)} />
        </Card>
      )}

      {result && (
        <div className="mt-4 space-y-4">
          <div className="grid gap-4 sm:grid-cols-3">
            <KpiTile icon="plus" tone="green" label={t.importCsv.created} value={result.created} />
            <KpiTile icon="refresh" tone="blue" label={t.importCsv.updated} value={result.updated} />
            <KpiTile icon="alert" tone="red" label={t.importCsv.failed} value={result.failed} />
          </div>
          <Card
            title={t.importCsv.result}
            padded={false}
            actions={
              result.failed > 0 ? (
                <Button variant="secondary" size="sm" icon="download" onClick={downloadReport}>
                  {t.importCsv.errorReport}
                </Button>
              ) : undefined
            }
          >
            <DataTable columns={resultCols} rows={result.rows} rowKey={(r) => `${r.index}`} empty={<EmptyState title={t.common.noResults} />} />
          </Card>
        </div>
      )}
    </div>
  );
}

export default function ImportPage() {
  return (
    <RequirePermission permission="catalog.manage">
      <ImportInner />
    </RequirePermission>
  );
}
