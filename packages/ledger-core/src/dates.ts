/** Date layouts that ledger-core understands. */
export type DateFormat =
  'YYYY-MM-DD' | 'YYYY/MM/DD' | 'DD.MM.YYYY' | 'DD/MM/YYYY' | 'MM/DD/YYYY' | 'DD-MM-YYYY';

export const DATE_FORMATS: readonly DateFormat[] = [
  'YYYY-MM-DD',
  'YYYY/MM/DD',
  'DD.MM.YYYY',
  'DD/MM/YYYY',
  'MM/DD/YYYY',
  'DD-MM-YYYY',
];

const PATTERNS: Record<DateFormat, { regex: RegExp; order: 'ymd' | 'dmy' | 'mdy' }> = {
  // An ISO date may be followed by a time, which is ignored.
  'YYYY-MM-DD': { regex: /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ].*)?$/, order: 'ymd' },
  'YYYY/MM/DD': { regex: /^(\d{4})\/(\d{1,2})\/(\d{1,2})$/, order: 'ymd' },
  'DD.MM.YYYY': { regex: /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/, order: 'dmy' },
  'DD/MM/YYYY': { regex: /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/, order: 'dmy' },
  'MM/DD/YYYY': { regex: /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/, order: 'mdy' },
  'DD-MM-YYYY': { regex: /^(\d{1,2})-(\d{1,2})-(\d{4})$/, order: 'dmy' },
};

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) return isLeapYear(year) ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

function pad(value: number, width: number): string {
  return String(value).padStart(width, '0');
}

/**
 * Parses a date cell in the given layout and returns YYYY-MM-DD, or null if the
 * cell does not match or is not a real calendar date. Pure string arithmetic:
 * the result never depends on the time zone or locale.
 */
export function parseDate(raw: string, format: DateFormat): string | null {
  const { regex, order } = PATTERNS[format];
  const match = regex.exec(raw.trim());
  if (!match) return null;
  const [a, b, c] = [match[1], match[2], match[3]].map((part) => parseInt(part ?? '', 10)) as [
    number,
    number,
    number,
  ];
  const [year, month, day] = order === 'ymd' ? [a, b, c] : order === 'dmy' ? [c, b, a] : [c, a, b];
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) {
    return null;
  }
  return `${pad(year, 4)}-${pad(month, 2)}-${pad(day, 2)}`;
}

/** True for a valid YYYY-MM-DD calendar date. */
export function isIsoDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && parseDate(value, 'YYYY-MM-DD') === value;
}

/** Formats whose pattern accepts every non-empty value as a real date. */
export function matchingDateFormats(values: readonly string[]): DateFormat[] {
  const nonEmpty = values.map((value) => value.trim()).filter((value) => value !== '');
  if (nonEmpty.length === 0) return [];
  return DATE_FORMATS.filter((format) =>
    nonEmpty.every((value) => parseDate(value, format) !== null),
  );
}
