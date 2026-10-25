import { describe, expect, it } from 'vitest';
import {
  detectDecimalSeparator,
  formatAmount,
  parseAmount,
  sumAmounts,
  Decimal,
} from '../src/index.js';

const parse = (raw: string, separator: '.' | ',' = '.') => {
  const value = parseAmount(raw, separator);
  return value === null || value === undefined ? value : formatAmount(value);
};

describe('parseAmount', () => {
  it.each([
    ['12.50', '.', '12.50'],
    ['-12.5', '.', '-12.50'],
    ['+3', '.', '3.00'],
    ['1,234.56', '.', '1234.56'],
    ['1,234,567.891', '.', '1234567.891'],
    ['1.234,56', ',', '1234.56'],
    ['-1 234,56', ',', '-1234.56'],
    ['1\u00a0234,56', ',', '1234.56'],
    ["1'234.50", '.', '1234.50'],
    ['(45.00)', '.', '-45.00'],
    ['45.00-', '.', '-45.00'],
    ['\u221245.00', '.', '-45.00'],
    ['€12.00', '.', '12.00'],
    ['-€12.00', '.', '-12.00'],
    ['€-12.00', '.', '-12.00'],
    ['12.00 EUR', '.', '12.00'],
    ['0.10', '.', '0.10'],
    ['-0.00', '.', '0.00'],
  ] as const)('parses %j with separator %j as %s', (raw, separator, expected) => {
    expect(parse(raw, separator)).toBe(expected);
  });

  it('returns null for an empty cell', () => {
    expect(parseAmount('  ', '.')).toBeNull();
  });

  it.each(['abc', '1e5', '12.3.4', '1,23.00', '--5', '(-5)', '12,50', '0x10', 'NaN', 'Infinity'])(
    'rejects %j',
    (raw) => {
      expect(parseAmount(raw, '.')).toBeUndefined();
    },
  );
});

describe('decimal arithmetic', () => {
  it('adds exactly where floating point would not', () => {
    expect(sumAmounts(['0.10', '0.20'])).toBe('0.30');
    expect(sumAmounts(Array.from({ length: 1000 }, () => '0.01'))).toBe('10.00');
    expect(sumAmounts(['9007199254740993.01', '0.01'])).toBe('9007199254740993.02');
  });

  it('formats with at least two fraction digits and no negative zero', () => {
    expect(formatAmount(new Decimal('5'))).toBe('5.00');
    expect(formatAmount(new Decimal('5.125'))).toBe('5.125');
    expect(formatAmount(new Decimal('-0'))).toBe('0.00');
    expect(sumAmounts([])).toBe('0.00');
    expect(sumAmounts(['1.10', '-1.10'])).toBe('0.00');
  });
});

describe('detectDecimalSeparator', () => {
  it('finds a dot or a comma from decisive values', () => {
    expect(detectDecimalSeparator(['12.50', '3'])).toEqual({ status: 'ok', separator: '.' });
    expect(detectDecimalSeparator(['12,50', '1.234,00'])).toEqual({ status: 'ok', separator: ',' });
    expect(detectDecimalSeparator(['1.234.567'])).toEqual({ status: 'ok', separator: ',' });
    expect(detectDecimalSeparator(['1,234', '2.5'])).toEqual({ status: 'ok', separator: '.' });
  });

  it('reports values that could go either way', () => {
    expect(detectDecimalSeparator(['1,234', '5'])).toEqual({
      status: 'ambiguous',
      examples: ['1,234'],
    });
  });

  it('reports a conflict', () => {
    expect(detectDecimalSeparator(['12.50', '12,50']).status).toBe('conflict');
  });

  it('defaults to a dot when no value has a separator', () => {
    expect(detectDecimalSeparator(['5', '-10', ''])).toEqual({ status: 'ok', separator: '.' });
  });
});
