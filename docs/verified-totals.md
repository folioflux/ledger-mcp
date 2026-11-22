# Verify totals with same-answer-twice

Run an actual `totals` call over MCP stdio three times, then compare every answer
with a fixed expected result using
[same-answer-twice](https://github.com/folioflux/same-answer-twice).
Everything after installation runs locally, with the already published synthetic
CSVs in `fixtures/`. No model, account, API key or real bank export is needed.

## Build the source checkouts

Use Node.js 24 and pnpm **10.34.8** (the `packageManager` pin in both repositories).
Neither package needs to be installed from npm. Starting in this `ledger-mcp`
checkout, clone the companion beside it and pin its public v0.1.0 source commit:

```sh
pnpm install --frozen-lockfile
pnpm build

git clone https://github.com/folioflux/same-answer-twice.git ../same-answer-twice
git -C ../same-answer-twice checkout --detach b87fb9a3c1816f1fb2749c02c8642213c8bb39b8
(cd ../same-answer-twice && pnpm install --frozen-lockfile && pnpm build)
```

The ledger fixture bytes and server behavior used here originate at public commit
[`2eff6cf`](https://github.com/folioflux/ledger-mcp/commit/2eff6cf664c86b887ce41184ea868fc77fd311c9).
Use a checkout containing this guide and its script; the older commit does not
contain the quickstart itself. Keep the fixture bytes unchanged, including their
encodings and line endings.

## Check repeatability and correctness

From the `ledger-mcp` root:

```sh
node scripts/totals-answer.mjs
node ../same-answer-twice/dist/cli.js run --runs 3 \
  --expected docs/totals-expected.json -- node scripts/totals-answer.mjs
```

The script initializes a fresh built MCP server for each run and calls `totals`
with `group_by: "month"`, January 2026 inclusive and `currency: "EUR"`. It prints
one JSON answer to stdout; server diagnostics stay on stderr. Transport and tool
errors fail the command, and a ten-second session deadline prevents a hung run.

The expected answer is checked in, not generated from the current run:

- **Total:** `"2119.11"` EUR, from `2400.00 - 180.00 - 24.99 - 63.40 - 8.00 - 4.50`.
- **Provenance:** six transactions, `alder-bank-current.csv` data rows 1–6
  (the header is not a data row).
- **Input hash:** `00d4581aad3259dc7e50c390a4d66b14d6e3c56f6a3d339813e5700e9d7d8edf`.
- **Import health:** all three top-level fixture files have status `ok`, with zero
  row errors. The nested `needs-mapping/` fixture is not read by the server.

The projection omits opaque figure refs, but preserves exact decimal strings,
row provenance, input hash and import health. No tolerance or ignored path is
used. The input hash covers all top-level CSV files and their mappings, including
files excluded by the EUR/date filter. It is different from same-answer-twice's
answer hash, which hashes the complete projected JSON answer.

A successful report says `CONSISTENT (3 runs, 1 distinct answer)` and confirms
that all runs match the expected answer; exit status is **0**. A mismatch or failed
run exits **1**; CLI usage errors exit **2**. Repeatability alone is not correctness:
the fixed `--expected` comparison also catches a consistently wrong result.

To see that failure without changing any fixture or the checked-in expectation:

```sh
node -e 'const fs = require("node:fs"); const a = JSON.parse(fs.readFileSync("docs/totals-expected.json", "utf8")); a.groups[0].total = "0.00"; fs.writeFileSync("/tmp/ledger-wrong-expected.json", JSON.stringify(a));'
node ../same-answer-twice/dist/cli.js run --runs 3 \
  --expected /tmp/ledger-wrong-expected.json -- node scripts/totals-answer.mjs
```

This must exit **1** and report the difference at `$.groups[0].total`, even though
all three runs agree with one another. Do not refresh the expected answer just to
make a failure disappear: inspect changed fixture bytes, mappings and results.

`pnpm check` also exercises this script against the fixed expected answer without
requiring the companion checkout. The cross-repo CLI command above is an explicit
integration check, not a new project dependency.
