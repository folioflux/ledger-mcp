import type { Transaction } from '@folioflux/transaction-schema';
import { canonicalJson, compareStrings, sha256Hex } from './hash.js';
import type { ImportedRow, ImportResult, RowError } from './import.js';
import type { Mapping } from './mapping.js';

/** A file that could not be read at all (for example malformed quoting). */
export interface FileFailure {
  file: string;
  /** SHA-256 of the bytes, when the bytes could be read. */
  source_sha256: string | null;
  message: string;
}

/** Per-file status reported with every query result. */
export interface LedgerFileSummary {
  file: string;
  source_sha256: string | null;
  status: 'ok' | 'needs_mapping' | 'error';
  mapping_id: string | null;
  transactions: number;
  row_errors: number;
  /** Why the file was not used (needs_mapping or error). */
  message: string | null;
}

/** An immutable, sorted set of transactions read from one or more CSV files. */
export interface Ledger {
  /** SHA-256 over every file name, file hash and mapping id. Same inputs, same hash. */
  input_hash: string;
  files: LedgerFileSummary[];
  /** Rows sorted by (date, source_file, row_number). */
  rows: ImportedRow[];
  row_errors: RowError[];
  mappings: ReadonlyMap<string, Mapping>;
}

/** The deterministic sort order used everywhere: date, then file name, then row number. */
export function compareTransactions(a: Transaction, b: Transaction): number {
  return (
    compareStrings(a.date, b.date) ||
    compareStrings(a.provenance.source_file, b.provenance.source_file) ||
    a.provenance.row_number - b.provenance.row_number
  );
}

/**
 * Builds a ledger from import results. The order of the inputs does not matter:
 * files, rows and errors are sorted, so the same files always give the same
 * ledger and the same input hash.
 */
export function createLedger(
  results: readonly ImportResult[],
  failures: readonly FileFailure[] = [],
): Ledger {
  const names = [...results.map((r) => r.file), ...failures.map((f) => f.file)];
  const duplicate = names.find((name, index) => names.indexOf(name) !== index);
  if (duplicate !== undefined) {
    throw new TypeError(`createLedger: file "${duplicate}" was given more than once`);
  }

  const files: LedgerFileSummary[] = [
    ...results.map((result): LedgerFileSummary => ({
      file: result.file,
      source_sha256: result.source_sha256,
      status: result.status,
      mapping_id: result.mapping_id,
      transactions: result.rows.length,
      row_errors: result.row_errors.length,
      message:
        result.status === 'ok'
          ? null
          : `Needs a mapping: ${result.issues.map((issue) => issue.message).join(' ')} Call import_csv for this file.`,
    })),
    ...failures.map((failure): LedgerFileSummary => ({
      file: failure.file,
      source_sha256: failure.source_sha256,
      status: 'error',
      mapping_id: null,
      transactions: 0,
      row_errors: 0,
      message: failure.message,
    })),
  ].sort((a, b) => compareStrings(a.file, b.file));

  const rows = results
    .flatMap((result) => result.rows)
    .sort((a, b) => compareTransactions(a.transaction, b.transaction));
  const row_errors = results
    .flatMap((result) => result.row_errors)
    .sort((a, b) => compareStrings(a.file, b.file) || a.row_number - b.row_number);
  const mappings = new Map<string, Mapping>();
  for (const result of results) {
    if (result.status === 'ok') mappings.set(result.file, result.mapping);
  }

  const input_hash = sha256Hex(
    canonicalJson({
      v: 1,
      files: files.map((file) => ({
        file: file.file,
        source_sha256: file.source_sha256,
        mapping_id: file.mapping_id,
      })),
    }),
  );

  return { input_hash, files, rows, row_errors, mappings };
}
