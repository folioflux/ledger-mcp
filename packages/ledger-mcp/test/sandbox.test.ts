import { mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Workspace } from '../src/index.js';
import type { Connected } from './helpers.js';
import { connect, makeExportsDir, removeDir } from './helpers.js';

let dir: string;
let outside: string;
let session: Connected;

beforeEach(async () => {
  dir = makeExportsDir();
  outside = makeExportsDir(['birch-card.csv']);
  mkdirSync(path.join(dir, 'nested'));
  writeFileSync(
    path.join(dir, 'nested', 'hidden.csv'),
    'Date,Description,Amount,Currency\n2026-01-01,x,1.00,EUR\n',
  );
  writeFileSync(path.join(dir, 'notes.txt'), 'not a csv');
  writeFileSync(
    path.join(dir, '.dotfile.csv'),
    'Date,Description,Amount,Currency\n2026-01-01,x,1.00,EUR\n',
  );
  symlinkSync(path.join(outside, 'birch-card.csv'), path.join(dir, 'linked.csv'));
  session = await connect(dir);
});

afterEach(async () => {
  await session.close();
  removeDir(dir);
  removeDir(outside);
});

describe('file access', () => {
  it.each([
    '../birch-card.csv',
    'nested/hidden.csv',
    'nested\\hidden.csv',
    '/etc/passwd',
    'notes.txt',
    '.dotfile.csv',
    'linked.csv',
    'missing.csv',
    '',
  ])('import_csv refuses %j', async (file) => {
    const result = await session.call('import_csv', { file });
    expect(result.isError).toBe(true);
  });

  it('only reads plain CSV files directly in the folder', async () => {
    const { json } = await session.call('list_transactions', {});
    expect((json['files'] as { file: string }[]).map((f) => f.file)).toEqual([
      'alder-bank-current.csv',
      'birch-card.csv',
      'cedar-savings.csv',
      'dogwood-ambiguous-dates.csv',
    ]);
  });

  it('reports a missing exports folder', async () => {
    await expect(Workspace.open(path.join(dir, 'does-not-exist'))).rejects.toThrow(/not found/);
  });

  it('lists a malformed CSV as an error without failing other files', async () => {
    writeFileSync(path.join(dir, 'broken.csv'), 'Date,Amount\n"2026-01-01,1\n');
    const { isError, json } = await session.call('totals', { group_by: 'month' });
    expect(isError).toBe(false);
    expect(json['files']).toContainEqual(
      expect.objectContaining({ file: 'broken.csv', status: 'error' }),
    );
    expect((json['groups'] as unknown[]).length).toBeGreaterThan(0);
  });
});
