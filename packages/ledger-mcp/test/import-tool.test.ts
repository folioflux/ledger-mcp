import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Connected } from './helpers.js';
import { connect, makeExportsDir, removeDir } from './helpers.js';

let dir: string;
let session: Connected;
const DOGWOOD = 'dogwood-ambiguous-dates.csv';

beforeEach(async () => {
  dir = makeExportsDir();
  session = await connect(dir);
});

afterEach(async () => {
  await session.close();
  removeDir(dir);
});

function snapshot(): Record<string, string> {
  return Object.fromEntries(
    readdirSync(dir)
      .filter((name) => name.endsWith('.csv'))
      .map((name) => [name, readFileSync(path.join(dir, name)).toString('base64')]),
  );
}

describe('import_csv', () => {
  it('previews a detected mapping without writing anything', async () => {
    const { isError, json } = await session.call('import_csv', { file: 'birch-card.csv' });
    expect(isError).toBe(false);
    expect(json).toMatchObject({
      file: 'birch-card.csv',
      status: 'ok',
      mapping_source: 'detected',
      saved: false,
      mapping_path: null,
      mapping: { date_format: 'DD/MM/YYYY', columns: { debit: 'Money Out', credit: 'Money In' } },
    });
    expect(json['preview']).toBeDefined();
    expect(existsSync(path.join(dir, '.ledger-mcp'))).toBe(false);
  });

  it('asks for the open questions, then saves a confirmed mapping', async () => {
    const before = snapshot();
    const preview = await session.call('import_csv', { file: DOGWOOD });
    expect(preview.json).toMatchObject({ status: 'needs_mapping', saved: false });
    expect((preview.json['issues'] as { field: string }[]).map((i) => i.field).sort()).toEqual([
      'date_format',
      'default_currency',
    ]);

    const refused = await session.call('import_csv', { file: DOGWOOD, save: true });
    expect(refused.isError).toBe(true);

    const saved = await session.call('import_csv', {
      file: DOGWOOD,
      mapping: { date_format: 'DD/MM/YYYY', default_currency: 'EUR' },
      save: true,
    });
    expect(saved.json).toMatchObject({ status: 'ok', saved: true });
    const mappingPath = saved.json['mapping_path'] as string;
    expect(mappingPath).toMatch(/^\.ledger-mcp\/mappings\/[0-9a-f]{64}\.json$/);
    const file = readFileSync(path.join(dir, mappingPath), 'utf8');
    expect(JSON.parse(file)).toMatchObject({
      version: 1,
      date_format: 'DD/MM/YYYY',
      default_currency: 'EUR',
    });
    expect(file.endsWith('}\n')).toBe(true);

    // The CSV files are untouched and the only new files are under .ledger-mcp/mappings.
    expect(snapshot()).toEqual(before);
    expect(readdirSync(path.join(dir, '.ledger-mcp'))).toEqual(['mappings']);
    expect(readdirSync(path.join(dir, '.ledger-mcp', 'mappings'))).toHaveLength(1);

    // Query tools now read the file with the saved mapping.
    const list = await session.call('list_transactions', {
      currency: 'EUR',
      from: '2026-02-01',
      to: '2026-02-28',
      text: 'printer',
    });
    expect(list.json['transactions']).toEqual([
      expect.objectContaining({ date: '2026-02-11', amount: '-29.90' }),
    ]);
    const again = await session.call('import_csv', { file: DOGWOOD });
    expect(again.json).toMatchObject({ status: 'ok', mapping_source: 'saved' });
  });

  it('saving the same mapping twice gives the same file', async () => {
    const args = {
      file: DOGWOOD,
      mapping: { date_format: 'MM/DD/YYYY', default_currency: 'EUR' },
      save: true,
    };
    const first = await session.call('import_csv', args);
    const content = readFileSync(path.join(dir, first.json['mapping_path'] as string), 'utf8');
    const second = await session.call('import_csv', args);
    expect(second.json['mapping_path']).toBe(first.json['mapping_path']);
    expect(readFileSync(path.join(dir, second.json['mapping_path'] as string), 'utf8')).toBe(
      content,
    );
  });

  it('reports an invalid saved mapping instead of using it', async () => {
    const saved = await session.call('import_csv', {
      file: DOGWOOD,
      mapping: { date_format: 'DD/MM/YYYY', default_currency: 'EUR' },
      save: true,
    });
    writeFileSync(path.join(dir, saved.json['mapping_path'] as string), '{"version": 9}');
    const result = await session.call('import_csv', { file: DOGWOOD });
    expect(result.isError).toBe(true);
    expect((result.json['error'] as { code: string }).code).toBe('INVALID_MAPPING');
    const list = await session.call('list_transactions', {});
    expect(list.json['files']).toContainEqual(
      expect.objectContaining({ file: DOGWOOD, status: 'error' }),
    );
  });
});
