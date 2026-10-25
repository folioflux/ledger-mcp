import { LedgerError } from './errors.js';

/** Text encodings that ledger-core can read. */
export type CsvEncoding = 'utf-8' | 'windows-1252';

export const CSV_ENCODINGS: readonly CsvEncoding[] = ['utf-8', 'windows-1252'];

export interface DecodedText {
  text: string;
  encoding: CsvEncoding;
  /** True when the file started with a UTF-8 byte order mark (it is removed from text). */
  bom: boolean;
}

/**
 * Decodes CSV bytes. Without an explicit encoding, a UTF-8 BOM or valid UTF-8
 * means UTF-8; anything else is read as Windows-1252, which can decode any byte.
 */
export function decodeCsvBytes(bytes: Uint8Array, encoding?: CsvEncoding): DecodedText {
  if ((bytes[0] === 0xff && bytes[1] === 0xfe) || (bytes[0] === 0xfe && bytes[1] === 0xff)) {
    throw new LedgerError(
      'UNSUPPORTED_ENCODING',
      'UTF-16 files are not supported. Re-save the export as UTF-8 CSV.',
    );
  }
  const bom = bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;
  const body = bom ? bytes.subarray(3) : bytes;

  if (encoding === 'windows-1252') {
    return { text: new TextDecoder('windows-1252').decode(body), encoding, bom };
  }
  try {
    return {
      text: new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(body),
      encoding: 'utf-8',
      bom,
    };
  } catch {
    if (encoding === 'utf-8' || bom) {
      throw new LedgerError('UNSUPPORTED_ENCODING', 'The file is not valid UTF-8.');
    }
    return { text: new TextDecoder('windows-1252').decode(body), encoding: 'windows-1252', bom };
  }
}
