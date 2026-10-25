import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { fixture, TOP_LEVEL_FIXTURES } from './helpers.js';
import { runScenario, serialize } from './scenario.js';

const EXPECTED = new URL('../../../fixtures/expected/', import.meta.url);
const UPDATE = process.env['UPDATE_GOLDEN'] === '1';

const outputs = runScenario(
  [...TOP_LEVEL_FIXTURES, 'needs-mapping/dogwood-ambiguous-dates.csv'].map(fixture),
);

describe('golden output', () => {
  if (UPDATE) mkdirSync(EXPECTED, { recursive: true });

  it.each(Object.keys(outputs))('%s matches fixtures/expected byte for byte', (name) => {
    const actual = serialize(outputs[name]);
    const file = new URL(`${name}.json`, EXPECTED);
    if (UPDATE) writeFileSync(file, actual);
    // Compare raw bytes, not parsed JSON: formatting and key order are part of the contract.
    expect(actual).toBe(readFileSync(file, 'utf8'));
  });
});
