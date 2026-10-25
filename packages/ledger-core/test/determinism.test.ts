import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createLedger, importCsv } from '../src/index.js';
import { fixture, TOP_LEVEL_FIXTURES } from './helpers.js';
import { runScenario, serialize } from './scenario.js';

const ALL = [...TOP_LEVEL_FIXTURES, 'needs-mapping/dogwood-ambiguous-dates.csv'];

/** Deterministic Fisher-Yates shuffle with a small linear congruential generator. */
function shuffled<T>(items: readonly T[], seed: number): T[] {
  const out = [...items];
  let state = seed;
  for (let i = out.length - 1; i > 0; i--) {
    state = (state * 1103515245 + 12345) % 2147483648;
    const j = state % (i + 1);
    [out[i], out[j]] = [out[j] as T, out[i] as T];
  }
  return out;
}

describe('determinism', () => {
  it('returns byte-identical output when run twice', () => {
    const first = serialize(runScenario(ALL.map(fixture)));
    const second = serialize(runScenario(ALL.map(fixture)));
    expect(second).toBe(first);
  });

  it('does not depend on the order files are read in', () => {
    const baseline = serialize(runScenario(ALL.map(fixture)));
    for (const seed of [1, 2, 3, 42, 2026]) {
      const order = shuffled(ALL, seed);
      const output = serialize(runScenario(order.map(fixture)));
      // Import summaries follow the input order; everything derived from the ledger must not.
      const { import: _a, ...derived } = JSON.parse(output) as Record<string, unknown>;
      const { import: _b, ...expected } = JSON.parse(baseline) as Record<string, unknown>;
      expect(serialize(derived)).toBe(serialize(expected));
    }
  });

  it('does not depend on the process time zone', () => {
    const original = process.env['TZ'];
    try {
      const outputs = ['UTC', 'Europe/Kyiv', 'America/Los_Angeles', 'Pacific/Kiritimati'].map(
        (tz) => {
          process.env['TZ'] = tz;
          return serialize(runScenario(ALL.map(fixture)));
        },
      );
      expect(new Set(outputs).size).toBe(1);
    } finally {
      if (original === undefined) delete process.env['TZ'];
      else process.env['TZ'] = original;
    }
  });

  it('gives the same input hash for the same files and a new one when any byte changes', () => {
    const ledger = () => createLedger(TOP_LEVEL_FIXTURES.map((name) => importCsv(fixture(name))));
    expect(ledger().input_hash).toBe(ledger().input_hash);
    const changed = fixture('birch-card.csv');
    const bytes = changed.bytes.slice();
    bytes[bytes.length - 2] = 0x41;
    const other = createLedger(
      TOP_LEVEL_FIXTURES.map((name) =>
        importCsv(name === 'birch-card.csv' ? { name, bytes } : fixture(name)),
      ),
    );
    expect(other.input_hash).not.toBe(ledger().input_hash);
  });
});

describe('no floating point in ledger-core', () => {
  const srcDir = new URL('../src/', import.meta.url);
  const sources = readdirSync(srcDir)
    .filter((name) => name.endsWith('.ts'))
    .map((name) => ({ name, text: readFileSync(new URL(name, srcDir), 'utf8') }));

  it.each([
    ['parseFloat', /\bparseFloat\s*\(/],
    ['Number()', /(?<![.\w])Number\s*\(/],
    ['unary plus on a string', /=\s*\+[a-zA-Z_(]/],
    ['Math.round', /\bMath\.round\s*\(/],
    ['toLocaleString', /\.toLocaleString\s*\(/],
    ['localeCompare', /\.localeCompare\s*\(/],
    ['Intl', /\bIntl\./],
    ['new Date', /\bnew Date\b/],
    ['Date.now', /\bDate\.now\b/],
    ['Math.random', /\bMath\.random\b/],
  ])('does not use %s', (_label, pattern) => {
    const offenders = sources.filter(({ text }) => pattern.test(text)).map(({ name }) => name);
    expect(offenders).toEqual([]);
  });
});
