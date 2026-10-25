import { Decimal, sumAmounts } from './decimal.js';
import { LedgerError } from './errors.js';
import { compareStrings, fromBase64Url } from './hash.js';
import type { ImportedRow } from './import.js';
import type { Ledger } from './ledger.js';
import { compareTransactions } from './ledger.js';
import type { Mapping } from './mapping.js';
import type { FigureSpec, SourceRef, TransactionFilter } from './query.js';
import { cashflow, figureRows, normalizeFilter, totals } from './query.js';

export interface ExplainedRow {
  file: string;
  row_number: number;
  date: string;
  amount: string;
  currency: string;
  description: string;
  merchant: string | null;
  category: string | null;
  account: string | null;
  /** The original cells of the CSV row, keyed by header name. */
  raw: Record<string, string>;
}

export interface ExplainedFile {
  file: string;
  source_sha256: string;
  mapping_id: string;
  mapping: Mapping;
}

export interface ExplainResult {
  input_hash: string;
  /** True/false when an expected input hash was given; null otherwise. */
  input_hash_matches: boolean | null;
  /** The figure being explained, or null when explaining a list of rows. */
  figure: {
    tool: FigureSpec['tool'];
    query: FigureSpec['query'];
    group: Record<string, string | null>;
    field: string;
    currency: string;
    value: string;
  } | null;
  /** Sum of the listed rows per currency, recomputed from the rows themselves. */
  sums: { currency: string; sum: string; count: number }[];
  /** For a figure: whether the recomputed sum equals the reported value. */
  sum_matches_figure: boolean | null;
  rows: ExplainedRow[];
  files: ExplainedFile[];
}

export interface ExplainOptions {
  /** A ref returned by totals or cashflow. */
  ref?: string | undefined;
  /** Explicit rows to show, grouped by file. */
  sources?: readonly SourceRef[] | undefined;
  /** Input hash from the original result; compared with the current one. */
  input_hash?: string | undefined;
}

const MAX_SOURCE_ROWS = 5000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Decodes and validates a figure reference. */
export function decodeRef(ref: string): FigureSpec {
  const invalid = (): LedgerError =>
    new LedgerError(
      'INVALID_REF',
      'Not a valid figure ref. Copy the "ref" value from a totals or cashflow result.',
    );
  if (!ref.startsWith('fig1_')) throw invalid();
  const json = fromBase64Url(ref.slice('fig1_'.length));
  if (json === null) throw invalid();
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch {
    throw invalid();
  }
  if (!isRecord(value) || !isRecord(value['query']) || !isRecord(value['figure'])) throw invalid();
  const query = value['query'];
  const figure = value['figure'];
  const filter: TransactionFilter = {};
  for (const key of ['from', 'to', 'text', 'sign', 'category', 'account', 'currency'] as const) {
    const item = query[key];
    if (item !== undefined) {
      if (typeof item !== 'string') throw invalid();
      (filter as Record<string, string>)[key] = item;
    }
  }
  let normalized: TransactionFilter;
  try {
    normalized = normalizeFilter(filter);
  } catch {
    throw invalid();
  }
  const currency = figure['currency'];
  if (typeof currency !== 'string') throw invalid();

  if (value['tool'] === 'totals') {
    const groupBy = query['group_by'];
    const key = figure['key'];
    if ((groupBy !== 'month' && groupBy !== 'category') || figure['field'] !== 'total')
      throw invalid();
    if (key !== null && typeof key !== 'string') throw invalid();
    return {
      tool: 'totals',
      query: { ...normalized, group_by: groupBy },
      figure: { key, currency, field: 'total' },
    };
  }
  if (value['tool'] === 'cashflow') {
    const month = figure['month'];
    const field = figure['field'];
    if (
      typeof month !== 'string' ||
      (field !== 'inflow' && field !== 'outflow' && field !== 'net')
    ) {
      throw invalid();
    }
    if (normalized.sign !== undefined) throw invalid();
    return { tool: 'cashflow', query: normalized, figure: { month, currency, field } };
  }
  throw invalid();
}

function reportedValue(ledger: Ledger, spec: FigureSpec): string | null {
  if (spec.tool === 'totals') {
    const group = totals(ledger, spec.query).groups.find(
      (g) => g.key === spec.figure.key && g.currency === spec.figure.currency,
    );
    return group?.total ?? null;
  }
  const month = cashflow(ledger, spec.query).months.find(
    (m) => m.month === spec.figure.month && m.currency === spec.figure.currency,
  );
  return month ? month[spec.figure.field] : null;
}

function explainRows(
  ledger: Ledger,
  rows: readonly ImportedRow[],
): Pick<ExplainResult, 'rows' | 'files' | 'sums'> {
  const sorted = [...rows].sort((a, b) => compareTransactions(a.transaction, b.transaction));
  const byCurrency = new Map<string, string[]>();
  for (const { transaction } of sorted) {
    const list = byCurrency.get(transaction.currency) ?? [];
    list.push(transaction.amount);
    byCurrency.set(transaction.currency, list);
  }
  const fileNames = [...new Set(sorted.map((row) => row.transaction.provenance.source_file))].sort(
    compareStrings,
  );
  return {
    sums: [...byCurrency.entries()]
      .sort(([a], [b]) => compareStrings(a, b))
      .map(([currency, amounts]) => ({
        currency,
        sum: sumAmounts(amounts),
        count: amounts.length,
      })),
    rows: sorted.map(({ transaction, raw }) => ({
      file: transaction.provenance.source_file,
      row_number: transaction.provenance.row_number,
      date: transaction.date,
      amount: transaction.amount,
      currency: transaction.currency,
      description: transaction.description,
      merchant: transaction.merchant,
      category: transaction.category,
      account: transaction.account,
      raw,
    })),
    files: fileNames.map((file) => {
      const mapping = ledger.mappings.get(file);
      const summary = ledger.files.find((f) => f.file === file);
      if (!mapping || !summary?.source_sha256 || !summary.mapping_id) {
        throw new LedgerError('NOT_FOUND', `No mapping is loaded for ${file}.`);
      }
      return {
        file,
        source_sha256: summary.source_sha256,
        mapping_id: summary.mapping_id,
        mapping,
      };
    }),
  };
}

/**
 * Shows the exact rows behind a figure (by ref) or behind a list of row
 * references, with the original CSV cells, the mapping used, the file hashes
 * and the recomputed sum.
 */
export function explain(ledger: Ledger, options: ExplainOptions): ExplainResult {
  const hasRef = options.ref !== undefined;
  const hasSources = options.sources !== undefined;
  if (hasRef === hasSources) {
    throw new LedgerError('INVALID_ARGUMENT', 'Pass exactly one of "ref" or "sources".');
  }
  const input_hash_matches =
    options.input_hash === undefined ? null : options.input_hash === ledger.input_hash;

  if (options.ref !== undefined) {
    const spec = decodeRef(options.ref);
    const rows = figureRows(ledger, spec);
    const value = reportedValue(ledger, spec);
    if (value === null) {
      throw new LedgerError(
        'NOT_FOUND',
        'That figure does not exist in the current data. The CSV files or mappings may have changed since the ref was produced.',
      );
    }
    const detail = explainRows(ledger, rows);
    const recomputed = detail.sums.find((s) => s.currency === spec.figure.currency)?.sum ?? '0.00';
    const { field, currency, ...group } = spec.figure;
    return {
      input_hash: ledger.input_hash,
      input_hash_matches,
      figure: { tool: spec.tool, query: spec.query, group, field, currency, value },
      sums: detail.sums,
      sum_matches_figure: new Decimal(recomputed).equals(value),
      rows: detail.rows,
      files: detail.files,
    };
  }

  const wanted = options.sources ?? [];
  const total = wanted.reduce((count, source) => count + source.rows.length, 0);
  if (total === 0 || total > MAX_SOURCE_ROWS) {
    throw new LedgerError(
      'INVALID_ARGUMENT',
      `"sources" must list between 1 and ${MAX_SOURCE_ROWS} rows.`,
    );
  }
  const index = new Map<string, ImportedRow>();
  for (const row of ledger.rows) {
    index.set(
      `${row.transaction.provenance.source_file}\u0000${row.transaction.provenance.row_number}`,
      row,
    );
  }
  const picked = new Map<string, ImportedRow>();
  for (const source of wanted) {
    for (const rowNumber of source.rows) {
      const key = `${source.file}\u0000${rowNumber}`;
      const row = index.get(key);
      if (!row) {
        throw new LedgerError(
          'NOT_FOUND',
          `Row ${rowNumber} of ${source.file} is not a loaded transaction (unknown file, unreadable row, or a file that needs a mapping).`,
        );
      }
      picked.set(key, row);
    }
  }
  const detail = explainRows(ledger, [...picked.values()]);
  return {
    input_hash: ledger.input_hash,
    input_hash_matches,
    figure: null,
    sums: detail.sums,
    sum_matches_figure: null,
    rows: detail.rows,
    files: detail.files,
  };
}
