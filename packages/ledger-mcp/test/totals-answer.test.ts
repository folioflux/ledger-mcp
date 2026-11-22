import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';

it('returns the known synthetic totals answer through the built stdio server', () => {
  const script = fileURLToPath(new URL('../../../scripts/totals-answer.mjs', import.meta.url));
  const expected: unknown = JSON.parse(
    readFileSync(new URL('../../../docs/totals-expected.json', import.meta.url), 'utf8'),
  );
  const outputs = Array.from({ length: 2 }, () => {
    const run = spawnSync(process.execPath, [script], { encoding: 'utf8', timeout: 15_000 });
    expect(run.error).toBeUndefined();
    expect(run.status, run.stderr).toBe(0);
    expect(JSON.parse(run.stdout)).toEqual(expected);
    return run.stdout;
  });
  expect(outputs[0]).toBe(outputs[1]);
});
