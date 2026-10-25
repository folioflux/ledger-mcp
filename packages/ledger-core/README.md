# @folioflux/ledger-core

The engine behind [ledger-mcp](../../README.md): CSV decoding and parsing, column mapping, exact decimal arithmetic, queries and explanations.

It is pure. It does no file or network I/O, never reads the clock, the time zone or the locale, and never uses floating point for amounts. You hand it bytes and get back the same result every time.

```ts
import { createLedger, importCsv, totals, explain } from '@folioflux/ledger-core';

const result = importCsv({ name: 'bank.csv', bytes }); // status: 'ok' | 'needs_mapping'
const ledger = createLedger([result]);
const byMonth = totals(ledger, { group_by: 'month' });
const why = explain(ledger, { ref: byMonth.groups[0].ref });
```

Main exports:

- `importCsv(input, { saved, overrides })`: reads one file with a saved mapping, overrides or detection. Returns `needs_mapping` with candidate answers instead of guessing.
- `createLedger(results, failures)`: sorted, order-independent set of transactions with an `input_hash`.
- `listTransactions`, `totals`, `cashflow`: queries with shared filters; every figure cites its rows and carries a `ref`.
- `explain(ledger, { ref } | { sources })`: the rows, original cells, mappings and recomputed sums behind a figure.
- Building blocks: `parseCsv`, `detectDelimiter`, `decodeCsvBytes`, `parseDate`, `parseAmount`, `detectColumns`, `parseMapping`, `canonicalJson`, `sha256Hex`.

## License

MIT
