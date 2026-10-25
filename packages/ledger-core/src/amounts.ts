import { Decimal } from './decimal.js';

/** The character that separates whole units from the fraction. */
export type DecimalSeparator = '.' | ',';

export const DECIMAL_SEPARATORS: readonly DecimalSeparator[] = ['.', ','];

// Spaces (including no-break and narrow no-break spaces) and apostrophes are
// accepted as thousands separators and simply removed.
const IGNORED_CHARS = /[\s\u00a0\u202f'\u2019]/g;
const CURRENCY_AFFIX = /^(?:\p{Sc}|[A-Za-z]{3})|(?:\p{Sc}|[A-Za-z]{3})$/gu;

/**
 * Parses an amount cell into an exact decimal. Accepts a leading or trailing
 * minus sign (also U+2212), a leading plus sign, parentheses for negatives, a
 * currency symbol or three-letter code before or after the number, and
 * thousands separators. Returns null for an empty cell and undefined when the
 * cell is not a number.
 */
export function parseAmount(raw: string, separator: DecimalSeparator): Decimal | null | undefined {
  let text = raw.replace(IGNORED_CHARS, '').replace(/\u2212/g, '-');
  if (text === '') return null;

  let parenthesized = false;
  if (text.startsWith('(') && text.endsWith(')')) {
    parenthesized = true;
    text = text.slice(1, -1);
  }
  const takeSign = (value: string): { sign: '+' | '-' | null; rest: string } => {
    if (value.startsWith('-') || value.startsWith('+')) {
      return { sign: value.startsWith('-') ? '-' : '+', rest: value.slice(1) };
    }
    if (value.endsWith('-')) return { sign: '-', rest: value.slice(0, -1) };
    return { sign: null, rest: value };
  };
  let taken = takeSign(text);
  let sign = taken.sign;
  text = taken.rest.replace(CURRENCY_AFFIX, '');
  if (sign === null) {
    taken = takeSign(text);
    sign = taken.sign;
    text = taken.rest;
  }
  if (parenthesized && sign !== null) return undefined;
  const negative = parenthesized || sign === '-';

  const thousands = separator === '.' ? ',' : '.';
  const esc = (char: string): string => (char === '.' ? '\\.' : char);
  const grouped = new RegExp(`^\\d{1,3}(?:${esc(thousands)}\\d{3})+(?:${esc(separator)}\\d+)?$`);
  const plain = new RegExp(`^\\d+(?:${esc(separator)}\\d+)?$`);
  if (!grouped.test(text) && !plain.test(text)) return undefined;

  const normalized = text.split(thousands).join('').replace(separator, '.');
  const value = new Decimal(normalized);
  return negative ? value.negated() : value;
}

/** Result of looking at an amount column to decide its decimal separator. */
export type SeparatorDetection =
  | { status: 'ok'; separator: DecimalSeparator }
  | { status: 'ambiguous'; examples: string[] }
  | { status: 'conflict'; examples: string[] };

/**
 * Decides the decimal separator from the values of the amount columns.
 * A value like "1,234" alone is ambiguous (one thousand or one point two),
 * so it is reported instead of guessed.
 */
export function detectDecimalSeparator(values: readonly string[]): SeparatorDetection {
  const evidence = { '.': [] as string[], ',': [] as string[] };
  const ambiguous: string[] = [];
  for (const raw of values) {
    const text = raw.replace(IGNORED_CHARS, '');
    if (text === '') continue;
    const lastDot = text.lastIndexOf('.');
    const lastComma = text.lastIndexOf(',');
    if (lastDot === -1 && lastComma === -1) continue;
    if (lastDot !== -1 && lastComma !== -1) {
      evidence[lastDot > lastComma ? '.' : ','].push(raw);
      continue;
    }
    const sep = lastDot !== -1 ? '.' : ',';
    const digitsAfter = /^\d*/.exec(text.slice(Math.max(lastDot, lastComma) + 1))?.[0].length ?? 0;
    const occurrences = text.split(sep).length - 1;
    if (occurrences > 1) {
      // "1.234.567" can only be thousands separators.
      evidence[sep === '.' ? ',' : '.'].push(raw);
    } else if (digitsAfter === 3) {
      ambiguous.push(raw);
    } else {
      evidence[sep].push(raw);
    }
  }
  const dot = evidence['.'];
  const comma = evidence[','];
  if (dot.length > 0 && comma.length > 0) {
    return { status: 'conflict', examples: [...dot.slice(0, 2), ...comma.slice(0, 2)] };
  }
  if (dot.length > 0) return { status: 'ok', separator: '.' };
  if (comma.length > 0) return { status: 'ok', separator: ',' };
  if (ambiguous.length > 0) return { status: 'ambiguous', examples: ambiguous.slice(0, 3) };
  return { status: 'ok', separator: '.' };
}
