import type { Transaction } from '@folioflux/transaction-schema';
import { isIsoDate } from './dates.js';
import { Decimal, formatAmount, sumAmounts } from './decimal.js';
import { LedgerError } from './errors.js';
import { canonicalJson, compareStrings, toBase64Url } from './hash.js';
import type { ImportedRow, RowError } from './import.js';
import type { Ledger, LedgerFileSummary } from './ledger.js';

/** Filters shared by every query tool. All fields are optional. */
export interface TransactionFilter {
  /** First date to include, YYYY-MM-DD (inclusive). */
  from?: string | undefined;
  /** Last date to include, YYYY-MM-DD (inclusive). */
  to?: string | undefined;
  /** Case-insensitive substring matched against description, merchant and category. */
  text?: string | undefined;
  /** "in" keeps amounts above zero, "out" keeps amounts below zero. */
  sign?: 'in' | 'out' | 'all' | undefined;
  /** Exact category value from the CSV. */
  category?: string | undefined;
  /** Exact account label. */
  account?: string | undefined;
  /** Three-letter currency code. */
  currency?: string | undefined;
}

/** Rows cited for a figure, grouped by file. Row numbers are ascending. */
export interface SourceRef {
  file: string;
  rows: number[];
}

/** Context included in every result so an answer can be checked and reproduced. */
export interface ResultContext {
  input_hash: string;
  files: LedgerFileSummary[];
  /** Rows that could not be read and are therefore not counted (first 50). */
  row_errors: RowError[];
  row_error_count: number;
}

const MAX_ROW_ERRORS = 50;

function context(ledger: Ledger): ResultContext {
  return {
    input_hash: ledger.input_hash,
    files: ledger.files,
    row_errors: ledger.row_errors.slice(0, MAX_ROW_ERRORS),
    row_error_count: ledger.row_errors.length,
  };
}

/** Validates a filter and returns it with only the fields that are set, in a fixed order. */
export function normalizeFilter(filter: TransactionFilter): TransactionFilter {
  const out: TransactionFilter = {};
  for (const key of ['from', 'to'] as const) {
    const value = filter[key];
    if (value !== undefined) {
      if (!isIsoDate(value)) {
        throw new LedgerError('INVALID_ARGUMENT', `"${key}" must be a date in YYYY-MM-DD format.`);
      }
      out[key] = value;
    }
  }
  if (out.from !== undefined && out.to !== undefined && out.from > out.to) {
    throw new LedgerError('INVALID_ARGUMENT', '"from" must not be after "to".');
  }
  if (filter.text !== undefined && filter.text !== '') out.text = filter.text;
  if (filter.sign !== undefined && filter.sign !== 'all') out.sign = filter.sign;
  if (filter.category !== undefined) out.category = filter.category;
  if (filter.account !== undefined) out.account = filter.account;
  if (filter.currency !== undefined) {
    const currency = filter.currency.toUpperCase();
    if (!/^[A-Z]{3}$/.test(currency)) {
      throw new LedgerError('INVALID_ARGUMENT', '"currency" must be a three-letter ISO 4217 code.');
    }
    out.currency = currency;
  }
  return out;
}

function signOf(amount: string): 1 | 0 | -1 {
  const value = new Decimal(amount);
  return value.isZero() ? 0 : value.isNegative() ? -1 : 1;
}

function matches(transaction: Transaction, filter: TransactionFilter): boolean {
  if (filter.from !== undefined && transaction.date < filter.from) return false;
  if (filter.to !== undefined && transaction.date > filter.to) return false;
  if (filter.currency !== undefined && transaction.currency !== filter.currency) return false;
  if (filter.category !== undefined && transaction.category !== filter.category) return false;
  if (filter.account !== undefined && transaction.account !== filter.account) return false;
  if (filter.sign === 'in' && signOf(transaction.amount) !== 1) return false;
  if (filter.sign === 'out' && signOf(transaction.amount) !== -1) return false;
  if (filter.text !== undefined) {
    const needle = filter.text.toLowerCase();
    const haystack = [
      transaction.description,
      transaction.merchant ?? '',
      transaction.category ?? '',
    ]
      .join('\n')
      .toLowerCase();
    if (!haystack.includes(needle)) return false;
  }
  return true;
}

/** Rows that pass a (normalized) filter, in ledger order. */
export function selectRows(ledger: Ledger, filter: TransactionFilter): ImportedRow[] {
  return ledger.rows.filter((row) => matches(row.transaction, filter));
}

/** Groups row references by file, files and rows ascending. */
export function toSources(rows: readonly ImportedRow[]): SourceRef[] {
  const byFile = new Map<string, number[]>();
  for (const { transaction } of rows) {
    const list = byFile.get(transaction.provenance.source_file) ?? [];
    list.push(transaction.provenance.row_number);
    byFile.set(transaction.provenance.source_file, list);
  }
  return [...byFile.entries()]
    .sort(([a], [b]) => compareStrings(a, b))
    .map(([file, list]) => ({ file, rows: [...list].sort((x, y) => x - y) }));
}

// ---------------------------------------------------------------------------
// Figure references
// ---------------------------------------------------------------------------

export type GroupBy = 'month' | 'category';

/** Identifies one number in a result so that explain can recompute it. */
export type FigureSpec =
  | {
      tool: 'totals';
      query: TransactionFilter & { group_by: GroupBy };
      figure: { key: string | null; currency: string; field: 'total' };
    }
  | {
      tool: 'cashflow';
      query: TransactionFilter;
      figure: { month: string; currency: string; field: 'inflow' | 'outflow' | 'net' };
    };

/** Encodes a figure spec as an opaque, URL-safe reference string. */
export function encodeRef(spec: FigureSpec): string {
  return `fig1_${toBase64Url(canonicalJson({ ...spec, query: { ...spec.query }, figure: { ...spec.figure } }))}`;
}

/** Rows behind one figure. Shared by the query tools and explain so they always agree. */
export function figureRows(ledger: Ledger, spec: FigureSpec): ImportedRow[] {
  if (spec.tool === 'totals') {
    const { group_by, ...filter } = spec.query;
    return selectRows(ledger, normalizeFilter(filter)).filter(
      ({ transaction }) =>
        transaction.currency === spec.figure.currency &&
        groupKey(transaction, group_by) === spec.figure.key,
    );
  }
  return selectRows(ledger, normalizeFilter(spec.query)).filter(({ transaction }) => {
    if (transaction.currency !== spec.figure.currency) return false;
    if (transaction.date.slice(0, 7) !== spec.figure.month) return false;
    const sign = signOf(transaction.amount);
    if (spec.figure.field === 'inflow') return sign === 1;
    if (spec.figure.field === 'outflow') return sign === -1;
    return true;
  });
}

function groupKey(transaction: Transaction, groupBy: GroupBy): string | null {
  return groupBy === 'month' ? transaction.date.slice(0, 7) : transaction.category;
}

// ---------------------------------------------------------------------------
// list_transactions
// ---------------------------------------------------------------------------

export interface ListOptions extends TransactionFilter {
  limit?: number | undefined;
  offset?: number | undefined;
}

export interface ListResult extends ResultContext {
  query: TransactionFilter & { limit: number; offset: number };
  total_count: number;
  next_offset: number | null;
  transactions: Transaction[];
}

export const LIST_DEFAULT_LIMIT = 50;
export const LIST_MAX_LIMIT = 500;

/** Lists transactions in (date, source_file, row_number) order with offset pagination. */
export function listTransactions(ledger: Ledger, options: ListOptions = {}): ListResult {
  const { limit = LIST_DEFAULT_LIMIT, offset = 0, ...rest } = options;
  if (!Number.isInteger(limit) || limit < 1 || limit > LIST_MAX_LIMIT) {
    throw new LedgerError(
      'INVALID_ARGUMENT',
      `"limit" must be an integer from 1 to ${LIST_MAX_LIMIT}.`,
    );
  }
  if (!Number.isInteger(offset) || offset < 0) {
    throw new LedgerError('INVALID_ARGUMENT', '"offset" must be a non-negative integer.');
  }
  const filter = normalizeFilter(rest);
  const rows = selectRows(ledger, filter);
  const page = rows.slice(offset, offset + limit);
  const { input_hash, ...ctx } = context(ledger);
  return {
    input_hash,
    query: { ...filter, limit, offset },
    total_count: rows.length,
    next_offset: offset + page.length < rows.length ? offset + page.length : null,
    transactions: page.map((row) => row.transaction),
    ...ctx,
  };
}

// ---------------------------------------------------------------------------
// totals
// ---------------------------------------------------------------------------

export interface TotalsOptions extends TransactionFilter {
  group_by: GroupBy;
}

export interface TotalsGroup {
  /** Month (YYYY-MM) or category value; null for rows without a category. */
  key: string | null;
  currency: string;
  total: string;
  count: number;
  sources: SourceRef[];
  /** Pass to explain to see every row and the arithmetic behind total. */
  ref: string;
}

export interface TotalsResult extends ResultContext {
  query: TransactionFilter & { group_by: GroupBy };
  groups: TotalsGroup[];
}

function compareKeys(a: string | null, b: string | null): number {
  if (a === b) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return compareStrings(a, b);
}

/**
 * Sums amounts per (key, currency). Currencies are never added together.
 * Groups are ordered by key (null last), then currency.
 */
export function totals(ledger: Ledger, options: TotalsOptions): TotalsResult {
  const { group_by, ...rest } = options;
  const requested: string = group_by;
  if (requested !== 'month' && requested !== 'category') {
    throw new LedgerError('INVALID_ARGUMENT', '"group_by" must be "month" or "category".');
  }
  const filter = normalizeFilter(rest);
  const query = { ...filter, group_by };
  const buckets = new Map<string, { key: string | null; currency: string }>();
  for (const { transaction } of selectRows(ledger, filter)) {
    const key = groupKey(transaction, group_by);
    buckets.set(canonicalJson([key, transaction.currency]), {
      key,
      currency: transaction.currency,
    });
  }
  const groups = [...buckets.values()]
    .sort((a, b) => compareKeys(a.key, b.key) || compareStrings(a.currency, b.currency))
    .map(({ key, currency }): TotalsGroup => {
      const spec: FigureSpec = { tool: 'totals', query, figure: { key, currency, field: 'total' } };
      const rows = figureRows(ledger, spec);
      return {
        key,
        currency,
        total: sumAmounts(rows.map((row) => row.transaction.amount)),
        count: rows.length,
        sources: toSources(rows),
        ref: encodeRef(spec),
      };
    });
  const { input_hash, ...ctx } = context(ledger);
  return { input_hash, query, groups, ...ctx };
}

// ---------------------------------------------------------------------------
// cashflow
// ---------------------------------------------------------------------------

export type CashflowOptions = Omit<TransactionFilter, 'sign'>;

export interface CashflowMonth {
  month: string;
  currency: string;
  /** Sum of amounts above zero. */
  inflow: string;
  /** Sum of amounts below zero (a negative number or zero). */
  outflow: string;
  /** inflow + outflow. */
  net: string;
  count: number;
  sources: SourceRef[];
  refs: { inflow: string; outflow: string; net: string };
}

export interface CashflowResult extends ResultContext {
  query: TransactionFilter;
  months: CashflowMonth[];
}

/** Monthly money in, money out and net per currency, ordered by month then currency. */
export function cashflow(ledger: Ledger, options: CashflowOptions = {}): CashflowResult {
  const { sign, ...rest } = options as TransactionFilter;
  if (sign !== undefined && sign !== 'all') {
    throw new LedgerError('INVALID_ARGUMENT', 'cashflow does not take a "sign" filter.');
  }
  const query = normalizeFilter(rest);
  const buckets = new Map<string, { month: string; currency: string }>();
  for (const { transaction } of selectRows(ledger, query)) {
    const month = transaction.date.slice(0, 7);
    buckets.set(`${month}\u0000${transaction.currency}`, { month, currency: transaction.currency });
  }
  const months = [...buckets.values()]
    .sort((a, b) => compareStrings(a.month, b.month) || compareStrings(a.currency, b.currency))
    .map(({ month, currency }): CashflowMonth => {
      const spec = (field: 'inflow' | 'outflow' | 'net'): FigureSpec => ({
        tool: 'cashflow',
        query,
        figure: { month, currency, field },
      });
      const all = figureRows(ledger, spec('net'));
      const sum = (field: 'inflow' | 'outflow'): string =>
        sumAmounts(figureRows(ledger, spec(field)).map((row) => row.transaction.amount));
      const inflow = sum('inflow');
      const outflow = sum('outflow');
      return {
        month,
        currency,
        inflow,
        outflow,
        net: formatAmount(new Decimal(inflow).plus(outflow)),
        count: all.length,
        sources: toSources(all),
        refs: {
          inflow: encodeRef(spec('inflow')),
          outflow: encodeRef(spec('outflow')),
          net: encodeRef(spec('net')),
        },
      };
    });
  const { input_hash, ...ctx } = context(ledger);
  return { input_hash, query, months, ...ctx };
}
