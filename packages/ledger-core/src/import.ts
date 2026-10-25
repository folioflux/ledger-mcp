import type { Transaction } from '@folioflux/transaction-schema';
import { detectDecimalSeparator, parseAmount } from './amounts.js';
import type { CsvDelimiter, CsvRecord } from './csv.js';
import { detectDelimiter, isBlankRecord, parseCsv } from './csv.js';
import { DATE_FORMATS, matchingDateFormats, parseDate } from './dates.js';
import { Decimal, formatAmount } from './decimal.js';
import type { CsvEncoding } from './encoding.js';
import { decodeCsvBytes } from './encoding.js';
import { LedgerError } from './errors.js';
import { sha256Hex } from './hash.js';
import type { ColumnMap, ColumnRole, Mapping, MappingIssue, MappingOverrides } from './mapping.js';
import {
  checkMappingAgainstHeader,
  COLUMN_ROLES,
  detectColumns,
  headerSha256,
  mappingId,
} from './mapping.js';

/** A CSV file handed to ledger-core: a name (relative to the exports folder) and its bytes. */
export interface CsvInput {
  name: string;
  bytes: Uint8Array;
}

/** What can be learned about a file before any mapping is chosen. */
export interface CsvHead {
  file: string;
  source_sha256: string;
  encoding: CsvEncoding;
  bom: boolean;
  delimiter: CsvDelimiter | null;
  header: string[];
  header_sha256: string | null;
}

/** A data row that could not be read with the chosen mapping. */
export interface RowError {
  file: string;
  row_number: number;
  column: string | null;
  value: string | null;
  message: string;
}

/** A transaction together with the original cells it was read from. */
export interface ImportedRow {
  transaction: Transaction;
  /** Original cell text keyed by header name. */
  raw: Record<string, string>;
}

/** A mapping that may still have undecided fields. */
export type DraftMapping = Omit<Mapping, 'date_format' | 'decimal_separator' | 'delimiter'> & {
  delimiter: Mapping['delimiter'] | null;
  date_format: Mapping['date_format'] | null;
  decimal_separator: Mapping['decimal_separator'] | null;
};

interface ImportBase {
  file: string;
  source_sha256: string;
  encoding: CsvEncoding;
  bom: boolean;
  header: string[];
  header_sha256: string;
  /** Where the starting mapping came from before overrides were applied. */
  mapping_source: 'saved' | 'detected';
  overrides_applied: boolean;
  /** Number of non-blank data records after the header. */
  data_row_count: number;
  /** Up to three raw data records keyed by header name, to help choose a mapping. */
  sample: Record<string, string>[];
}

export interface ImportOk extends ImportBase {
  status: 'ok';
  mapping: Mapping;
  mapping_id: string;
  issues: [];
  rows: ImportedRow[];
  row_errors: RowError[];
}

export interface ImportNeedsMapping extends ImportBase {
  status: 'needs_mapping';
  mapping: DraftMapping;
  mapping_id: null;
  issues: MappingIssue[];
  rows: [];
  row_errors: [];
}

export type ImportResult = ImportOk | ImportNeedsMapping;

export interface ImportOptions {
  /** A previously saved mapping. Used only when its header_sha256 matches the file. */
  saved?: Mapping | null | undefined;
  /** Explicit choices that win over the saved or detected mapping. */
  overrides?: MappingOverrides | undefined;
}

interface Parsed {
  head: CsvHead;
  records: CsvRecord[];
  headerIndex: number;
}

function parseInput(
  input: CsvInput,
  encoding: CsvEncoding | undefined,
  delimiter: CsvDelimiter | undefined,
): Parsed {
  const source_sha256 = sha256Hex(input.bytes);
  const decoded = decodeCsvBytes(input.bytes, encoding);
  const chosen = delimiter ?? detectDelimiter(decoded.text);
  const records = parseCsv(decoded.text, chosen ?? ',');
  const headerIndex = records.findIndex((record) => !isBlankRecord(record.cells));
  if (headerIndex === -1) {
    throw new LedgerError('CSV_EMPTY', `${input.name} has no header row.`);
  }
  const header = (records[headerIndex]?.cells ?? []).map((cell) => cell.trim());
  return {
    head: {
      file: input.name,
      source_sha256,
      encoding: decoded.encoding,
      bom: decoded.bom,
      delimiter: chosen,
      header,
      header_sha256: chosen === null ? null : headerSha256(header),
    },
    records,
    headerIndex,
  };
}

/** Reads only what is needed to look up a saved mapping: encoding, delimiter and header. */
export function readCsvHead(
  input: CsvInput,
  options: { encoding?: CsvEncoding | undefined; delimiter?: CsvDelimiter | undefined } = {},
): CsvHead {
  return parseInput(input, options.encoding, options.delimiter).head;
}

function columnKey(header: readonly string[], index: number): string {
  const name = header[index] ?? '';
  return name === '' ? `column_${index + 1}` : name;
}

function columnValues(
  records: readonly CsvRecord[],
  header: readonly string[],
  column: string | null,
): string[] {
  if (column === null) return [];
  const index = header.indexOf(column.trim());
  if (index === -1) return [];
  return records.map((record) => record.cells[index] ?? '');
}

/**
 * Reads a CSV export into transactions. Decides encoding, delimiter, columns,
 * date format and decimal separator from (in order of precedence) explicit
 * overrides, a saved mapping for the same header, and plain detection rules.
 * When anything is ambiguous it returns status "needs_mapping" with the open
 * questions instead of guessing. Pure: no I/O, no clock, no locale.
 */
export function importCsv(input: CsvInput, options: ImportOptions = {}): ImportResult {
  const overrides = options.overrides ?? {};
  const savedCandidate = options.saved ?? null;
  const parsed = parseInput(
    input,
    overrides.encoding ?? savedCandidate?.encoding,
    overrides.delimiter ?? savedCandidate?.delimiter,
  );
  const { head, records, headerIndex } = parsed;
  const header = head.header;
  const header_sha256 = head.header_sha256 ?? headerSha256(header);
  const saved = savedCandidate?.header_sha256 === header_sha256 ? savedCandidate : null;

  const dataRecords = records
    .slice(headerIndex + 1)
    .map((record, offset) => ({ record, rowNumber: offset + 1 }))
    .filter(({ record }) => !isBlankRecord(record.cells));
  const toRaw = (record: CsvRecord): Record<string, string> =>
    Object.fromEntries(
      header.map((_, index) => [columnKey(header, index), record.cells[index] ?? '']),
    );

  const issues: MappingIssue[] = [];
  const overrideColumns = overrides.columns ?? {};
  let columns: ColumnMap;
  if (saved) {
    columns = { ...saved.columns };
  } else {
    const detection = detectColumns(header);
    columns = detection.columns;
    for (const issue of detection.issues) {
      if (!(issue.field in overrideColumns)) issues.push(issue);
    }
  }
  for (const role of COLUMN_ROLES) {
    const value = overrideColumns[role];
    if (value !== undefined) columns[role] = value;
  }
  if (overrideColumns.amount !== undefined && overrideColumns.amount !== null) {
    if (overrideColumns.debit === undefined) columns.debit = null;
    if (overrideColumns.credit === undefined) columns.credit = null;
  }

  if (head.delimiter === null) {
    issues.push({
      field: 'delimiter',
      message: 'Could not detect the delimiter. Set delimiter to one of the candidates.',
      candidates: [',', ';', '\t', '|'],
    });
  }

  const dataOnly = dataRecords.map(({ record }) => record);
  let date_format = overrides.date_format ?? saved?.date_format ?? null;
  if (date_format === null && columns.date !== null) {
    const values = columnValues(dataOnly, header, columns.date);
    const formats = matchingDateFormats(values);
    if (formats.length === 1) {
      date_format = formats[0] ?? null;
    } else if (formats.length > 1) {
      issues.push({
        field: 'date_format',
        message: `Dates in "${columns.date}" fit more than one format (for example "${values.find((v) => v.trim() !== '') ?? ''}"). Choose the date format.`,
        candidates: formats,
      });
    } else if (values.some((value) => value.trim() !== '')) {
      // No format fits every row. If exactly one format fits any row at all,
      // there is nothing to choose: use it and report the other rows as errors.
      const partial = DATE_FORMATS.filter((format) =>
        values.some((value) => parseDate(value, format) !== null),
      );
      if (partial.length === 1) {
        date_format = partial[0] ?? null;
      } else {
        const examples = values.filter((value) => value.trim() !== '').slice(0, 3);
        issues.push({
          field: 'date_format',
          message: `Dates in "${columns.date}" do not all match one supported format (for example ${examples.map((e) => `"${e}"`).join(', ')}). Choose the date format; rows that do not match are reported as row errors.`,
          candidates: partial.length > 0 ? partial : [...DATE_FORMATS],
        });
      }
    }
  }

  let decimal_separator = overrides.decimal_separator ?? saved?.decimal_separator ?? null;
  if (decimal_separator === null) {
    const values = [columns.amount, columns.debit, columns.credit].flatMap((column) =>
      columnValues(dataOnly, header, column),
    );
    const detection = detectDecimalSeparator(values);
    if (detection.status === 'ok') {
      decimal_separator = detection.separator;
    } else {
      issues.push({
        field: 'decimal_separator',
        message:
          detection.status === 'ambiguous'
            ? `Amounts such as ${detection.examples.map((e) => `"${e}"`).join(', ')} could use either "." or "," as the decimal separator. Choose one.`
            : `Amounts mix "." and "," as decimal separators (for example ${detection.examples.map((e) => `"${e}"`).join(', ')}). Choose one.`,
        candidates: ['.', ','],
      });
    }
  }

  const default_currency =
    overrides.default_currency !== undefined
      ? overrides.default_currency
      : (saved?.default_currency ?? null);
  const default_account =
    overrides.default_account !== undefined
      ? overrides.default_account
      : (saved?.default_account ?? null);
  if (default_currency !== null && !/^[A-Z]{3}$/.test(default_currency)) {
    issues.push({
      field: 'default_currency',
      message: `"${default_currency}" is not a three-letter upper-case ISO 4217 code.`,
      candidates: [],
    });
  }

  const draft: DraftMapping = {
    version: 1,
    header_sha256,
    delimiter: head.delimiter,
    encoding: head.encoding,
    date_format,
    decimal_separator,
    columns,
    default_currency,
    default_account,
  };

  if (draft.delimiter !== null && date_format !== null && decimal_separator !== null) {
    const candidate: Mapping = {
      ...draft,
      delimiter: draft.delimiter,
      date_format,
      decimal_separator,
    };
    const flagged = new Set(issues.map((issue) => issue.field));
    for (const issue of checkMappingAgainstHeader(candidate, header)) {
      if (!flagged.has(issue.field)) issues.push(issue);
    }
  } else {
    const flagged = new Set(issues.map((issue) => issue.field));
    const partial: Mapping = {
      ...draft,
      delimiter: draft.delimiter ?? ',',
      date_format: date_format ?? 'YYYY-MM-DD',
      decimal_separator: decimal_separator ?? '.',
    };
    for (const issue of checkMappingAgainstHeader(partial, header)) {
      if (!flagged.has(issue.field)) issues.push(issue);
    }
  }

  const base: ImportBase = {
    file: head.file,
    source_sha256: head.source_sha256,
    encoding: head.encoding,
    bom: head.bom,
    header,
    header_sha256,
    mapping_source: saved ? 'saved' : 'detected',
    overrides_applied: Object.values(overrides).some((value) => value !== undefined),
    data_row_count: dataRecords.length,
    sample: dataOnly.slice(0, 3).map(toRaw),
  };

  if (
    issues.length > 0 ||
    draft.delimiter === null ||
    date_format === null ||
    decimal_separator === null
  ) {
    return {
      ...base,
      status: 'needs_mapping',
      mapping: draft,
      mapping_id: null,
      issues,
      rows: [],
      row_errors: [],
    };
  }

  const mapping: Mapping = { ...draft, delimiter: draft.delimiter, date_format, decimal_separator };
  const id = mappingId(mapping);
  const rows: ImportedRow[] = [];
  const row_errors: RowError[] = [];
  const index = (column: string | null): number =>
    column === null ? -1 : header.indexOf(column.trim());
  const at: Record<ColumnRole, number> = Object.fromEntries(
    COLUMN_ROLES.map((role) => [role, index(mapping.columns[role])]),
  ) as Record<ColumnRole, number>;

  for (const { record, rowNumber } of dataRecords) {
    const fail = (column: string | null, value: string | null, message: string): void => {
      row_errors.push({ file: head.file, row_number: rowNumber, column, value, message });
    };
    const cells = record.cells;
    if (cells.length < header.length) {
      fail(null, null, `Expected ${header.length} cells, found ${cells.length}.`);
      continue;
    }
    if (cells.slice(header.length).some((cell) => cell.trim() !== '')) {
      fail(null, null, `Expected ${header.length} cells, found ${cells.length}.`);
      continue;
    }
    const cell = (role: ColumnRole): string | null => {
      const position = at[role];
      return position === -1 ? null : (cells[position] ?? '');
    };

    const rawDate = cell('date') ?? '';
    const date = parseDate(rawDate, mapping.date_format);
    if (date === null) {
      fail(mapping.columns.date, rawDate, `Not a valid ${mapping.date_format} date.`);
      continue;
    }

    let amount: Decimal;
    if (mapping.columns.amount !== null) {
      const rawAmount = cell('amount') ?? '';
      const parsedAmount = parseAmount(rawAmount, mapping.decimal_separator);
      if (parsedAmount === null || parsedAmount === undefined) {
        fail(
          mapping.columns.amount,
          rawAmount,
          parsedAmount === null ? 'Amount is empty.' : 'Not a valid amount.',
        );
        continue;
      }
      amount = parsedAmount;
    } else {
      const rawDebit = cell('debit') ?? '';
      const rawCredit = cell('credit') ?? '';
      const debit = parseAmount(rawDebit, mapping.decimal_separator);
      const credit = parseAmount(rawCredit, mapping.decimal_separator);
      if (debit === undefined) {
        fail(mapping.columns.debit, rawDebit, 'Not a valid amount.');
        continue;
      }
      if (credit === undefined) {
        fail(mapping.columns.credit, rawCredit, 'Not a valid amount.');
        continue;
      }
      if (debit === null && credit === null) {
        fail(null, null, 'Both the debit and the credit cell are empty.');
        continue;
      }
      // Debit and credit cells are read as magnitudes: credit adds, debit subtracts.
      amount = (credit?.abs() ?? new Decimal(0)).minus(debit?.abs() ?? new Decimal(0));
    }

    const rawCurrency = (cell('currency') ?? '').trim().toUpperCase();
    const currency = rawCurrency === '' ? mapping.default_currency : rawCurrency;
    if (currency === null) {
      fail(
        mapping.columns.currency,
        cell('currency'),
        'Currency is empty and the mapping has no default_currency.',
      );
      continue;
    }
    if (!/^[A-Z]{3}$/.test(currency)) {
      fail(
        mapping.columns.currency,
        cell('currency'),
        'Currency is not a three-letter ISO 4217 code.',
      );
      continue;
    }

    const text = (role: ColumnRole): string | null => {
      const value = (cell(role) ?? '').trim();
      return value === '' ? null : value;
    };
    const transaction: Transaction = {
      id: `tx_${sha256Hex(`${head.source_sha256}:${rowNumber}`).slice(0, 24)}`,
      date,
      amount: formatAmount(amount),
      currency,
      description: text('description') ?? '',
      merchant: text('merchant'),
      category: text('category'),
      account: text('account') ?? mapping.default_account,
      provenance: {
        source_file: head.file,
        source_sha256: head.source_sha256,
        row_number: rowNumber,
        mapping_id: id,
      },
    };
    rows.push({ transaction, raw: toRaw(record) });
  }

  return { ...base, status: 'ok', mapping, mapping_id: id, issues: [], rows, row_errors };
}
