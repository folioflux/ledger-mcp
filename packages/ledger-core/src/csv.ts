import { LedgerError } from './errors.js';

/** Field delimiters that ledger-core can detect or be told to use. */
export type CsvDelimiter = ',' | ';' | '\t' | '|';

export const CSV_DELIMITERS: readonly CsvDelimiter[] = [',', ';', '\t', '|'];

/** One parsed CSV record and the 1-based line on which it starts. */
export interface CsvRecord {
  cells: string[];
  line: number;
}

/**
 * Parses CSV text (RFC 4180 style). Quoted fields may contain delimiters,
 * doubled quotes and line breaks. Accepts CRLF, LF and CR line endings.
 * Throws a LedgerError with the line number on malformed quoting.
 */
export function parseCsv(text: string, delimiter: CsvDelimiter): CsvRecord[] {
  const records: CsvRecord[] = [];
  let cells: string[] = [];
  let field = '';
  let inQuotes = false;
  let afterQuote = false;
  let line = 1;
  let recordLine = 1;
  let fieldStarted = false;

  const endField = (): void => {
    cells.push(field);
    field = '';
    afterQuote = false;
    fieldStarted = false;
  };
  const endRecord = (): void => {
    endField();
    records.push({ cells, line: recordLine });
    cells = [];
  };

  for (let i = 0; i < text.length; i++) {
    const char = text.charAt(i);
    if (inQuotes) {
      if (char === '"') {
        if (text.charAt(i + 1) === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
          afterQuote = true;
        }
      } else {
        if (char === '\n' || (char === '\r' && text.charAt(i + 1) !== '\n')) line++;
        field += char;
      }
      continue;
    }
    if (char === delimiter) {
      endField();
      fieldStarted = true;
      continue;
    }
    if (char === '\r' || char === '\n') {
      if (char === '\r' && text.charAt(i + 1) === '\n') i++;
      endRecord();
      line++;
      recordLine = line;
      continue;
    }
    if (afterQuote) {
      throw new LedgerError(
        'CSV_PARSE_ERROR',
        `Unexpected character after a closing quote on line ${line}.`,
      );
    }
    if (char === '"' && field === '') {
      inQuotes = true;
      fieldStarted = true;
      continue;
    }
    field += char;
    fieldStarted = true;
  }

  if (inQuotes) {
    throw new LedgerError(
      'CSV_PARSE_ERROR',
      `Unterminated quoted field starting on line ${recordLine}.`,
    );
  }
  if (fieldStarted || field !== '' || cells.length > 0 || afterQuote) {
    endRecord();
  }
  return records;
}

/** True when every cell of the record is empty or whitespace. */
export function isBlankRecord(cells: readonly string[]): boolean {
  return cells.every((cell) => cell.trim() === '');
}

/**
 * Picks the delimiter that splits the header into the most columns while giving
 * the most following lines the same column count. Returns null when no
 * candidate produces at least two columns.
 */
export function detectDelimiter(text: string): CsvDelimiter | null {
  let best: { delimiter: CsvDelimiter; consistent: number; columns: number } | null = null;
  for (const delimiter of CSV_DELIMITERS) {
    let records: CsvRecord[];
    try {
      records = parseCsv(text, delimiter);
    } catch {
      continue;
    }
    const nonBlank = records.filter((record) => !isBlankRecord(record.cells)).slice(0, 50);
    const header = nonBlank[0];
    if (!header || header.cells.length < 2) continue;
    const columns = header.cells.length;
    const consistent = nonBlank.filter((record) => record.cells.length === columns).length;
    if (
      best === null ||
      consistent > best.consistent ||
      (consistent === best.consistent && columns > best.columns)
    ) {
      best = { delimiter, consistent, columns };
    }
  }
  return best?.delimiter ?? null;
}
