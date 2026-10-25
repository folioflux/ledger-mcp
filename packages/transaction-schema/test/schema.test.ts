import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { transactionSchema, TRANSACTION_SCHEMA_VERSION } from '../src/index.js';
import { compileSchema } from './validator.js';

const schemaFile: unknown = JSON.parse(
  readFileSync(new URL('../transaction.schema.json', import.meta.url), 'utf8'),
);
const validate = compileSchema(schemaFile as object);

const valid = {
  id: 'tx_0123456789abcdef01234567',
  date: '2026-01-31',
  amount: '-12.50',
  currency: 'EUR',
  description: 'Coffee',
  merchant: null,
  category: null,
  account: null,
  provenance: {
    source_file: 'bank.csv',
    source_sha256: 'a'.repeat(64),
    row_number: 1,
    mapping_id: 'map_0123456789abcdef',
  },
};

describe('transaction schema', () => {
  it('matches the embedded TypeScript copy', () => {
    expect(transactionSchema).toEqual(schemaFile);
  });

  it('carries the package version in its $id', () => {
    expect(transactionSchema.$id).toContain(`/v${TRANSACTION_SCHEMA_VERSION}/`);
  });

  it('accepts a well-formed transaction', () => {
    expect(validate(valid)).toBe(true);
  });

  it.each([
    ['a numeric amount', { amount: -12.5 }],
    ['an amount without two fraction digits', { amount: '-12.5' }],
    ['an amount in exponent notation', { amount: '1e3' }],
    ['an amount with thousands separators', { amount: '1,000.00' }],
    ['a non-ISO date', { date: '31.01.2026' }],
    ['an impossible date', { date: '2026-02-30' }],
    ['a lower-case currency', { currency: 'eur' }],
    ['an unknown property', { note: 'x' }],
    ['a malformed id', { id: 'tx_123' }],
  ])('rejects %s', (_label, patch) => {
    expect(validate({ ...valid, ...patch })).toBe(false);
  });

  it.each([
    ['row number 0', { row_number: 0 }],
    ['a short hash', { source_sha256: 'abc' }],
    ['an unknown provenance property', { line: 2 }],
  ])('rejects provenance with %s', (_label, patch) => {
    expect(validate({ ...valid, provenance: { ...valid.provenance, ...patch } })).toBe(false);
  });
});
