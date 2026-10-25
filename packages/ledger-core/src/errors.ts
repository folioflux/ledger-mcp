/** Machine-readable error codes raised by ledger-core. */
export type LedgerErrorCode =
  | 'CSV_PARSE_ERROR'
  | 'CSV_EMPTY'
  | 'UNSUPPORTED_ENCODING'
  | 'INVALID_MAPPING'
  | 'INVALID_ARGUMENT'
  | 'INVALID_REF'
  | 'NOT_FOUND';

/** An error with a stable code, safe to show to a user or an MCP client. */
export class LedgerError extends Error {
  readonly code: LedgerErrorCode;

  constructor(code: LedgerErrorCode, message: string) {
    super(message);
    this.name = 'LedgerError';
    this.code = code;
  }
}
