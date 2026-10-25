import type { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod';
import type { ImportResult, MappingOverrides } from '@folioflux/ledger-core';
import {
  cashflow,
  COLUMN_ROLES,
  CSV_DELIMITERS,
  CSV_ENCODINGS,
  DATE_FORMATS,
  DECIMAL_SEPARATORS,
  explain,
  importCsv,
  LedgerError,
  LIST_DEFAULT_LIMIT,
  LIST_MAX_LIMIT,
  listTransactions,
  totals,
} from '@folioflux/ledger-core';
import type { Workspace } from './workspace.js';

/** Tool result in the shape the MCP SDK expects. */
interface ToolResult {
  [key: string]: unknown;
  content: { type: 'text'; text: string }[];
  isError?: boolean;
}

/** Results are pretty-printed JSON; key order is fixed by construction, so output is byte-stable. */
export function toJson(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

function ok(value: unknown): ToolResult {
  return { content: [{ type: 'text', text: toJson(value) }] };
}

function failure(error: unknown): ToolResult {
  const body =
    error instanceof LedgerError
      ? { error: { code: error.code, message: error.message } }
      : {
          error: {
            code: 'INTERNAL_ERROR',
            message: error instanceof Error ? error.message : String(error),
          },
        };
  return { content: [{ type: 'text', text: toJson(body) }], isError: true };
}

async function run(task: () => Promise<unknown>): Promise<ToolResult> {
  try {
    return ok(await task());
  } catch (error) {
    return failure(error);
  }
}

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');

const filterShape = {
  from: isoDate.optional().describe('First date to include, YYYY-MM-DD (inclusive).'),
  to: isoDate.optional().describe('Last date to include, YYYY-MM-DD (inclusive).'),
  text: z
    .string()
    .max(200)
    .optional()
    .describe('Case-insensitive substring matched against description, merchant and category.'),
  category: z
    .string()
    .max(200)
    .optional()
    .describe('Exact category value as it appears in the CSV.'),
  account: z.string().max(200).optional().describe('Exact account label.'),
  currency: z
    .string()
    .regex(/^[A-Za-z]{3}$/)
    .optional()
    .describe('Three-letter ISO 4217 currency code, for example EUR.'),
};

const signShape = {
  sign: z
    .enum(['in', 'out', 'all'])
    .optional()
    .describe(
      '"in" keeps money in (amount > 0), "out" keeps money out (amount < 0). Default "all".',
    ),
};

const readOnly = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
};

const SHARED_NOTE =
  'Amounts are exact decimal strings (money in positive, money out negative) and different currencies are never added together. ' +
  'Every result carries input_hash (identifies the exact files and mappings used) and per-file status; files that need a mapping are listed, not silently dropped.';

function importSummary(result: ImportResult, previewRows: number) {
  return {
    file: result.file,
    source_sha256: result.source_sha256,
    status: result.status,
    mapping_source: result.mapping_source,
    overrides_applied: result.overrides_applied,
    issues: result.issues,
    mapping: result.mapping,
    mapping_id: result.mapping_id,
    header: result.header,
    data_row_count: result.data_row_count,
    transaction_count: result.rows.length,
    row_error_count: result.row_errors.length,
    row_errors: result.row_errors.slice(0, 20),
    preview: result.rows.slice(0, previewRows).map((row) => row.transaction),
    sample: result.status === 'needs_mapping' ? result.sample : [],
  };
}

/** Registers the five ledger tools on an MCP server. */
export function registerTools(server: McpServer, workspace: Workspace): void {
  server.registerTool(
    'import_csv',
    {
      title: 'Import a CSV export',
      description:
        'Inspect one CSV bank or card export in the exports folder: detects encoding, delimiter, columns, date format and decimal separator with plain rules, ' +
        'and returns the mapping, any open questions ("needs_mapping" issues with candidates) and a preview of normalized transactions. ' +
        'Nothing ambiguous is guessed. Pass "mapping" to override or fill in fields. With save: true and a complete mapping, writes it to ' +
        '.ledger-mcp/mappings/<header_sha256>.json in the exports folder so other tools reuse it for every file with the same header. ' +
        'Never modifies CSV files; saving the mapping is the only write this server makes.',
      inputSchema: z.object({
        file: z
          .string()
          .min(1)
          .max(255)
          .describe('Plain file name of a .csv directly inside the exports folder.'),
        mapping: z
          .object({
            columns: z
              .object(
                Object.fromEntries(
                  COLUMN_ROLES.map((role) => [
                    role,
                    z
                      .string()
                      .max(200)
                      .nullable()
                      .optional()
                      .describe(`Exact header text of the ${role} column, or null for none.`),
                  ]),
                ) as Record<
                  (typeof COLUMN_ROLES)[number],
                  z.ZodOptional<z.ZodNullable<z.ZodString>>
                >,
              )
              .strict()
              .optional()
              .describe('Columns by exact header text. Use either amount, or debit and credit.'),
            delimiter: z.enum(CSV_DELIMITERS).optional(),
            encoding: z.enum(CSV_ENCODINGS).optional(),
            date_format: z.enum(DATE_FORMATS).optional(),
            decimal_separator: z.enum(DECIMAL_SEPARATORS).optional(),
            default_currency: z
              .string()
              .regex(/^[A-Z]{3}$/)
              .nullable()
              .optional()
              .describe('ISO 4217 code used when the file has no currency column.'),
            default_account: z
              .string()
              .max(200)
              .nullable()
              .optional()
              .describe('Account label for every row of this layout.'),
          })
          .strict()
          .optional()
          .describe('Overrides applied on top of the saved or detected mapping.'),
        save: z
          .boolean()
          .optional()
          .describe(
            'Write the mapping file. Only allowed when the result status is "ok". Default false.',
          ),
        preview_rows: z
          .number()
          .int()
          .min(0)
          .max(50)
          .optional()
          .describe('Transactions to preview. Default 5.'),
      }),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ file, mapping, save, preview_rows }) =>
      run(async () => {
        const input = await workspace.readCsv(file);
        const saved = await workspace.findMappingFor(input);
        const result = importCsv(input, {
          saved,
          overrides: mapping as MappingOverrides | undefined,
        });
        let mapping_path: string | null = null;
        if (save === true) {
          if (result.status !== 'ok') {
            throw new LedgerError(
              'INVALID_MAPPING',
              'The mapping is not complete, so it was not saved. Resolve the issues first (call import_csv without save to see them).',
            );
          }
          mapping_path = await workspace.saveMapping(result.mapping);
        }
        const existing =
          result.status === 'ok' && result.mapping_source === 'saved' && !result.overrides_applied;
        const next_step =
          result.status === 'needs_mapping'
            ? 'Resolve each issue by calling import_csv again with a "mapping" object (for example {"date_format": "DD/MM/YYYY"} or {"default_currency": "EUR"}), then call it with save: true.'
            : mapping_path !== null
              ? 'Mapping saved. list_transactions, totals, cashflow and explain now read this file with it.'
              : existing
                ? 'This file already uses a saved mapping. Pass "mapping" overrides with save: true to change it.'
                : 'The detected mapping is complete and is used automatically. Call import_csv with save: true to keep it (recommended, so later detection changes cannot alter results), or pass "mapping" overrides to correct it.';
        return {
          ...importSummary(result, preview_rows ?? 5),
          saved: mapping_path !== null,
          mapping_path,
          next_step,
        };
      }),
  );

  server.registerTool(
    'list_transactions',
    {
      title: 'List transactions',
      description:
        'List transactions from every CSV in the exports folder, filtered by date range, text, sign, category, account or currency. ' +
        'Sorted by date, then file name, then row number; each transaction includes its provenance (file, row number, file SHA-256, mapping id). ' +
        `Paginate with limit (default ${LIST_DEFAULT_LIMIT}, max ${LIST_MAX_LIMIT}) and offset; next_offset is null on the last page. ${SHARED_NOTE}`,
      inputSchema: z.object({
        ...filterShape,
        ...signShape,
        limit: z
          .number()
          .int()
          .min(1)
          .max(LIST_MAX_LIMIT)
          .optional()
          .describe(`Page size. Default ${LIST_DEFAULT_LIMIT}.`),
        offset: z.number().int().min(0).optional().describe('Rows to skip. Default 0.'),
      }),
      annotations: readOnly,
    },
    async (args) => run(async () => listTransactions(await workspace.loadLedger(), args)),
  );

  server.registerTool(
    'totals',
    {
      title: 'Totals by month or category',
      description:
        'Sum amounts grouped by month (YYYY-MM) or by the category column of your CSV (no categories are inferred; rows without one have key null). ' +
        'One group per key and currency, ordered by key (null last) then currency. Each group lists its source rows and a ref to pass to explain. ' +
        SHARED_NOTE,
      inputSchema: z.object({
        group_by: z
          .enum(['month', 'category'])
          .describe('Group by calendar month or by the CSV category value.'),
        ...filterShape,
        ...signShape,
      }),
      annotations: readOnly,
    },
    async (args) => run(async () => totals(await workspace.loadLedger(), args)),
  );

  server.registerTool(
    'cashflow',
    {
      title: 'Monthly cashflow',
      description:
        'Money in (sum of amounts > 0), money out (sum of amounts < 0, reported as a negative number) and net per month and currency, ordered by month then currency. ' +
        'Each month lists its source rows and a ref per figure to pass to explain. ' +
        SHARED_NOTE,
      inputSchema: z.object(filterShape),
      annotations: readOnly,
    },
    async (args) => run(async () => cashflow(await workspace.loadLedger(), args)),
  );

  server.registerTool(
    'explain',
    {
      title: 'Explain a number',
      description:
        'Show the exact rows behind a number: pass the "ref" of a totals or cashflow figure, or "sources" (file and row numbers) from any result. ' +
        'Returns each row with its original CSV cells, the mapping and SHA-256 of every file involved, the recomputed sum per currency, and whether it equals the reported figure. ' +
        'Pass input_hash from the original result to check the data has not changed since.',
      inputSchema: z.object({
        ref: z
          .string()
          .min(1)
          .max(8192)
          .optional()
          .describe('The "ref" value of a totals group or a cashflow figure.'),
        sources: z
          .array(
            z.object({
              file: z.string().min(1).max(255),
              rows: z.array(z.number().int().min(1)).min(1).max(5000),
            }),
          )
          .min(1)
          .max(1000)
          .optional()
          .describe('Rows to explain, grouped by file, as returned in "sources".'),
        input_hash: z
          .string()
          .regex(/^[0-9a-f]{64}$/)
          .optional()
          .describe('input_hash of the result being explained.'),
      }),
      annotations: readOnly,
    },
    async (args) => run(async () => explain(await workspace.loadLedger(), args)),
  );
}
