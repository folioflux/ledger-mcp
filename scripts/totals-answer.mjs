// One machine-readable answer from a real MCP stdio session. Synthetic fixtures only.
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const child = spawn(
  process.execPath,
  [`${root}packages/ledger-mcp/dist/cli.js`, '--dir', `${root}fixtures`],
  { stdio: ['pipe', 'pipe', 'inherit'] },
);
const lines = createInterface({ input: child.stdout });
const pending = new Map();
let nextId = 1;
function fail(error) {
  for (const { reject } of pending.values()) reject(error);
  pending.clear();
}
child.on('error', fail);
child.on('exit', (code) => fail(new Error(`MCP server exited (${code})`)));
child.stdin.on('error', fail);
lines.on('line', (line) => {
  try {
    const message = JSON.parse(line);
    const waiter = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) waiter?.reject(new Error(JSON.stringify(message.error)));
    else waiter?.resolve(message.result);
  } catch (error) {
    fail(error);
  }
});
function request(method, params) {
  return new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve, reject });
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
  });
}
const timeout = setTimeout(() => fail(new Error('MCP session timed out after 10 seconds')), 10_000);
try {
  await request('initialize', {
    protocolVersion: '2025-11-25',
    capabilities: {},
    clientInfo: { name: 'totals-answer', version: '0.0.0' },
  });
  child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);
  const result = await request('tools/call', {
    name: 'totals',
    arguments: { group_by: 'month', from: '2026-01-01', to: '2026-01-31', currency: 'EUR' },
  });
  if (result.isError) throw new Error(JSON.stringify(result.content));
  const answer = JSON.parse(result.content[0].text);
  // Keep exact decimal strings, provenance and input identity; omit opaque refs from groups.
  process.stdout.write(
    `${JSON.stringify({
      input_hash: answer.input_hash,
      groups: answer.groups.map(({ ref: _ref, ...group }) => group),
      row_error_count: answer.row_error_count,
      files: answer.files.map(({ file, status }) => ({ file, status })),
    })}\n`,
  );
} finally {
  clearTimeout(timeout);
  lines.close();
  child.stdin.end();
  child.kill();
}
