# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.1.0] - 2026-10-25

### Added

- `ledger-mcp` stdio MCP server with a `--dir` exports folder.
- `import_csv`: detects encoding, delimiter, columns, date format and decimal separator, previews the result, reports open questions instead of guessing, and saves a confirmed mapping.
- `list_transactions` with date range, text, sign, category, account and currency filters and paging.
- `totals` by month or by the CSV category column, per currency.
- `cashflow`: monthly money in, money out and net per currency.
- `explain`: the rows, original cells, mappings and file hashes behind any figure, with the recomputed sum.
- `@folioflux/transaction-schema`: JSON Schema and TypeScript types for a normalized transaction with provenance.
- `@folioflux/ledger-core`: pure parsing, mapping and query engine with exact decimal arithmetic.
- Determinism tests (repeated runs, shuffled inputs, golden files, time zones and locales) and a network guard for the built server.

[Unreleased]: https://github.com/folioflux/ledger-mcp/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/folioflux/ledger-mcp/releases/tag/v0.1.0
