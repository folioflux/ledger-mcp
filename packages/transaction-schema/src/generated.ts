/* eslint-disable */
// This file is generated from transaction.schema.json by scripts/generate.mjs.
// Do not edit it by hand: change the schema and run `pnpm --filter @folioflux/transaction-schema generate`.

/**
 * A normalized bank or card transaction read from a CSV export, with the provenance needed to trace it back to its source row. Schema version 0.1.0.
 */
export interface Transaction {
  /**
   * Deterministic identifier derived from the source file hash and the row number: "tx_" followed by the first 24 hex characters of sha256("<source_sha256>:<row_number>").
   */
  id: string;
  /**
   * Calendar date of the transaction (ISO 8601, YYYY-MM-DD). No time and no time zone.
   */
  date: string;
  /**
   * Signed decimal amount as a string. Money in is positive, money out is negative. At least two fraction digits, no exponent, no thousands separators.
   */
  amount: string;
  /**
   * Three-letter ISO 4217 currency code, upper case.
   */
  currency: string;
  /**
   * Free-text description from the export. Empty string when the export has none.
   */
  description: string;
  /**
   * Merchant, payee or counterparty exactly as it appears in the export (trimmed), or null.
   */
  merchant: string | null;
  /**
   * Category exactly as supplied by a column in the user's CSV, or null. Never inferred.
   */
  category: string | null;
  /**
   * Account label from a CSV column or from the mapping's default account, or null.
   */
  account: string | null;
  provenance: Provenance;
}
/**
 * Where a transaction came from.
 */
export interface Provenance {
  /**
   * File name of the CSV export, relative to the exports folder.
   */
  source_file: string;
  /**
   * SHA-256 of the raw bytes of the source file, lower-case hex.
   */
  source_sha256: string;
  /**
   * 1-based data row number. The header is not counted, so row 1 is the first record after the header.
   */
  row_number: number;
  /**
   * Identifier of the column mapping used to read the row: "map_" followed by the first 16 hex characters of the SHA-256 of the mapping's canonical JSON.
   */
  mapping_id: string;
}

/** The transaction JSON Schema (draft 2020-12) as a plain object. */
export const transactionSchema = {
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://github.com/folioflux/ledger-mcp/blob/v0.1.0/packages/transaction-schema/transaction.schema.json",
  "title": "Transaction",
  "description": "A normalized bank or card transaction read from a CSV export, with the provenance needed to trace it back to its source row. Schema version 0.1.0.",
  "type": "object",
  "additionalProperties": false,
  "required": [
    "id",
    "date",
    "amount",
    "currency",
    "description",
    "merchant",
    "category",
    "account",
    "provenance"
  ],
  "properties": {
    "id": {
      "description": "Deterministic identifier derived from the source file hash and the row number: \"tx_\" followed by the first 24 hex characters of sha256(\"<source_sha256>:<row_number>\").",
      "type": "string",
      "pattern": "^tx_[0-9a-f]{24}$"
    },
    "date": {
      "description": "Calendar date of the transaction (ISO 8601, YYYY-MM-DD). No time and no time zone.",
      "type": "string",
      "format": "date",
      "pattern": "^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$"
    },
    "amount": {
      "description": "Signed decimal amount as a string. Money in is positive, money out is negative. At least two fraction digits, no exponent, no thousands separators.",
      "type": "string",
      "pattern": "^-?(0|[1-9][0-9]*)\\.[0-9]{2,}$"
    },
    "currency": {
      "description": "Three-letter ISO 4217 currency code, upper case.",
      "type": "string",
      "pattern": "^[A-Z]{3}$"
    },
    "description": {
      "description": "Free-text description from the export. Empty string when the export has none.",
      "type": "string"
    },
    "merchant": {
      "description": "Merchant, payee or counterparty exactly as it appears in the export (trimmed), or null.",
      "type": [
        "string",
        "null"
      ]
    },
    "category": {
      "description": "Category exactly as supplied by a column in the user's CSV, or null. Never inferred.",
      "type": [
        "string",
        "null"
      ]
    },
    "account": {
      "description": "Account label from a CSV column or from the mapping's default account, or null.",
      "type": [
        "string",
        "null"
      ]
    },
    "provenance": {
      "$ref": "#/$defs/Provenance"
    }
  },
  "$defs": {
    "Provenance": {
      "title": "Provenance",
      "description": "Where a transaction came from.",
      "type": "object",
      "additionalProperties": false,
      "required": [
        "source_file",
        "source_sha256",
        "row_number",
        "mapping_id"
      ],
      "properties": {
        "source_file": {
          "description": "File name of the CSV export, relative to the exports folder.",
          "type": "string",
          "minLength": 1
        },
        "source_sha256": {
          "description": "SHA-256 of the raw bytes of the source file, lower-case hex.",
          "type": "string",
          "pattern": "^[0-9a-f]{64}$"
        },
        "row_number": {
          "description": "1-based data row number. The header is not counted, so row 1 is the first record after the header.",
          "type": "integer",
          "minimum": 1
        },
        "mapping_id": {
          "description": "Identifier of the column mapping used to read the row: \"map_\" followed by the first 16 hex characters of the SHA-256 of the mapping's canonical JSON.",
          "type": "string",
          "pattern": "^map_[0-9a-f]{16}$"
        }
      }
    }
  }
} as const;
