export type { Transaction, Provenance } from '@folioflux/transaction-schema';

export { LedgerError } from './errors.js';
export type { LedgerErrorCode } from './errors.js';

export { Decimal, formatAmount, sumAmounts } from './decimal.js';
export { canonicalJson, compareStrings, sha256Hex } from './hash.js';
export type { JsonValue } from './hash.js';

export { decodeCsvBytes, CSV_ENCODINGS } from './encoding.js';
export type { CsvEncoding, DecodedText } from './encoding.js';
export { parseCsv, detectDelimiter, CSV_DELIMITERS } from './csv.js';
export type { CsvDelimiter, CsvRecord } from './csv.js';
export { parseDate, isIsoDate, matchingDateFormats, DATE_FORMATS } from './dates.js';
export type { DateFormat } from './dates.js';
export { parseAmount, detectDecimalSeparator, DECIMAL_SEPARATORS } from './amounts.js';
export type { DecimalSeparator, SeparatorDetection } from './amounts.js';

export {
  COLUMN_ROLES,
  HEADER_SYNONYMS,
  checkMappingAgainstHeader,
  detectColumns,
  headerSha256,
  mappingId,
  normalizeHeader,
  parseMapping,
} from './mapping.js';
export type {
  ColumnDetection,
  ColumnMap,
  ColumnRole,
  Mapping,
  MappingIssue,
  MappingOverrides,
} from './mapping.js';

export { importCsv, readCsvHead } from './import.js';
export type {
  CsvHead,
  CsvInput,
  DraftMapping,
  ImportedRow,
  ImportNeedsMapping,
  ImportOk,
  ImportOptions,
  ImportResult,
  RowError,
} from './import.js';

export { createLedger, compareTransactions } from './ledger.js';
export type { FileFailure, Ledger, LedgerFileSummary } from './ledger.js';

export {
  cashflow,
  encodeRef,
  figureRows,
  listTransactions,
  normalizeFilter,
  selectRows,
  toSources,
  totals,
  LIST_DEFAULT_LIMIT,
  LIST_MAX_LIMIT,
} from './query.js';
export type {
  CashflowMonth,
  CashflowOptions,
  CashflowResult,
  FigureSpec,
  GroupBy,
  ListOptions,
  ListResult,
  ResultContext,
  SourceRef,
  TotalsGroup,
  TotalsOptions,
  TotalsResult,
  TransactionFilter,
} from './query.js';

export { decodeRef, explain } from './explain.js';
export type { ExplainedFile, ExplainedRow, ExplainOptions, ExplainResult } from './explain.js';
