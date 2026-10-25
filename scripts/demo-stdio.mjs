// Scripted MCP session over stdio against the built server, using raw JSON-RPC
// messages so the wire protocol is visible. Read-only: it never saves a mapping.
//
// Usage: pnpm build && node scripts/demo-stdio.mjs [exports-folder]
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const dir = process.argv[2] ?? `${root}fixtures`;
const cli = `${root}packages/ledger-mcp/dist/cli.js`;

const child = spawn(process.execPath, [cli, '--dir', dir], { stdio: ['pipe', 'pipe', 'inherit'] });
const lines = createInterface({ input: child.stdout });
const pending = new Map();
lines.on('line', (line) => {
  const message = JSON.parse(line);
  pending.get(message.id)?.(message);
  pending.delete(message.id);
});

let nextId = 1;
function request(method, params) {
  const id = nextId++;
  child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
  return new Promise((resolve) => pending.set(id, resolve));
}

function show(title, value) {
  process.stdout.write(
    `\n## ${title}\n\n${typeof value === 'string' ? value : JSON.stringify(value, null, 2)}\n`,
  );
}

const init = await request('initialize', {
  protocolVersion: '2025-11-25',
  capabilities: {},
  clientInfo: { name: 'demo-stdio', version: '0.0.0' },
});
show('initialize → serverInfo', init.result.serverInfo);
child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);

const tools = await request('tools/list', {});
show(
  'tools/list',
  tools.result.tools
    .map((tool) => `${tool.name}  readOnlyHint=${tool.annotations?.readOnlyHint}`)
    .join('\n'),
);

const call = async (name, args) => {
  const response = await request('tools/call', { name, arguments: args });
  return JSON.parse(response.result.content[0].text);
};

const cashflow = await call('cashflow', { from: '2026-02-01', to: '2026-02-28', currency: 'EUR' });
show('tools/call cashflow {from: 2026-02-01, to: 2026-02-28, currency: EUR}', {
  input_hash: cashflow.input_hash,
  months: cashflow.months.map((month) => ({ ...month, refs: '(omitted)' })),
});

const ref = cashflow.months[0].refs.outflow;
const explained = await call('explain', { ref, input_hash: cashflow.input_hash });
show('tools/call explain {ref: <February EUR outflow>, input_hash}', {
  figure: explained.figure,
  sums: explained.sums,
  sum_matches_figure: explained.sum_matches_figure,
  input_hash_matches: explained.input_hash_matches,
  rows: explained.rows.map(
    (row) =>
      `${row.file}#${row.row_number}  ${row.date}  ${row.amount} ${row.currency}  ${row.description}`,
  ),
});

child.stdin.end();
child.kill();
