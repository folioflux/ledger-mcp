# Fixtures

Synthetic CSV exports used by the tests and the demo. All names, merchants and amounts are invented.

| File                                        | What it exercises                                                                                                        |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `alder-bank-current.csv`                    | UTF-8 with BOM, CRLF line endings, ISO dates, one signed amount column, quoted commas and quotes, empty categories (EUR) |
| `birch-card.csv`                            | LF line endings, `DD/MM/YYYY` dates, money out / money in columns, thousands separators (GBP)                            |
| `cedar-savings.csv`                         | Windows-1252, semicolons, `DD.MM.YYYY` dates, decimal comma, an account column (PLN)                                     |
| `needs-mapping/dogwood-ambiguous-dates.csv` | Dates that fit both `DD/MM/YYYY` and `MM/DD/YYYY` and no currency, so it needs a mapping                                 |

`expected/` holds golden output for a fixed set of queries over these files (see `packages/ledger-core/test/scenario.ts`). The tests compare it byte for byte. After an intended output change, run `pnpm golden:update` and review the diff.

The CSV files are stored byte for byte (`-text` in `.gitattributes`) so line endings and encodings stay as they are.
