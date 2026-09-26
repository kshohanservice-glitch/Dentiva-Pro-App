import { describe, it, expect } from 'vitest';
import { isValidPhoneBD, isValidEmail, isValidISODate, passwordStrength, isValidUsername, safeFilename } from '../../src/lib/validation';

describe('validation helpers', () => {
  it('validates Bangladeshi phones', () => {
    expect(isValidPhoneBD('01712345678')).toBe(true);
    expect(isValidPhoneBD('+8801712345678')).toBe(true);
    expect(isValidPhoneBD('')).toBe(true);
    expect(isValidPhoneBD('123')).toBe(false);
  });

  it('validates emails', () => {
    expect(isValidEmail('a@b.com')).toBe(true);
    expect(isValidEmail('')).toBe(true);
    expect(isValidEmail('nope')).toBe(false);
  });

  it('validates ISO dates', () => {
    expect(isValidISODate('2026-09-26')).toBe(true);
    expect(isValidISODate('26-09-2026')).toBe(false);
  });

  it('scores passwords', () => {
    expect(passwordStrength('abc').score).toBeLessThan(2);
    expect(passwordStrength('Str0ng!Pass').score).toBe(4);
  });

  it('validates usernames', () => {
    expect(isValidUsername('reception1')).toBe(true);
    expect(isValidUsername('ab')).toBe(false);
    expect(isValidUsername('has space')).toBe(false);
  });

  it('sanitises filenames against traversal', () => {
    expect(safeFilename('../../etc/passwd')).toBe('passwd');
    expect(safeFilename('xray (1).png')).toBe('xray (1).png');
    expect(safeFilename('রিপোর্ট.pdf')).toBe('রিপোর্ট.pdf');
  });
});
