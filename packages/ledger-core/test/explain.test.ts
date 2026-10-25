import { describe, expect, it } from 'vitest';
import {
  cashflow,
  createLedger,
  decodeRef,
  explain,
  importCsv,
  LedgerError,
  totals,
} from '../src/index.js';
import { fixture, fixtureLedger, TOP_LEVEL_FIXTURES } from './helpers.js';

const ledger = fixtureLedger();

describe('explain', () => {
  it('reproduces every totals figure from its ref', () => {
    for (const group_by of ['month', 'category'] as const) {
      const result = totals(ledger, { group_by, from: '2026-01-01' });
      for (const group of result.groups) {
        const explained = explain(ledger, { ref: group.ref, input_hash: result.input_hash });
        expect(explained.figure).toMatchObject({
          tool: 'totals',
          value: group.total,
          currency: group.currency,
        });
        expect(explained.sum_matches_figure).toBe(true);
        expect(explained.input_hash_matches).toBe(true);
        expect(explained.sums).toEqual([
          { currency: group.currency, sum: group.total, count: group.count },
        ]);
        const cited = group.sources.flatMap(({ file, rows }) =>
          rows.map((row) => `${file}#${row}`),
        );
        expect(explained.rows.map((row) => `${row.file}#${row.row_number}`).sort()).toEqual(
          cited.sort(),
        );
      }
    }
  });

  it('reproduces every cashflow figure from its refs', () => {
    const result = cashflow(ledger);
    for (const month of result.months) {
      for (const field of ['inflow', 'outflow', 'net'] as const) {
        const explained = explain(ledger, { ref: month.refs[field] });
        expect(explained.figure).toMatchObject({ tool: 'cashflow', field, value: month[field] });
        expect(explained.sum_matches_figure).toBe(true);
        expect(explained.input_hash_matches).toBeNull();
      }
    }
  });

  it('includes the original cells, the file hash and the mapping', () => {
    const group = totals(ledger, { group_by: 'category', currency: 'PLN' }).groups[0];
    const explained = explain(ledger, { ref: group?.ref ?? '' });
    const cafe = explained.rows.find((row) => row.description.startsWith('Café'));
    expect(cafe).toMatchObject({
      file: 'cedar-savings.csv',
      row_number: 4,
      amount: '-150.00',
      raw: { Date: '19.02.2026', Amount: '-150,00', Text: 'Café Olé gift card' },
    });
    expect(explained.files).toEqual([
      expect.objectContaining({
        file: 'cedar-savings.csv',
        source_sha256: expect.stringMatching(/^[0-9a-f]{64}$/),
        mapping_id: expect.stringMatching(/^map_/),
        mapping: expect.objectContaining({ decimal_separator: ',' }),
      }),
    ]);
  });

  it('explains explicit rows from list results', () => {
    const explained = explain(ledger, {
      sources: [
        { file: 'birch-card.csv', rows: [2, 1] },
        { file: 'alder-bank-current.csv', rows: [1] },
      ],
    });
    expect(explained.figure).toBeNull();
    expect(explained.sum_matches_figure).toBeNull();
    expect(explained.rows.map((row) => `${row.file}#${row.row_number}`)).toEqual([
      'alder-bank-current.csv#1',
      'birch-card.csv#1',
      'birch-card.csv#2',
    ]);
    expect(explained.sums).toEqual([
      { currency: 'EUR', sum: '2400.00', count: 1 },
      { currency: 'GBP', sum: '1235.00', count: 2 },
    ]);
  });

  it('reports a changed input hash', () => {
    const group = totals(ledger, { group_by: 'month' }).groups[0];
    expect(
      explain(ledger, { ref: group?.ref ?? '', input_hash: '0'.repeat(64) }).input_hash_matches,
    ).toBe(false);
  });

  it('says when a figure no longer exists in the data', () => {
    const group = totals(ledger, { group_by: 'month', currency: 'GBP' }).groups[0];
    const smaller = createLedger([importCsv(fixture('alder-bank-current.csv'))]);
    expect(() => explain(smaller, { ref: group?.ref ?? '' })).toThrow(/does not exist/);
  });

  it.each([
    ['not a ref', { ref: 'hello' }],
    ['a corrupted ref', { ref: 'fig1_!!!' }],
    [
      'a well-formed but unknown spec',
      { ref: `fig1_${Buffer.from('{"tool":"x"}').toString('base64url')}` },
    ],
    ['both ref and sources', { ref: 'fig1_x', sources: [] }],
    ['neither ref nor sources', {}],
    ['an unknown file', { sources: [{ file: 'nope.csv', rows: [1] }] }],
    ['a missing row', { sources: [{ file: 'birch-card.csv', rows: [99] }] }],
  ])('rejects %s', (_label, options) => {
    expect(() => explain(ledger, options)).toThrow(LedgerError);
  });

  it('decodes refs into the figure they name', () => {
    const month = cashflow(ledger, { currency: 'EUR' }).months[0];
    expect(decodeRef(month?.refs.net ?? '')).toEqual({
      tool: 'cashflow',
      query: { currency: 'EUR' },
      figure: { month: '2026-01', currency: 'EUR', field: 'net' },
    });
  });

  it('covers every fixture file', () => {
    const files = new Set(
      totals(ledger, { group_by: 'month' }).groups.flatMap((g) =>
        explain(ledger, { ref: g.ref }).files.map((f) => f.file),
      ),
    );
    expect([...files].sort()).toEqual(TOP_LEVEL_FIXTURES);
  });
});
