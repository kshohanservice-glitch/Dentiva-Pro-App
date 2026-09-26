import { describe, it, expect } from 'vitest';
import { PERMISSIONS, DEFAULT_ROLE_GRANTS, hasPermission, ALL_PERMISSION_CODES } from '../../src/lib/permissions';

describe('permission model', () => {
  it('defines a unique, namespaced code set', () => {
    const codes = PERMISSIONS.map((p) => p.code);
    expect(new Set(codes).size).toBe(codes.length);
    expect(codes.every((c) => c.includes('.'))).toBe(true);
    expect(ALL_PERMISSION_CODES.length).toBeGreaterThan(30);
  });

  it('grants owner everything and restricts receptionist finances', () => {
    expect(DEFAULT_ROLE_GRANTS.Owner).toEqual(['*']);
    expect(DEFAULT_ROLE_GRANTS.Receptionist).toContain('patients.create');
    expect(DEFAULT_ROLE_GRANTS.Receptionist).not.toContain('payments.record');
    expect(DEFAULT_ROLE_GRANTS.Receptionist).not.toContain('accounting.view');
    expect(DEFAULT_ROLE_GRANTS.Accountant).toContain('payments.record');
    expect(DEFAULT_ROLE_GRANTS.Accountant).not.toContain('clinical.create_visit');
  });

  it('checks grants with wildcard support', () => {
    expect(hasPermission(['*'], 'anything.at.all')).toBe(true);
    expect(hasPermission(['patients.view'], 'patients.view')).toBe(true);
    expect(hasPermission(['patients.view'], 'patients.delete')).toBe(false);
  });
});
