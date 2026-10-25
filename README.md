# ledger-mcp

Deterministic finance tools for AI agents over your own CSV bank exports. Same answer twice, with the rows behind every number. Local and read-only.

`ledger-mcp` is a [Model Context Protocol](https://modelcontextprotocol.io) server that runs on your machine over stdio. Point it at a folder of CSV exports from your bank or card provider and your MCP client gets five tools: `import_csv`, `list_transactions`, `totals`, `cashflow` and `explain`.

The engine does the math; the model only explains it. Every number is computed with exact decimal arithmetic, is byte-for-byte reproducible for the same files, and cites the file and row numbers it came from.

## Contents

- [Quick start](#quick-start)
- [Connect a client](#connect-a-client)
- [How it works](#how-it-works)
- [Tool reference](#tool-reference)
- [Column mappings](#column-mappings)
- [Determinism](#determinism)
- [Security](#security)
- [Limitations](#limitations)
- [Development](#development)

## Quick start

Requirements: Node.js 22.12 or newer and [pnpm](https://pnpm.io) 10.

```sh
git clone https://github.com/folioflux/ledger-mcp.git
cd ledger-mcp
pnpm install
pnpm build
```

Try it on the synthetic sample files in [`fixtures/`](fixtures):

```sh
pnpm demo
```

This starts the built server, speaks MCP to it over stdio and prints the answers: a February cashflow figure and the exact rows behind it.

To use your own data, put your CSV exports in one folder (for example `~/finance/exports`) and run:

```sh
node packages/ledger-mcp/dist/cli.js --dir ~/finance/exports
```

The server waits for an MCP client on stdin/stdout, so in practice you let your client start it, as shown below.

## Connect a client

Replace `/path/to/ledger-mcp` with the folder you cloned and `/path/to/exports` with your CSV folder. Use absolute paths.

### Claude Desktop

Add this to `claude_desktop_config.json` (Settings → Developer → Edit Config) and restart Claude Desktop:

```json
{
  "mcpServers": {
    "ledger": {
      "command": "node",
      "args": ["/path/to/ledger-mcp/packages/ledger-mcp/dist/cli.js", "--dir", "/path/to/exports"]
    }
  }
}
```

### Claude Code

```sh
claude mcp add ledger -- node /path/to/ledger-mcp/packages/ledger-mcp/dist/cli.js --dir /path/to/exports
```

### Cursor

Add this to `~/.cursor/mcp.json` (all projects) or `.cursor/mcp.json` (one project):

```json
{
  "mcpServers": {
    "ledger": {
      "command": "node",
      "args": ["/path/to/ledger-mcp/packages/ledger-mcp/dist/cli.js", "--dir", "/path/to/exports"]
    }
  }
}
```

### Codex

```sh
codex mcp add ledger -- node /path/to/ledger-mcp/packages/ledger-mcp/dist/cli.js --dir /path/to/exports
```

or add this to `~/.codex/config.toml`:

```toml
[mcp_servers.ledger]
command = "node"
args = ["/path/to/ledger-mcp/packages/ledger-mcp/dist/cli.js", "--dir", "/path/to/exports"]
```

Then ask things like "What was my cashflow in February?" or "Show me the rows behind the Software total."

## How it works

1. On every call the server reads the `*.csv` files directly inside `--dir`.
2. For each file it decides the encoding, delimiter, columns, date format and decimal separator, in this order of precedence: a mapping you saved with `import_csv`, then plain detection rules. When anything is ambiguous (for example `03/04/2026` could be 3 April or 4 March) it does not guess. The file is reported with status `needs_mapping` and the open questions, and is left out of the numbers until you answer them.
3. Rows become normalized transactions (see [`@folioflux/transaction-schema`](packages/transaction-schema)) with exact decimal amounts and provenance: source file, SHA-256 of the file, row number and mapping id.
4. Query tools filter, group and sum those transactions and return decimal strings, the rows they used, and an `input_hash` that identifies the exact inputs.

The repository has three packages:

| Package                                                        | What it is                                                    |
| -------------------------------------------------------------- | ------------------------------------------------------------- |
| [`@folioflux/transaction-schema`](packages/transaction-schema) | JSON Schema and TypeScript types for a normalized transaction |
| [`@folioflux/ledger-core`](packages/ledger-core)               | Pure CSV parsing, mapping, querying and explanation (no I/O)  |
| [`@folioflux/ledger-mcp`](packages/ledger-mcp)                 | The MCP server and command line entry point                   |

## Tool reference

All tools return a single JSON text block. Amounts are decimal strings with at least two fraction digits: money in is positive, money out is negative. Different currencies are never added together; groups are always per currency.

Every query result starts with `input_hash` and also includes:

- `files`: one entry per CSV file with `status` (`ok`, `needs_mapping` or `error`), `mapping_id`, transaction and row error counts, and a message when the file was not used.
- `row_errors` (first 50) and `row_error_count`: rows that could not be read, with file, row number, column and value. They are never counted silently.

Row numbers count data rows from 1, starting after the header. Blank lines are skipped but still counted, so a row number always points at the same line of the file.

Errors are returned as tool errors with `{"error": {"code": "...", "message": "..."}}`.

### Shared filters

`list_transactions`, `totals` and `cashflow` accept:

| Argument   | Type               | Meaning                                                                   |
| ---------- | ------------------ | ------------------------------------------------------------------------- |
| `from`     | `YYYY-MM-DD`       | First date to include (inclusive)                                         |
| `to`       | `YYYY-MM-DD`       | Last date to include (inclusive)                                          |
| `text`     | string             | Case-insensitive substring of description, merchant or category           |
| `category` | string             | Exact value of the category column                                        |
| `account`  | string             | Exact account label                                                       |
| `currency` | string             | Three-letter ISO 4217 code                                                |
| `sign`     | `in`, `out`, `all` | Money in (amount > 0), money out (amount < 0) or both. Not on `cashflow`. |

### `import_csv`

Reads one file and shows how it will be interpreted: the detected or saved mapping, any open questions with candidate answers, row errors and a preview of normalized transactions. With `save: true` it writes the mapping to `.ledger-mcp/mappings/` so the query tools use it.

| Argument       | Type    | Meaning                                                                                                                  |
| -------------- | ------- | ------------------------------------------------------------------------------------------------------------------------ |
| `file`         | string  | Plain name of a `.csv` file directly inside `--dir` (required)                                                           |
| `mapping`      | object  | Overrides: `columns`, `date_format`, `decimal_separator`, `delimiter`, `encoding`, `default_currency`, `default_account` |
| `save`         | boolean | Save the resulting mapping. Refused while there are open questions                                                       |
| `preview_rows` | integer | Transactions to preview (default 5)                                                                                      |

The result includes `status` (`ok` or `needs_mapping`), `issues`, `mapping`, `mapping_id`, `header`, `sample` rows when a mapping is needed, `saved`, `mapping_path` and a `next_step` hint.

### `list_transactions`

Lists matching transactions in a fixed order (date, file name, row number) with `limit` (1 to 500, default 50) and `offset` paging. Returns `total_count`, `next_offset` and the transactions with their provenance.

### `totals`

Sums amounts by `group_by: "month"` or `group_by: "category"`, per currency. The category is the value of the category column in your CSV; rows without one are grouped under `null`, listed last. Each group has `key`, `currency`, `total`, `count`, `sources` (file and row numbers) and a `ref` for `explain`.

### `cashflow`

Money in, money out and net per calendar month and currency: `inflow` (sum of positive amounts), `outflow` (sum of negative amounts, so zero or negative) and `net`. Each month has `sources` and a `refs` object with one ref per figure.

### `explain`

Shows the exact rows behind a number, with the original CSV cells, the mapping and the file hashes, and recomputes the sum from those rows.

| Argument     | Type   | Meaning                                                                                     |
| ------------ | ------ | ------------------------------------------------------------------------------------------- |
| `ref`        | string | A `ref` from `totals` or `cashflow`                                                         |
| `sources`    | array  | Or explicit rows: `[{"file": "...", "rows": [1, 2]}]`, for example from `list_transactions` |
| `input_hash` | string | The `input_hash` of the result being explained, to detect changed inputs                    |

The result has `figure` (tool, query, group, field, currency and reported value), `sums` per currency, `sum_matches_figure`, `input_hash_matches`, `rows` and `files`.

A `ref` is self-contained: it encodes the query and the figure, so `explain` recomputes the figure from the current files. If the files changed, `input_hash_matches` is `false`, and if the figure no longer exists you get a `NOT_FOUND` error.

## Column mappings

Detection recognizes common English header names, for example `Date`, `Transaction Date`, `Description`, `Payee`, `Amount`, `Money In` / `Money Out`, `Debit` / `Credit`, `Currency`, `Category` and `Account`. A file can have either one signed amount column or a debit/credit pair (read as amounts: credit minus debit).

Supported formats:

- Encodings: UTF-8 (with or without BOM) and Windows-1252.
- Delimiters: `,` `;` tab `|`.
- Dates: `YYYY-MM-DD` (a time suffix is ignored), `YYYY/MM/DD`, `DD.MM.YYYY`, `DD/MM/YYYY`, `MM/DD/YYYY`, `DD-MM-YYYY`.
- Amounts: `.` or `,` decimal separator, thousands grouping with `,` `.` spaces or `'`, a leading or trailing minus, parentheses for negatives, and a currency symbol or code next to the number.

If your headers use other names or another language, map them once:

```json
{
  "file": "my-bank.csv",
  "mapping": {
    "columns": { "date": "Buchungstag", "description": "Verwendungszweck", "amount": "Betrag" },
    "date_format": "DD.MM.YYYY",
    "decimal_separator": ",",
    "default_currency": "EUR"
  },
  "save": true
}
```

Saved mappings are plain JSON files named after the SHA-256 of the header row, in `<dir>/.ledger-mcp/mappings/`. Every file with the same header layout uses the same mapping, so new monthly exports from the same bank work without further steps. You can review, edit or delete these files; the server validates them on every read.

## Determinism

For the same CSV files and mappings, every tool returns the same bytes:

- Amounts use exact decimal arithmetic, never floating point. A lint rule and a test keep `parseFloat`, `Number()`, locale functions, the clock and random numbers out of the core.
- Sorting compares strings by code units, never by locale, and transactions are always ordered by date, file name and row number. The order files are read in does not matter.
- Output JSON has a fixed key order, and nothing depends on the time zone, the locale or the current date.
- `input_hash` is the SHA-256 of the file names, file hashes and mapping ids. Change one byte of one file and it changes.

The test suite checks this with repeated runs, shuffled inputs, golden files compared byte for byte, and the built server run under several time zones and locales.

## Security

- **Local.** The server runs on your machine and talks to your MCP client over stdio only. It opens no ports and makes no network requests; the test suite runs the built server with networking disabled and fails on any attempt.
- **Read-only for your data.** CSV files are only read. The only write is a mapping file under `<dir>/.ledger-mcp/mappings/`, and only when you call `import_csv` with `save: true`.
- **Confined to one folder.** Only regular `*.csv` files directly inside `--dir` are read: no subfolders, no symlinks, no paths in file names, no hidden files. Files over 50 MiB and folders with more than 1000 CSV files are refused.
- **No telemetry**, no accounts and no keys.

Your MCP client still sends tool results to whichever model it uses. Point `--dir` at a folder that contains only the exports you are willing to share with it.

## Limitations

- Header detection knows English names only. Other layouts work after you save a mapping.
- UTF-16 files are not supported; re-save them as UTF-8.
- Duplicate rows are not detected. If two exports overlap in time, the overlapping transactions are counted twice, so export non-overlapping periods.
- Amounts in different currencies are kept apart and never converted.
- The folder is re-read on every call. This keeps answers in step with the files and suits personal and small-business volumes.
- Not yet published to a package registry; run it from a clone as shown above.

## Development

```sh
pnpm install
pnpm check          # format check, build, lint, typecheck, tests
pnpm test           # tests only (the stdio test needs a prior build)
pnpm golden:update  # rewrite fixtures/expected after an intended output change
pnpm demo           # scripted MCP session against the built server
```

All sample data in this repository is synthetic. Please never commit real bank exports.

## License

[MIT](LICENSE)

---

Built by the FolioFlux team. FolioFlux is the AI finance workspace for freelancers, small teams and their accountants: https://folioflux.com

Not financial, tax, accounting or legal advice.
