import { readdirSync, readFileSync } from 'node:fs';
import { transactionSchema } from '@folioflux/transaction-schema';
import type { CsvInput, ImportResult, Ledger, MappingOverrides } from '../src/index.js';
import { createLedger, importCsv } from '../src/index.js';
import { compileSchema } from '../../transaction-schema/test/validator.js';

export const FIXTURES = new URL('../../../fixtures/', import.meta.url);

/** The clean fixture files at the top of fixtures/, sorted. */
export const TOP_LEVEL_FIXTURES = readdirSync(FIXTURES)
  .filter((name) => name.endsWith('.csv'))
  .sort();

export function fixture(name: string): CsvInput {
  return { name, bytes: new Uint8Array(readFileSync(new URL(name, FIXTURES))) };
}

export function csv(name: string, text: string): CsvInput {
  return { name, bytes: new TextEncoder().encode(text) };
}

/** Mapping that resolves the deliberately ambiguous fixture. */
export const DOGWOOD_OVERRIDES: MappingOverrides = {
  date_format: 'DD/MM/YYYY',
  default_currency: 'EUR',
};

export function importAll(names: readonly string[] = TOP_LEVEL_FIXTURES): ImportResult[] {
  return names.map((name) => importCsv(fixture(name)));
}

export function fixtureLedger(): Ledger {
  return createLedger(importAll());
}

export const validateTransaction = compileSchema(transactionSchema);
