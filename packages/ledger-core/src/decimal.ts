import { Decimal as DecimalJs } from 'decimal.js';

/**
 * A private Decimal constructor so that no global decimal.js configuration can
 * change results. Amounts are only ever added and subtracted, which is exact at
 * this precision for any realistic input.
 */
export const Decimal = DecimalJs.clone({
  precision: 80,
  rounding: DecimalJs.ROUND_HALF_EVEN,
  toExpNeg: -1000,
  toExpPos: 1000,
});
export type Decimal = InstanceType<typeof Decimal>;

/**
 * Canonical string form of an amount: plain notation, at least two fraction
 * digits, and never a negative zero.
 */
export function formatAmount(value: Decimal): string {
  if (value.isZero()) {
    return new Decimal(0).toFixed(Math.max(2, value.decimalPlaces()));
  }
  return value.toFixed(Math.max(2, value.decimalPlaces()));
}

/** Sums canonical amount strings exactly and returns the canonical sum. */
export function sumAmounts(amounts: readonly string[]): string {
  let total = new Decimal(0);
  for (const amount of amounts) {
    total = total.plus(amount);
  }
  return formatAmount(total);
}
