import { describe, expect, it } from 'vitest';
import {
  checkMappingAgainstHeader,
  detectColumns,
  headerSha256,
  LedgerError,
  mappingId,
  normalizeHeader,
  parseMapping,
} from '../src/index.js';
import type { Mapping } from '../src/index.js';

const mapping: Mapping = {
  version: 1,
  header_sha256: headerSha256(['Date', 'Description', 'Amount']),
  delimiter: ',',
  encoding: 'utf-8',
  date_format: 'YYYY-MM-DD',
  decimal_separator: '.',
  columns: {
    date: 'Date',
    amount: 'Amount',
    debit: null,
    credit: null,
    currency: null,
    description: 'Description',
    merchant: null,
    category: null,
    account: null,
  },
  default_currency: 'EUR',
  default_account: null,
};

describe('normalizeHeader', () => {
  it('lower-cases and collapses punctuation and spaces', () => {
    expect(normalizeHeader('  Transaction_Date ')).toBe('transaction date');
    expect(normalizeHeader('Money-Out (£)')).toBe('money out');
  });
});

describe('detectColumns', () => {
  it('maps common header names to roles', () => {
    const { columns, issues } = detectColumns([
      'Transaction Date',
      'Payee',
      'Details',
      'Money Out',
      'Money In',
      'Currency',
      'Category',
    ]);
    expect(issues).toEqual([]);
    expect(columns).toMatchObject({
      date: 'Transaction Date',
      merchant: 'Payee',
      description: 'Details',
      debit: 'Money Out',
      credit: 'Money In',
      amount: null,
      currency: 'Currency',
      category: 'Category',
    });
  });

  it('prefers an exact "amount" column over weaker synonyms', () => {
    expect(detectColumns(['Date', 'Amount', 'Total']).columns.amount).toBe('Amount');
  });

  it('reports a tie instead of picking one', () => {
    const { columns, issues } = detectColumns(['Date', 'Booking date', 'Amount']);
    expect(columns.date).toBeNull();
    expect(issues).toEqual([
      expect.objectContaining({ field: 'date', candidates: ['Date', 'Booking date'] }),
    ]);
  });

  it('leaves unknown columns unmapped', () => {
    expect(detectColumns(['Foo', 'Bar']).columns.date).toBeNull();
  });
});

describe('mapping ids and validation', () => {
  it('derives a stable id that changes with any field', () => {
    expect(mappingId(mapping)).toMatch(/^map_[0-9a-f]{16}$/);
    expect(mappingId({ ...mapping })).toBe(mappingId(mapping));
    expect(mappingId({ ...mapping, default_currency: 'GBP' })).not.toBe(mappingId(mapping));
  });

  it('round-trips through JSON', () => {
    expect(parseMapping(JSON.parse(JSON.stringify(mapping)))).toEqual(mapping);
  });

  it.each([
    ['a non-object', 'nope'],
    ['an unknown version', { ...mapping, version: 2 }],
    ['a bad header hash', { ...mapping, header_sha256: 'xyz' }],
    ['an unknown column role', { ...mapping, columns: { ...mapping.columns, memo: 'Memo' } }],
    ['an unsupported date format', { ...mapping, date_format: 'YY-MM-DD' }],
    ['a lower-case currency', { ...mapping, default_currency: 'eur' }],
    ['a numeric column', { ...mapping, columns: { ...mapping.columns, date: 1 } }],
  ])('rejects %s', (_label, value) => {
    expect(() => parseMapping(value)).toThrow(LedgerError);
  });

  it('checks columns against a header', () => {
    expect(checkMappingAgainstHeader(mapping, ['Date', 'Description', 'Amount'])).toEqual([]);
    expect(checkMappingAgainstHeader(mapping, ['Date', 'Description'])).toEqual([
      expect.objectContaining({
        field: 'amount',
        message: expect.stringContaining('not in the header'),
      }),
    ]);
    expect(checkMappingAgainstHeader(mapping, ['Date', 'Amount', 'Amount', 'Description'])).toEqual(
      [
        expect.objectContaining({
          field: 'amount',
          message: expect.stringContaining('more than once'),
        }),
      ],
    );
    const noCurrency = { ...mapping, default_currency: null };
    expect(checkMappingAgainstHeader(noCurrency, ['Date', 'Description', 'Amount'])).toEqual([
      expect.objectContaining({ field: 'default_currency' }),
    ]);
  });
});
