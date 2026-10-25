import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { VERSION } from '../src/index.js';
import { makeExportsDir, removeDir } from './helpers.js';

const CLI = fileURLToPath(new URL('../dist/cli.js', import.meta.url));
const GUARD = fileURLToPath(new URL('./no-network.mjs', import.meta.url));
const MARKER = 'LEDGER_MCP_NETWORK_ATTEMPT';

interface Session {
  responses: string[];
  stderr: string;
}

/**
 * Runs the built server as a child process and plays a fixed MCP conversation
 * over stdio with newline-delimited JSON-RPC, returning the raw response lines.
 */
async function runSession(dir: string, env: Record<string, string>): Promise<Session> {
  const child = spawn(process.execPath, ['--import', GUARD, CLI, '--dir', dir], {
    env: { PATH: process.env['PATH'] ?? '', ...env },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk: string) => (stderr += chunk));
  const waiters: (() => void)[] = [];
  child.stdout.on('data', (chunk: string) => {
    stdout += chunk;
    waiters.splice(0).forEach((wake) => {
      wake();
    });
  });
  const lines = (): string[] => stdout.split('\n').filter((line) => line !== '');
  const waitForLines = async (count: number): Promise<void> => {
    while (lines().length < count) {
      if (child.exitCode !== null) throw new Error(`server exited early: ${stderr}`);
      await new Promise<void>((resolve) => waiters.push(resolve));
    }
  };
  const send = (message: object): void => {
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', ...message })}\n`);
  };

  const messages: object[] = [
    {
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-11-25',
        capabilities: {},
        clientInfo: { name: 'stdio-test', version: '0.0.0' },
      },
    },
    { id: 2, method: 'tools/list', params: {} },
    {
      id: 3,
      method: 'tools/call',
      params: { name: 'import_csv', arguments: { file: 'cedar-savings.csv' } },
    },
    {
      id: 4,
      method: 'tools/call',
      params: { name: 'list_transactions', arguments: { from: '2026-02-01', to: '2026-02-28' } },
    },
    {
      id: 5,
      method: 'tools/call',
      params: { name: 'totals', arguments: { group_by: 'category' } },
    },
    { id: 6, method: 'tools/call', params: { name: 'cashflow', arguments: {} } },
  ];
  send(messages[0] as object);
  await waitForLines(1);
  send({ method: 'notifications/initialized' });
  for (const [index, message] of messages.slice(1).entries()) {
    send(message);
    await waitForLines(index + 2);
  }

  // Explain the first totals figure, using the ref from the previous answer.
  const totalsBody = JSON.parse(
    (JSON.parse(lines()[4] ?? '') as { result: { content: { text: string }[] } }).result.content[0]
      ?.text ?? '',
  ) as { input_hash: string; groups: { ref: string }[] };
  send({
    id: 7,
    method: 'tools/call',
    params: {
      name: 'explain',
      arguments: { ref: totalsBody.groups[0]?.ref, input_hash: totalsBody.input_hash },
    },
  });
  await waitForLines(7);

  child.stdin.end();
  await new Promise<void>((resolve) => {
    if (child.exitCode !== null) resolve();
    else
      child.once('exit', () => {
        resolve();
      });
    setTimeout(() => {
      child.kill();
    }, 2000).unref();
  });
  return { responses: lines(), stderr };
}

let dir: string;

beforeAll(() => {
  if (!existsSync(CLI))
    throw new Error('packages/ledger-mcp/dist/cli.js is missing; run "pnpm build" first.');
  dir = makeExportsDir();
});

afterAll(() => {
  removeDir(dir);
});

describe('built server over stdio', () => {
  it('answers a scripted MCP session identically under different time zones and locales', async () => {
    const variants = [
      { TZ: 'UTC', LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8' },
      { TZ: 'Europe/Kyiv', LANG: 'uk_UA.UTF-8', LC_ALL: 'uk_UA.UTF-8' },
      { TZ: 'America/Los_Angeles', LANG: 'de_DE.UTF-8', LC_ALL: 'de_DE.UTF-8' },
      { TZ: 'Asia/Tokyo', LANG: 'ja_JP.UTF-8', LC_ALL: 'ja_JP.UTF-8' },
    ];
    const sessions: Session[] = [];
    for (const env of variants) sessions.push(await runSession(dir, env));

    const [first, ...rest] = sessions;
    expect(first?.responses).toHaveLength(7);
    for (const session of rest) expect(session.responses).toEqual(first?.responses);

    const responses = (first?.responses ?? []).map(
      (line) => JSON.parse(line) as { id: number; error?: unknown; result?: { isError?: boolean } },
    );
    expect(responses.map((r) => r.id)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    for (const response of responses) {
      expect(response.error).toBeUndefined();
      expect(response.result?.isError).not.toBe(true);
    }
    const explained = JSON.parse(
      (responses[6]?.result as { content: { text: string }[] }).content[0]?.text ?? '',
    ) as { sum_matches_figure: boolean; input_hash_matches: boolean };
    expect(explained).toMatchObject({ sum_matches_figure: true, input_hash_matches: true });
  });

  it('makes no network requests', async () => {
    const session = await runSession(dir, { TZ: 'UTC' });
    expect(session.responses).toHaveLength(7);
    expect(session.stderr).not.toContain(MARKER);
    expect(session.stderr).toContain(`ledger-mcp ${VERSION} ready`);
  });

  it('has a working network guard', () => {
    const probe = (code: string): string =>
      spawnSync(process.execPath, ['--import', GUARD, '-e', code], { encoding: 'utf8' }).stderr;
    expect(probe("fetch('https://example.com')")).toContain(`${MARKER} fetch`);
    expect(probe("require('node:net').connect(80, 'example.com')")).toContain(
      `${MARKER} net.connect`,
    );
    expect(probe("require('node:dns').lookup('example.com', () => {})")).toContain(
      `${MARKER} dns.lookup`,
    );
    expect(probe("require('node:https').get('https://example.com')")).toContain(
      `${MARKER} https.get`,
    );
  });

  it('prints help and version, and rejects a missing --dir', () => {
    const help = spawnSync(process.execPath, [CLI, '--help'], { encoding: 'utf8' });
    expect(help.status).toBe(0);
    expect(help.stdout).toContain('Usage:');
    const version = spawnSync(process.execPath, [CLI, '--version'], { encoding: 'utf8' });
    expect(version.stdout).toBe(`${VERSION}\n`);
    const missing = spawnSync(process.execPath, [CLI], { encoding: 'utf8' });
    expect(missing.status).toBe(2);
    expect(missing.stderr).toContain('Missing --dir');
    const unknown = spawnSync(process.execPath, [CLI, '--dir', dir, '--network'], {
      encoding: 'utf8',
    });
    expect(unknown.status).toBe(2);
    const badDir = spawnSync(process.execPath, [CLI, '--dir', `${dir}/nope`], { encoding: 'utf8' });
    expect(badDir.status).toBe(1);
    expect(badDir.stderr).toContain('not found');
  });
});
