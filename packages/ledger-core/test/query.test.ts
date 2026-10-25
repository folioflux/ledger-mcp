import { describe, expect, it } from 'vitest';
import {
  cashflow,
  createLedger,
  importCsv,
  LedgerError,
  listTransactions,
  sumAmounts,
  totals,
} from '../src/index.js';
import type { Ledger, SourceRef } from '../src/index.js';
import { csv, fixtureLedger } from './helpers.js';

const ledger = fixtureLedger();

/** Amounts of the rows a result cites, looked up independently of the query code. */
function citedAmounts(source: Ledger, sources: readonly SourceRef[]): string[] {
  return sources.flatMap(({ file, rows }) =>
    rows.map((rowNumber) => {
      const row = source.rows.find(
        ({ transaction: t }) =>
          t.provenance.source_file === file && t.provenance.row_number === rowNumber,
      );
      if (!row) throw new Error(`cited row ${file}#${rowNumber} does not exist`);
      return row.transaction.amount;
    }),
  );
}

describe('ledger', () => {
  it('sorts rows by date, file and row number', () => {
    const keys = ledger.rows.map(
      ({ transaction: t }) => `${t.date} ${t.provenance.source_file} ${t.provenance.row_number}`,
    );
    expect(keys).toEqual([...keys].sort());
    expect(ledger.rows).toHaveLength(30);
    expect(ledger.input_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('rejects the same file name twice', () => {
    const result = importCsv(
      csv('a.csv', 'Date,Description,Amount,Currency\n2026-01-01,a,1.00,EUR\n'),
    );
    expect(() => createLedger([result, result])).toThrow(/more than once/);
  });

  it('lists files that need a mapping and does not count them', () => {
    const needs = importCsv(csv('b.csv', 'Date,Description,Amount\n01/02/2026,a,1.00\n'));
    const mixed = createLedger([needs]);
    expect(mixed.files).toEqual([
      expect.objectContaining({ file: 'b.csv', status: 'needs_mapping', transactions: 0 }),
    ]);
    expect(mixed.rows).toEqual([]);
  });
});

describe('listTransactions', () => {
  it('filters by date range (inclusive), text and sign', () => {
    const result = listTransactions(ledger, {
      from: '2026-02-01',
      to: '2026-02-28',
      text: 'HOSTING',
      sign: 'out',
    });
    expect(result.transactions.map((t) => [t.date, t.amount, t.currency])).toEqual([
      ['2026-02-05', '-24.99', 'EUR'],
    ]);
    expect(result.query).toEqual({
      from: '2026-02-01',
      to: '2026-02-28',
      text: 'HOSTING',
      sign: 'out',
      limit: 50,
      offset: 0,
    });
  });

  it('filters by category, account and currency', () => {
    expect(listTransactions(ledger, { category: 'Software' }).total_count).toBe(6);
    expect(listTransactions(ledger, { account: 'Savings' }).total_count).toBe(6);
    expect(listTransactions(ledger, { currency: 'GBP' }).total_count).toBe(6);
    expect(listTransactions(ledger, { sign: 'in', currency: 'EUR' }).total_count).toBe(4);
  });

  it('normalizes the currency code', () => {
    const result = listTransactions(ledger, { currency: 'gbp' });
    expect(result.query.currency).toBe('GBP');
    expect(result.total_count).toBe(6);
  });

  it('pages with limit and offset', () => {
    const first = listTransactions(ledger, { limit: 20 });
    const second = listTransactions(ledger, { limit: 20, offset: first.next_offset ?? -1 });
    expect(first.transactions).toHaveLength(20);
    expect(second.transactions).toHaveLength(10);
    expect(second.next_offset).toBeNull();
    expect([...first.transactions, ...second.transactions]).toEqual(
      ledger.rows.map((row) => row.transaction),
    );
  });

  it.each([
    [{ from: '2026-13-01' }],
    [{ from: '2026-03-01', to: '2026-02-01' }],
    [{ limit: 0 }],
    [{ limit: 501 }],
    [{ offset: -1 }],
    [{ currency: 'euro' }],
  ])('rejects %j', (options) => {
    expect(() => listTransactions(ledger, options)).toThrow(LedgerError);
  });
});

describe('totals', () => {
  it('groups by month and currency without mixing currencies', () => {
    const result = totals(ledger, { group_by: 'month' });
    expect(result.groups.map((g) => [g.key, g.currency, g.total, g.count])).toEqual([
      ['2026-01', 'EUR', '2119.11', 6],
      ['2026-01', 'GBP', '1223.40', 3],
      ['2026-01', 'PLN', '1003.27', 2],
      ['2026-02', 'EUR', '2147.61', 7],
      ['2026-02', 'GBP', '-1007.40', 3],
      ['2026-02', 'PLN', '854.05', 3],
      ['2026-03', 'EUR', '1469.86', 5],
      ['2026-03', 'PLN', '1000.00', 1],
    ]);
  });

  it('groups by the category column with uncategorized rows last', () => {
    const result = totals(ledger, { group_by: 'category', currency: 'EUR' });
    const keys = result.groups.map((g) => g.key);
    expect(keys.at(-1)).toBeNull();
    expect(result.groups.map((g) => [g.key, g.total, g.count])).toEqual([
      ['Bank fees', '-13.50', 3],
      ['Groceries', '-122.25', 3],
      ['Income', '6550.50', 3],
      ['Rent', '-540.00', 3],
      ['Software', '-82.97', 4],
      ['Travel', '-46.00', 1],
      [null, '-9.20', 1],
    ]);
    expect(result.groups.find((g) => g.key === null)?.count).toBe(1);
  });

  it('every total equals the sum of exactly the rows it cites', () => {
    for (const group_by of ['month', 'category'] as const) {
      for (const group of totals(ledger, { group_by }).groups) {
        const amounts = citedAmounts(ledger, group.sources);
        expect(amounts).toHaveLength(group.count);
        expect(sumAmounts(amounts)).toBe(group.total);
      }
    }
  });

  it('rejects an unknown grouping', () => {
    expect(() => totals(ledger, { group_by: 'merchant' as 'month' })).toThrow(LedgerError);
  });
});

describe('cashflow', () => {
  it('reports monthly in, out and net per currency', () => {
    const result = cashflow(ledger, { currency: 'EUR' });
    expect(result.months.map((m) => [m.month, m.inflow, m.outflow, m.net, m.count])).toEqual([
      ['2026-01', '2400.00', '-280.89', '2119.11', 6],
      ['2026-02', '2412.30', '-264.69', '2147.61', 7],
      ['2026-03', '1750.50', '-280.64', '1469.86', 5],
    ]);
  });

  it('keeps inflow + outflow = net and cites every counted row', () => {
    for (const month of cashflow(ledger).months) {
      expect(sumAmounts([month.inflow, month.outflow])).toBe(month.net);
      expect(sumAmounts(citedAmounts(ledger, month.sources))).toBe(month.net);
      expect(month.refs.inflow).toMatch(/^fig1_/);
    }
  });

  it('agrees with totals by month', () => {
    const byMonth = totals(ledger, { group_by: 'month' }).groups.map((g) => [
      g.key,
      g.currency,
      g.total,
    ]);
    const nets = cashflow(ledger).months.map((m) => [m.month, m.currency, m.net]);
    expect(nets).toEqual(byMonth);
  });

  it('does not accept a sign filter', () => {
    expect(() => cashflow(ledger, { sign: 'in' } as never)).toThrow(LedgerError);
  });
});
