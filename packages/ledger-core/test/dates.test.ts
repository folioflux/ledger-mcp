import { describe, expect, it } from 'vitest';
import { isIsoDate, matchingDateFormats, parseDate } from '../src/index.js';

describe('parseDate', () => {
  it.each([
    ['2026-01-31', 'YYYY-MM-DD', '2026-01-31'],
    ['2026-01-31T23:59:59+05:00', 'YYYY-MM-DD', '2026-01-31'],
    ['2026-1-5', 'YYYY-MM-DD', '2026-01-05'],
    ['2026/01/31', 'YYYY/MM/DD', '2026-01-31'],
    ['31.01.2026', 'DD.MM.YYYY', '2026-01-31'],
    ['31/01/2026', 'DD/MM/YYYY', '2026-01-31'],
    ['01/31/2026', 'MM/DD/YYYY', '2026-01-31'],
    ['31-01-2026', 'DD-MM-YYYY', '2026-01-31'],
    [' 5.1.2026 ', 'DD.MM.YYYY', '2026-01-05'],
    ['29.02.2024', 'DD.MM.YYYY', '2024-02-29'],
  ] as const)('parses %j as %s', (raw, format, expected) => {
    expect(parseDate(raw, format)).toBe(expected);
  });

  it.each([
    ['30.02.2026', 'DD.MM.YYYY'],
    ['29.02.2025', 'DD.MM.YYYY'],
    ['29.02.1900', 'DD.MM.YYYY'],
    ['2026-13-01', 'YYYY-MM-DD'],
    ['31/04/2026', 'DD/MM/YYYY'],
    ['00/01/2026', 'DD/MM/YYYY'],
    ['2026-01-31', 'DD.MM.YYYY'],
    ['26-01-31', 'YYYY-MM-DD'],
    ['', 'YYYY-MM-DD'],
  ] as const)('rejects %j as %s', (raw, format) => {
    expect(parseDate(raw, format)).toBeNull();
  });

  it('validates ISO dates strictly', () => {
    expect(isIsoDate('2026-02-28')).toBe(true);
    expect(isIsoDate('2026-02-30')).toBe(false);
    expect(isIsoDate('2026-2-28')).toBe(false);
  });
});

describe('matchingDateFormats', () => {
  it('finds a single format when a day is above 12', () => {
    expect(matchingDateFormats(['01/02/2026', '13/02/2026'])).toEqual(['DD/MM/YYYY']);
    expect(matchingDateFormats(['02/01/2026', '02/13/2026'])).toEqual(['MM/DD/YYYY']);
  });

  it('reports both slash formats when every day is 12 or below', () => {
    expect(matchingDateFormats(['01/02/2026', '11/12/2026'])).toEqual(['DD/MM/YYYY', 'MM/DD/YYYY']);
  });

  it('ignores empty cells and returns nothing for no values', () => {
    expect(matchingDateFormats(['', ' ', '2026-01-01'])).toEqual(['YYYY-MM-DD']);
    expect(matchingDateFormats(['', ''])).toEqual([]);
  });
});
