import { Ajv2020 } from 'ajv/dist/2020.js';
import type { ValidateFunction } from 'ajv/dist/2020.js';

/** RFC 3339 full-date with a calendar check, so "2026-02-30" fails. */
function isFullDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const [year, month, day] = [match[1], match[2], match[3]].map((part) =>
    parseInt(part ?? '', 10),
  ) as [number, number, number];
  const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
  return days !== undefined && day >= 1 && day <= days;
}

export function compileSchema(schema: object): ValidateFunction {
  const ajv = new Ajv2020({ strict: true, allErrors: true });
  ajv.addFormat('date', isFullDate);
  return ajv.compile(schema);
}
