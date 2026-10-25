import { McpServer } from '@modelcontextprotocol/server';
import { registerTools } from './tools.js';
import { VERSION } from './version.js';
import { Workspace } from './workspace.js';

export const INSTRUCTIONS =
  'ledger-mcp reads CSV bank and card exports from one local folder and answers with deterministic tools. ' +
  'Let the tools do all arithmetic: quote their decimal strings as they are, never add amounts in different currencies, ' +
  'and cite the source rows (file and row numbers) or use explain when presenting a number. ' +
  'If a file is listed with status "needs_mapping", call import_csv for it and ask the user to confirm the mapping before saving it.';

/** Creates an MCP server exposing the ledger tools over one exports folder. */
export async function createLedgerServer(options: { dir: string }): Promise<McpServer> {
  const workspace = await Workspace.open(options.dir);
  const server = new McpServer(
    { name: 'ledger-mcp', title: 'ledger-mcp', version: VERSION },
    { instructions: INSTRUCTIONS },
  );
  registerTools(server, workspace);
  return server;
}
