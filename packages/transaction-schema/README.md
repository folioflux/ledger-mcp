# @folioflux/transaction-schema

JSON Schema (draft 2020-12) and TypeScript types for a normalized bank or card transaction, as produced by [ledger-mcp](../../README.md).

- Schema: [`transaction.schema.json`](transaction.schema.json), also exported as `transactionSchema`.
- Types: `Transaction` and `Provenance`, generated from the schema by `scripts/generate.mjs`. The build fails if the generated file is out of date.

```ts
import type { Transaction } from '@folioflux/transaction-schema';
import { transactionSchema, TRANSACTION_SCHEMA_VERSION } from '@folioflux/transaction-schema';
```

## Fields

Every field is required; optional values are `null`, never missing. No other properties are allowed.

| Field         | Type           | Meaning                                                                                                  |
| ------------- | -------------- | -------------------------------------------------------------------------------------------------------- |
| `id`          | string         | `tx_` + first 24 hex characters of `sha256("<source_sha256>:<row_number>")`. Same file and row, same id. |
| `date`        | string         | Calendar date, `YYYY-MM-DD`. No time and no time zone.                                                   |
| `amount`      | string         | Signed decimal. Money in is positive, money out is negative. At least two fraction digits, no exponent.  |
| `currency`    | string         | Three-letter ISO 4217 code, upper case.                                                                  |
| `description` | string         | Free text from the export; empty string when there is none.                                              |
| `merchant`    | string \| null | Merchant, payee or counterparty as it appears in the export.                                             |
| `category`    | string \| null | Category from a column in the CSV. Never inferred.                                                       |
| `account`     | string \| null | Account label from a column or from the mapping's default account.                                       |
| `provenance`  | object         | Where the transaction came from (below).                                                                 |

### `provenance`

| Field           | Type    | Meaning                                                                  |
| --------------- | ------- | ------------------------------------------------------------------------ |
| `source_file`   | string  | File name of the CSV export, relative to the exports folder.             |
| `source_sha256` | string  | SHA-256 of the raw bytes of the file, lower-case hex.                    |
| `row_number`    | integer | 1-based data row number. The header is not counted; blank lines are.     |
| `mapping_id`    | string  | `map_` + 16 hex characters identifying the mapping used to read the row. |

Amounts are strings on purpose: JSON numbers are read as binary floating point by most parsers, which cannot represent most decimal amounts exactly.

## Example

```json
{
  "id": "tx_3f5c0a9e1b2d4c6e8f7a9b0c",
  "date": "2026-02-05",
  "amount": "-24.99",
  "currency": "EUR",
  "description": "Hosting plan, monthly",
  "merchant": "Pixelcloud Hosting",
  "category": "Software",
  "account": null,
  "provenance": {
    "source_file": "alder-bank-current.csv",
    "source_sha256": "912c6cbbdceb136f0fcce2706d8e78d9d0869ef59697de814150ea75b42bb723",
    "row_number": 9,
    "mapping_id": "map_0d1e2f3a4b5c6d7e"
  }
}
```

## Versioning

The schema version is `TRANSACTION_SCHEMA_VERSION` and appears in the `$id`. Adding, removing or changing the meaning of a field is a new version.

## License

MIT
