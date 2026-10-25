import { describe, expect, it } from 'vitest';
import { decodeCsvBytes, LedgerError } from '../src/index.js';

describe('decodeCsvBytes', () => {
  it('reads UTF-8 and strips a byte order mark', () => {
    const decoded = decodeCsvBytes(new Uint8Array([0xef, 0xbb, 0xbf, 0x61, 0xc3, 0xa9]));
    expect(decoded).toEqual({ text: 'aé', encoding: 'utf-8', bom: true });
  });

  it('falls back to Windows-1252 for bytes that are not valid UTF-8', () => {
    // "Café €" in Windows-1252: é = 0xE9, € = 0x80.
    const decoded = decodeCsvBytes(new Uint8Array([0x43, 0x61, 0x66, 0xe9, 0x20, 0x80]));
    expect(decoded).toEqual({ text: 'Café €', encoding: 'windows-1252', bom: false });
  });

  it('honours an explicit encoding', () => {
    expect(decodeCsvBytes(new Uint8Array([0xc3, 0xa9]), 'windows-1252').text).toBe('Ã©');
    expect(() => decodeCsvBytes(new Uint8Array([0xe9]), 'utf-8')).toThrow(LedgerError);
  });

  it('rejects UTF-16', () => {
    expect(() => decodeCsvBytes(new Uint8Array([0xff, 0xfe, 0x61, 0x00]))).toThrow(/UTF-16/);
  });
});
