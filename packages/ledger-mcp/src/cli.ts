#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import { createLedgerServer } from './server.js';
import { VERSION } from './version.js';

const HELP = `ledger-mcp ${VERSION}
Local, read-only MCP server with deterministic finance tools over CSV bank exports.

Usage:
  ledger-mcp --dir <exports-folder>

Options:
  --dir <path>   Folder that holds your CSV exports (required). Only *.csv files
                 directly inside it are read. Confirmed column mappings are
                 stored in <path>/.ledger-mcp/mappings/.
  --help         Show this help.
  --version      Show the version.

The server speaks MCP over stdio. It makes no network requests and never
modifies your CSV files.`;

async function main(): Promise<void> {
  let values: {
    dir?: string | undefined;
    help?: boolean | undefined;
    version?: boolean | undefined;
  };
  try {
    ({ values } = parseArgs({
      options: {
        dir: { type: 'string' },
        help: { type: 'boolean', short: 'h' },
        version: { type: 'boolean', short: 'v' },
      },
      strict: true,
      allowPositionals: false,
    }));
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n\n${HELP}\n`);
    process.exitCode = 2;
    return;
  }
  if (values.help === true) {
    process.stdout.write(`${HELP}\n`);
    return;
  }
  if (values.version === true) {
    process.stdout.write(`${VERSION}\n`);
    return;
  }
  if (values.dir === undefined || values.dir === '') {
    process.stderr.write(`Missing --dir.\n\n${HELP}\n`);
    process.exitCode = 2;
    return;
  }

  const server = await createLedgerServer({ dir: values.dir });
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // stdout carries the protocol; diagnostics go to stderr.
  process.stderr.write(`ledger-mcp ${VERSION} ready (exports folder: ${values.dir})\n`);
}

main().catch((error: unknown) => {
  process.stderr.write(`ledger-mcp: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
