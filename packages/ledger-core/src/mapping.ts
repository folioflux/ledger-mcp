import type { DecimalSeparator } from './amounts.js';
import { DECIMAL_SEPARATORS } from './amounts.js';
import type { CsvDelimiter } from './csv.js';
import { CSV_DELIMITERS } from './csv.js';
import type { DateFormat } from './dates.js';
import { DATE_FORMATS } from './dates.js';
import type { CsvEncoding } from './encoding.js';
import { CSV_ENCODINGS } from './encoding.js';
import { LedgerError } from './errors.js';
import { canonicalJson, sha256Hex } from './hash.js';

/** Logical fields that a CSV column can be mapped to. */
export type ColumnRole =
  | 'date'
  | 'amount'
  | 'debit'
  | 'credit'
  | 'currency'
  | 'description'
  | 'merchant'
  | 'category'
  | 'account';

export const COLUMN_ROLES: readonly ColumnRole[] = [
  'date',
  'amount',
  'debit',
  'credit',
  'currency',
  'description',
  'merchant',
  'category',
  'account',
];

/** Header name for each role, or null when the file has no such column. */
export type ColumnMap = Record<ColumnRole, string | null>;

/**
 * How to read one CSV layout. Saved as JSON so a person can review and edit it.
 * Columns are referenced by their exact header text.
 */
export interface Mapping {
  version: 1;
  /** SHA-256 of the header row (see headerSha256); identifies the CSV layout. */
  header_sha256: string;
  delimiter: CsvDelimiter;
  encoding: CsvEncoding;
  date_format: DateFormat;
  decimal_separator: DecimalSeparator;
  columns: ColumnMap;
  /** Currency used when there is no currency column or the cell is empty. */
  default_currency: string | null;
  /** Account label used when there is no account column or the cell is empty. */
  default_account: string | null;
}

/** Fields a caller may override on top of a detected or saved mapping. */
export interface MappingOverrides {
  delimiter?: CsvDelimiter | undefined;
  encoding?: CsvEncoding | undefined;
  date_format?: DateFormat | undefined;
  decimal_separator?: DecimalSeparator | undefined;
  columns?: Partial<ColumnMap> | undefined;
  default_currency?: string | null | undefined;
  default_account?: string | null | undefined;
}

/** Normalizes a header for matching: lower case, letters and digits only, single spaces. */
export function normalizeHeader(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/** SHA-256 identifying a header row: the hash of the canonical JSON of the trimmed names. */
export function headerSha256(header: readonly string[]): string {
  return sha256Hex(canonicalJson(header.map((name) => name.trim())));
}

/**
 * Header names recognised for each role, in tiers. A column matching an earlier
 * tier wins over later tiers; two columns in the same best tier are ambiguous.
 * Matching is exact after normalizeHeader.
 */
export const HEADER_SYNONYMS: Record<ColumnRole, readonly (readonly string[])[]> = {
  date: [
    ['date', 'transaction date', 'booking date', 'posting date', 'posted date', 'txn date'],
    ['value date', 'posted', 'completed date', 'started date'],
  ],
  amount: [
    ['amount', 'transaction amount'],
    ['value', 'sum', 'total'],
  ],
  debit: [['debit', 'debit amount', 'money out', 'paid out', 'withdrawal', 'withdrawals', 'out']],
  credit: [['credit', 'credit amount', 'money in', 'paid in', 'deposit', 'deposits', 'in']],
  currency: [['currency', 'currency code', 'ccy', 'curr']],
  description: [
    ['description', 'details', 'transaction details', 'narrative', 'memo'],
    ['reference', 'text', 'notes', 'transaction description'],
  ],
  merchant: [['merchant', 'payee', 'counterparty', 'merchant name', 'beneficiary'], ['name']],
  category: [
    ['category', 'categories'],
    ['type of spend', 'tag'],
  ],
  account: [
    ['account', 'account name', 'account label'],
    ['card', 'card name'],
  ],
};

/** A problem that stops a file from being read until the mapping is fixed. */
export interface MappingIssue {
  field:
    ColumnRole | 'delimiter' | 'date_format' | 'decimal_separator' | 'default_currency' | 'header';
  message: string;
  /** Possible values the user can choose from, when there are any. */
  candidates: string[];
}

export interface ColumnDetection {
  columns: ColumnMap;
  issues: MappingIssue[];
}

/** Maps header names to roles with the plain synonym tables above. Never guesses between ties. */
export function detectColumns(header: readonly string[]): ColumnDetection {
  const normalized = header.map(normalizeHeader);
  const columns = Object.fromEntries(COLUMN_ROLES.map((role) => [role, null])) as ColumnMap;
  const issues: MappingIssue[] = [];
  const used = new Set<number>();

  for (const role of COLUMN_ROLES) {
    for (const tier of HEADER_SYNONYMS[role]) {
      const hits = normalized
        .map((name, index) => ({ name, index }))
        .filter(({ name, index }) => !used.has(index) && tier.includes(name));
      if (hits.length === 1) {
        const hit = hits[0];
        if (hit) {
          columns[role] = header[hit.index] ?? null;
          used.add(hit.index);
        }
        break;
      }
      if (hits.length > 1) {
        issues.push({
          field: role,
          message: `Several columns could be the ${role} column. Choose one.`,
          candidates: hits.map(({ index }) => header[index] ?? ''),
        });
        break;
      }
    }
  }

  if (columns.date === null && !issues.some((issue) => issue.field === 'date')) {
    issues.push({
      field: 'date',
      message: 'No date column was recognised. Choose the column that holds the transaction date.',
      candidates: [...header],
    });
  }
  const hasAmount = columns.amount !== null;
  const hasPair = columns.debit !== null && columns.credit !== null;
  const amountIssue = issues.some((issue) => ['amount', 'debit', 'credit'].includes(issue.field));
  if (!hasAmount && !hasPair && !amountIssue) {
    issues.push({
      field: 'amount',
      message:
        'No amount column was recognised. Choose a signed amount column, or a debit and a credit column.',
      candidates: [...header],
    });
  }
  if (hasAmount) {
    // A signed amount column takes precedence over a debit/credit pair.
    columns.debit = null;
    columns.credit = null;
  }
  return { columns, issues };
}

/** Stable identifier of a mapping: "map_" + 16 hex chars of the SHA-256 of its canonical JSON. */
export function mappingId(mapping: Mapping): string {
  return `map_${sha256Hex(canonicalJson({ ...mapping })).slice(0, 16)}`;
}

const CURRENCY_CODE = /^[A-Z]{3}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function nullableString(value: unknown, field: string): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') {
    throw new LedgerError('INVALID_MAPPING', `Mapping field "${field}" must be a string or null.`);
  }
  return value;
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], field: string): T {
  if (typeof value === 'string' && (allowed as readonly string[]).includes(value))
    return value as T;
  throw new LedgerError(
    'INVALID_MAPPING',
    `Mapping field "${field}" must be one of: ${allowed.map((item) => JSON.stringify(item)).join(', ')}.`,
  );
}

/** Validates an untrusted object (for example a saved mapping file) and returns a Mapping. */
export function parseMapping(value: unknown): Mapping {
  if (!isRecord(value))
    throw new LedgerError('INVALID_MAPPING', 'A mapping must be a JSON object.');
  if (value['version'] !== 1) {
    throw new LedgerError('INVALID_MAPPING', 'Unsupported mapping version; expected 1.');
  }
  const headerHash = value['header_sha256'];
  if (typeof headerHash !== 'string' || !/^[0-9a-f]{64}$/.test(headerHash)) {
    throw new LedgerError(
      'INVALID_MAPPING',
      'Mapping field "header_sha256" must be a SHA-256 hex string.',
    );
  }
  const rawColumns = value['columns'];
  if (!isRecord(rawColumns)) {
    throw new LedgerError('INVALID_MAPPING', 'Mapping field "columns" must be an object.');
  }
  for (const key of Object.keys(rawColumns)) {
    if (!(COLUMN_ROLES as readonly string[]).includes(key)) {
      throw new LedgerError('INVALID_MAPPING', `Unknown column role "${key}" in mapping.`);
    }
  }
  const columns = Object.fromEntries(
    COLUMN_ROLES.map((role) => [role, nullableString(rawColumns[role], `columns.${role}`)]),
  ) as ColumnMap;
  const mapping: Mapping = {
    version: 1,
    header_sha256: headerHash,
    delimiter: oneOf(value['delimiter'], CSV_DELIMITERS, 'delimiter'),
    encoding: oneOf(value['encoding'], CSV_ENCODINGS, 'encoding'),
    date_format: oneOf(value['date_format'], DATE_FORMATS, 'date_format'),
    decimal_separator: oneOf(value['decimal_separator'], DECIMAL_SEPARATORS, 'decimal_separator'),
    columns,
    default_currency: nullableString(value['default_currency'], 'default_currency'),
    default_account: nullableString(value['default_account'], 'default_account'),
  };
  if (mapping.default_currency !== null && !CURRENCY_CODE.test(mapping.default_currency)) {
    throw new LedgerError(
      'INVALID_MAPPING',
      'Mapping field "default_currency" must be a three-letter upper-case ISO 4217 code.',
    );
  }
  return mapping;
}

/**
 * Checks that a mapping fits a header: every referenced column exists exactly
 * once, there is a date and an amount source, and a currency source.
 * Returns the problems found (empty when the mapping is usable).
 */
export function checkMappingAgainstHeader(
  mapping: Mapping,
  header: readonly string[],
): MappingIssue[] {
  const issues: MappingIssue[] = [];
  const trimmed = header.map((name) => name.trim());
  for (const role of COLUMN_ROLES) {
    const column = mapping.columns[role];
    if (column === null) continue;
    const count = trimmed.filter((name) => name === column.trim()).length;
    if (count === 0) {
      issues.push({
        field: role,
        message: `Column "${column}" mapped as ${role} is not in the header.`,
        candidates: [...header],
      });
    } else if (count > 1) {
      issues.push({
        field: role,
        message: `Column "${column}" appears more than once in the header, so it cannot be mapped by name.`,
        candidates: [],
      });
    }
  }
  if (mapping.columns.date === null) {
    issues.push({ field: 'date', message: 'A date column is required.', candidates: [...header] });
  }
  const hasAmount = mapping.columns.amount !== null;
  const hasPair = mapping.columns.debit !== null && mapping.columns.credit !== null;
  if (hasAmount === hasPair) {
    issues.push({
      field: 'amount',
      message: hasAmount
        ? 'Map either an amount column or a debit and credit pair, not both.'
        : 'Map an amount column, or both a debit and a credit column.',
      candidates: [...header],
    });
  }
  if (mapping.columns.currency === null && mapping.default_currency === null) {
    issues.push({
      field: 'default_currency',
      message:
        'The file has no currency column. Set default_currency to the three-letter ISO 4217 code of the account.',
      candidates: [],
    });
  }
  return issues;
}
