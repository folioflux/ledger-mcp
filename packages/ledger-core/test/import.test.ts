import { describe, expect, it } from 'vitest';
import { importCsv, LedgerError, readCsvHead } from '../src/index.js';
import type { ImportOk, ImportResult, Mapping } from '../src/index.js';
import {
  csv,
  DOGWOOD_OVERRIDES,
  fixture,
  TOP_LEVEL_FIXTURES,
  validateTransaction,
} from './helpers.js';

function expectOk(result: ImportResult): ImportOk {
  if (result.status !== 'ok') throw new Error(`expected ok, got ${JSON.stringify(result.issues)}`);
  return result;
}

describe('importCsv with the fixtures', () => {
  it.each(TOP_LEVEL_FIXTURES)('reads %s without guessing', (name) => {
    const result = expectOk(importCsv(fixture(name)));
    expect(result.row_errors).toEqual([]);
    expect(result.rows.length).toBe(result.data_row_count);
    for (const { transaction } of result.rows) {
      expect(validateTransaction(transaction), JSON.stringify(validateTransaction.errors)).toBe(
        true,
      );
      expect(transaction.provenance.source_file).toBe(name);
      expect(transaction.provenance.mapping_id).toBe(result.mapping_id);
    }
  });

  it('reads a UTF-8 file with BOM and CRLF line endings', () => {
    const result = expectOk(importCsv(fixture('alder-bank-current.csv')));
    expect(result).toMatchObject({ encoding: 'utf-8', bom: true });
    expect(result.mapping).toMatchObject({ delimiter: ',', date_format: 'YYYY-MM-DD' });
    expect(result.rows[0]?.transaction).toMatchObject({
      date: '2026-01-02',
      amount: '2400.00',
      currency: 'EUR',
      description: 'Invoice 2026-001 paid',
      merchant: 'Client Alpha Ltd',
      category: 'Income',
      account: null,
      provenance: { row_number: 1 },
    });
    expect(result.rows[4]?.transaction.description).toBe('Notebook app "Pro" plan');
    expect(result.rows[9]?.transaction.category).toBeNull();
  });

  it('turns money out / money in columns into signed amounts', () => {
    const result = expectOk(importCsv(fixture('birch-card.csv')));
    expect(result.mapping.date_format).toBe('DD/MM/YYYY');
    expect(
      result.rows.slice(0, 2).map((row) => [row.transaction.date, row.transaction.amount]),
    ).toEqual([
      ['2026-01-04', '-15.00'],
      ['2026-01-13', '1250.00'],
    ]);
  });

  it('reads a Windows-1252, semicolon, decimal-comma file', () => {
    const result = expectOk(importCsv(fixture('cedar-savings.csv')));
    expect(result).toMatchObject({ encoding: 'windows-1252', bom: false });
    expect(result.mapping).toMatchObject({
      delimiter: ';',
      date_format: 'DD.MM.YYYY',
      decimal_separator: ',',
    });
    expect(result.rows.map((row) => row.transaction.description)).toContain('Café Olé gift card');
    expect(result.rows.every((row) => row.transaction.currency === 'PLN')).toBe(true);
    expect(result.rows.every((row) => row.transaction.account !== null)).toBe(true);
  });

  it('asks for a mapping when dates and currency are ambiguous', () => {
    const result = importCsv(fixture('needs-mapping/dogwood-ambiguous-dates.csv'));
    expect(result.status).toBe('needs_mapping');
    expect(result.rows).toEqual([]);
    expect(result.mapping_id).toBeNull();
    expect(result.issues.map((issue) => issue.field).sort()).toEqual([
      'date_format',
      'default_currency',
    ]);
    expect(result.issues.find((issue) => issue.field === 'date_format')?.candidates).toEqual([
      'DD/MM/YYYY',
      'MM/DD/YYYY',
    ]);
    expect(result.sample).toHaveLength(3);
  });

  it('reads the ambiguous file once the open questions are answered', () => {
    const name = 'needs-mapping/dogwood-ambiguous-dates.csv';
    const ddmm = expectOk(importCsv(fixture(name), { overrides: DOGWOOD_OVERRIDES }));
    const mmdd = expectOk(
      importCsv(fixture(name), { overrides: { ...DOGWOOD_OVERRIDES, date_format: 'MM/DD/YYYY' } }),
    );
    expect(ddmm.overrides_applied).toBe(true);
    expect(ddmm.rows[0]?.transaction.date).toBe('2026-02-01');
    expect(mmdd.rows[0]?.transaction.date).toBe('2026-01-02');
    expect(ddmm.mapping_id).not.toBe(mmdd.mapping_id);
  });
});

describe('importCsv rules', () => {
  it('numbers data rows from 1 after the header and counts blank lines', () => {
    const result = expectOk(
      importCsv(
        csv(
          'a.csv',
          'Date,Description,Amount,Currency\n2026-01-01,a,1.00,EUR\n\n2026-01-02,b,2.00,EUR\n',
        ),
      ),
    );
    expect(result.rows.map((row) => row.transaction.provenance.row_number)).toEqual([1, 3]);
    expect(result.data_row_count).toBe(2);
  });

  it('reports bad rows as row errors and keeps the good ones', () => {
    const result = expectOk(
      importCsv(
        csv(
          'a.csv',
          [
            'Date,Description,Amount,Currency',
            '2026-01-01,ok,1.00,EUR',
            '2026-02-30,bad date,1.00,EUR',
            '2026-01-03,bad amount,abc,EUR',
            '2026-01-04,empty amount,,EUR',
            '2026-01-05,short row',
            '2026-01-06,bad currency,1.00,euro',
            '2026-01-07,ok,2.00,eur',
          ].join('\n'),
        ),
      ),
    );
    expect(result.rows.map((row) => row.transaction.provenance.row_number)).toEqual([1, 7]);
    expect(result.rows[1]?.transaction.currency).toBe('EUR');
    expect(result.row_errors.map((error) => [error.row_number, error.column])).toEqual([
      [2, 'Date'],
      [3, 'Amount'],
      [4, 'Amount'],
      [5, null],
      [6, 'Currency'],
    ]);
  });

  it('uses the default currency and account when the file has none', () => {
    const result = expectOk(
      importCsv(csv('a.csv', 'Date,Description,Amount\n2026-01-01,a,1.00\n'), {
        overrides: { default_currency: 'CHF', default_account: 'Main' },
      }),
    );
    expect(result.rows[0]?.transaction).toMatchObject({ currency: 'CHF', account: 'Main' });
  });

  it('asks for the decimal separator when amounts could go either way', () => {
    const result = importCsv(
      csv('a.csv', 'Date,Description,Amount,Currency\n2026-01-01,a,"1,500",EUR\n'),
    );
    expect(result.status).toBe('needs_mapping');
    expect(result.issues.map((issue) => issue.field)).toEqual(['decimal_separator']);
  });

  it('asks for columns it cannot find', () => {
    const result = importCsv(csv('a.csv', 'When,What,How much\n2026-01-01,a,1.00\n'));
    expect(result.status).toBe('needs_mapping');
    expect(result.issues.map((issue) => issue.field)).toEqual(
      expect.arrayContaining(['date', 'amount', 'default_currency']),
    );
  });

  it('applies column overrides', () => {
    const result = expectOk(
      importCsv(csv('a.csv', 'When,What,How much\n2026-01-01,a,1.00\n'), {
        overrides: {
          columns: { date: 'When', description: 'What', amount: 'How much' },
          default_currency: 'EUR',
        },
      }),
    );
    expect(result.rows[0]?.transaction).toMatchObject({ date: '2026-01-01', amount: '1.00' });
  });

  it('uses a saved mapping only when the header matches', () => {
    const first = expectOk(
      importCsv(fixture('needs-mapping/dogwood-ambiguous-dates.csv'), {
        overrides: DOGWOOD_OVERRIDES,
      }),
    );
    const saved: Mapping = first.mapping;
    const again = expectOk(
      importCsv(fixture('needs-mapping/dogwood-ambiguous-dates.csv'), { saved }),
    );
    expect(again.mapping_source).toBe('saved');
    expect(again.mapping_id).toBe(first.mapping_id);
    const other = importCsv(fixture('alder-bank-current.csv'), { saved });
    expect(other.mapping_source).toBe('detected');
  });

  it('changes the source hash, ids and nothing else when one byte changes', () => {
    const original = fixture('alder-bank-current.csv');
    const bytes = original.bytes.slice();
    const index = new TextDecoder('utf-8', { ignoreBOM: true }).decode(bytes).indexOf('Groceries');
    bytes[index] = 'g'.charCodeAt(0);
    const a = expectOk(importCsv(original));
    const b = expectOk(importCsv({ name: original.name, bytes }));
    expect(b.source_sha256).not.toBe(a.source_sha256);
    expect(b.rows[0]?.transaction.id).not.toBe(a.rows[0]?.transaction.id);
    expect(b.mapping_id).toBe(a.mapping_id);
  });

  it('still asks when rows fit several formats but none fits all', () => {
    const result = importCsv(
      csv(
        'a.csv',
        'Date,Description,Amount,Currency\n01/02/2026,a,1.00,EUR\n2026-01-01,b,1.00,EUR\n',
      ),
    );
    expect(result.status).toBe('needs_mapping');
    expect(result.issues[0]?.candidates).toEqual(['YYYY-MM-DD', 'DD/MM/YYYY', 'MM/DD/YYYY']);
  });

  it('fails clearly on malformed or empty files', () => {
    expect(() => importCsv(csv('a.csv', 'Date,Amount\n"2026-01-01,1\n'))).toThrow(LedgerError);
    expect(() => importCsv(csv('a.csv', '\n\n'))).toThrow(/no header row/);
  });

  it('reads just the head of a file', () => {
    expect(readCsvHead(fixture('cedar-savings.csv'))).toMatchObject({
      delimiter: ';',
      encoding: 'windows-1252',
      header: ['Date', 'Text', 'Amount', 'Currency', 'Account'],
    });
  });
});
