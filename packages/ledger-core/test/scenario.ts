import {
  cashflow,
  createLedger,
  explain,
  importCsv,
  listTransactions,
  totals,
} from '../src/index.js';
import type { CsvInput } from '../src/index.js';
import { DOGWOOD_OVERRIDES } from './helpers.js';

/**
 * A fixed set of queries over a set of CSV inputs. Used by the determinism and
 * golden tests: the same inputs must always produce byte-identical output.
 */
export function runScenario(inputs: readonly CsvInput[]): Record<string, unknown> {
  const results = inputs.map((input) =>
    importCsv(input, input.name.includes('dogwood') ? { overrides: DOGWOOD_OVERRIDES } : {}),
  );
  const ledger = createLedger(results);
  const byMonth = totals(ledger, { group_by: 'month' });
  const flow = cashflow(ledger, { from: '2026-01-01', to: '2026-03-31' });
  const firstRef = byMonth.groups[0]?.ref ?? '';
  return {
    import: results.map(({ rows: _rows, ...summary }) => summary),
    list_transactions: listTransactions(ledger, { text: 'coffee' }),
    totals_by_month: byMonth,
    totals_by_category: totals(ledger, { group_by: 'category', sign: 'out' }),
    cashflow: flow,
    explain: explain(ledger, { ref: firstRef, input_hash: ledger.input_hash }),
  };
}

export function serialize(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}
