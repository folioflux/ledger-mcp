import { copyFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { createLedgerServer } from '../src/index.js';

export const FIXTURES = fileURLToPath(new URL('../../../fixtures/', import.meta.url));

export const FIXTURE_FILES = [
  'alder-bank-current.csv',
  'birch-card.csv',
  'cedar-savings.csv',
  'needs-mapping/dogwood-ambiguous-dates.csv',
];

/** Copies the fixtures flat into a fresh temporary exports folder. */
export function makeExportsDir(files: readonly string[] = FIXTURE_FILES): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'ledger-mcp-test-'));
  for (const file of files)
    copyFileSync(path.join(FIXTURES, file), path.join(dir, path.basename(file)));
  return dir;
}

export function removeDir(dir: string): void {
  rmSync(dir, { recursive: true, force: true });
}

export function makeSubdir(dir: string, name: string): string {
  const sub = path.join(dir, name);
  mkdirSync(sub, { recursive: true });
  return sub;
}

export interface ToolCall {
  isError: boolean;
  text: string;
  /** Parsed JSON body, or {} when the text is not JSON. */
  json: Record<string, unknown>;
}

export interface Connected {
  client: Client;
  call: (name: string, args?: Record<string, unknown>) => Promise<ToolCall>;
  close: () => Promise<void>;
}

/** Starts the server on an exports folder and connects an in-memory MCP client. */
export async function connect(dir: string): Promise<Connected> {
  const server = await createLedgerServer({ dir });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'ledger-mcp-tests', version: '0.0.0' });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return {
    client,
    async call(name, args = {}) {
      const result = await client.callTool({ name, arguments: args });
      const content = result.content as { type: string; text: string }[];
      const text = content[0]?.text ?? '';
      let json: Record<string, unknown> = {};
      try {
        json = JSON.parse(text) as Record<string, unknown>;
      } catch {
        // Argument validation errors from the SDK are plain text.
      }
      return { isError: result.isError === true, text, json };
    },
    async close() {
      await client.close();
      await server.close();
    },
  };
}
