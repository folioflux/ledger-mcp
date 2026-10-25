import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { INSTRUCTIONS, VERSION } from '../src/index.js';
import type { Connected } from './helpers.js';
import { connect, makeExportsDir, removeDir } from './helpers.js';

let dir: string;
let session: Connected;

beforeEach(async () => {
  dir = makeExportsDir();
  session = await connect(dir);
});

afterEach(async () => {
  await session.close();
  removeDir(dir);
});

describe('server', () => {
  it('reports its name, version and instructions', () => {
    expect(session.client.getServerVersion()).toMatchObject({
      name: 'ledger-mcp',
      version: VERSION,
    });
    expect(session.client.getInstructions()).toBe(INSTRUCTIONS);
  });

  it('keeps VERSION in sync with package.json', () => {
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
      version: string;
    };
    expect(VERSION).toBe(pkg.version);
  });

  it('lists the five tools with honest annotations', async () => {
    const { tools } = await session.client.listTools();
    expect(tools.map((tool) => tool.name)).toEqual([
      'import_csv',
      'list_transactions',
      'totals',
      'cashflow',
      'explain',
    ]);
    for (const tool of tools) {
      expect(tool.description?.length).toBeGreaterThan(40);
      expect(tool.inputSchema.type).toBe('object');
      expect(tool.annotations).toMatchObject({
        destructiveHint: false,
        openWorldHint: false,
        idempotentHint: true,
      });
      expect(tool.annotations?.readOnlyHint).toBe(tool.name !== 'import_csv');
    }
  });
});

describe('list_transactions', () => {
  it('lists transactions with provenance and file status', async () => {
    const { isError, json } = await session.call('list_transactions', { text: 'coffee' });
    expect(isError).toBe(false);
    expect(json['total_count']).toBe(2);
    expect(json['transactions']).toEqual([
      expect.objectContaining({
        date: '2026-01-21',
        amount: '-11.60',
        provenance: expect.objectContaining({ source_file: 'birch-card.csv', row_number: 3 }),
      }),
      expect.objectContaining({ date: '2026-02-11', amount: '-9.20' }),
    ]);
    expect(json['files']).toContainEqual(
      expect.objectContaining({ file: 'dogwood-ambiguous-dates.csv', status: 'needs_mapping' }),
    );
  });

  it('puts input_hash first in every result', async () => {
    for (const [tool, args] of [
      ['list_transactions', {}],
      ['totals', { group_by: 'month' }],
      ['cashflow', {}],
    ] as const) {
      const { text } = await session.call(tool, args);
      expect(text.startsWith('{\n  "input_hash": "')).toBe(true);
    }
  });

  it('returns a tool error for invalid arguments', async () => {
    const result = await session.call('list_transactions', {
      from: '2026-03-01',
      to: '2026-02-01',
    });
    expect(result.isError).toBe(true);
    expect(result.json).toEqual({
      error: { code: 'INVALID_ARGUMENT', message: expect.any(String) },
    });
  });
});

describe('totals and cashflow', () => {
  it('totals by category and never mixes currencies', async () => {
    const { json } = await session.call('totals', { group_by: 'category', currency: 'GBP' });
    const groups = json['groups'] as { key: string | null; total: string; currency: string }[];
    expect(groups.map((g) => [g.key, g.total])).toEqual([
      ['Income', '1250.00'],
      ['Software', '-87.00'],
      ['Travel', '-935.40'],
      [null, '-11.60'],
    ]);
    expect(new Set(groups.map((g) => g.currency))).toEqual(new Set(['GBP']));
  });

  it('reports monthly cashflow', async () => {
    const { json } = await session.call('cashflow', { currency: 'PLN' });
    expect(
      (json['months'] as { month: string; net: string }[]).map((m) => [m.month, m.net]),
    ).toEqual([
      ['2026-01', '1003.27'],
      ['2026-02', '854.05'],
      ['2026-03', '1000.00'],
    ]);
  });
});

describe('explain', () => {
  it('explains a totals figure by ref', async () => {
    const totals = await session.call('totals', { group_by: 'month', currency: 'EUR' });
    const group = (totals.json['groups'] as { ref: string; total: string }[])[1];
    const { json } = await session.call('explain', {
      ref: group?.ref,
      input_hash: totals.json['input_hash'],
    });
    expect(json).toMatchObject({
      input_hash_matches: true,
      sum_matches_figure: true,
      figure: { value: group?.total },
    });
  });

  it('explains list rows by sources', async () => {
    const { json } = await session.call('explain', {
      sources: [{ file: 'cedar-savings.csv', rows: [4] }],
    });
    expect(json['rows']).toEqual([
      expect.objectContaining({
        description: 'Café Olé gift card',
        raw: expect.objectContaining({ Amount: '-150,00' }),
      }),
    ]);
  });

  it('rejects a bad ref', async () => {
    const result = await session.call('explain', { ref: 'fig1_nope' });
    expect(result.isError).toBe(true);
    expect((result.json['error'] as { code: string }).code).toBe('INVALID_REF');
  });
});
