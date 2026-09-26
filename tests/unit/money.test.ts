import { describe, it, expect } from 'vitest';
import { parseBdtToPaisa, formatBdt, formatBdtCompact, percentOfPaisa } from '../../src/lib/money';

describe('money (paisa-safe arithmetic)', () => {
  it('parses user input into paisa', () => {
    expect(parseBdtToPaisa('1,250.00')).toBe(125000);
    expect(parseBdtToPaisa('৳ 1,250.50')).toBe(125050);
    expect(parseBdtToPaisa('100')).toBe(10000);
    expect(parseBdtToPaisa('0.99')).toBe(99);
    expect(parseBdtToPaisa('')).toBeNull();
    expect(parseBdtToPaisa('abc')).toBeNull();
    expect(parseBdtToPaisa('12.345')).toBeNull();
    expect(parseBdtToPaisa('-50')).toBe(-5000);
  });

  it('formats paisa as BDT', () => {
    expect(formatBdt(125000)).toBe('৳ 1,250.00');
    expect(formatBdt(0)).toBe('৳ 0.00');
    expect(formatBdt(-250)).toBe('-৳ 2.50');
    expect(formatBdt(null)).toBe('৳ 0.00');
  });

  it('compacts large amounts', () => {
    expect(formatBdtCompact(125000)).toBe('৳1.3k');
    expect(formatBdtCompact(25000000)).toBe('৳2.5L');
  });

  it('computes percentage discounts without float drift', () => {
    // 10% of ৳999.99 = 99999 paisa * 10 / 100 = 9999.9 -> 10000
    expect(percentOfPaisa(99999, 10)).toBe(10000);
    expect(percentOfPaisa(100, 33)).toBe(33);
  });

  it('never uses floats for totals (0.1 + 0.2 case)', () => {
    const a = parseBdtToPaisa('0.10')!;
    const b = parseBdtToPaisa('0.20')!;
    expect(a + b).toBe(30);
    expect(formatBdt(a + b)).toBe('৳ 0.30');
  });
});
