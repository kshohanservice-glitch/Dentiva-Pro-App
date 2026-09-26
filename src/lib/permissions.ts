// Dentiva Pro — permission codes (single source; DB `permissions.code` matches).

export const PERMISSIONS = [
  { code: 'patients.view', name: 'View patients', module: 'Patients' },
  { code: 'patients.create', name: 'Create patients', module: 'Patients' },
  { code: 'patients.edit', name: 'Edit patients', module: 'Patients' },
  { code: 'patients.delete', name: 'Delete / archive patients', module: 'Patients' },
  { code: 'patients.attachments', name: 'Manage attachments', module: 'Patients' },
  { code: 'patients.merge', name: 'Merge duplicate patients', module: 'Patients' },
  { code: 'patients.export', name: 'Export patient data', module: 'Patients' },
  { code: 'clinical.view', name: 'View clinical data', module: 'Clinical' },
  { code: 'clinical.create_visit', name: 'Create visits', module: 'Clinical' },
  { code: 'clinical.edit_visit', name: 'Edit visits', module: 'Clinical' },
  { code: 'clinical.delete_visit', name: 'Delete visits', module: 'Clinical' },
  { code: 'clinical.chart', name: 'Manage dental chart', module: 'Clinical' },
  { code: 'clinical.referral', name: 'Manage referrals', module: 'Clinical' },
  { code: 'treatments.manage', name: 'Manage treatment catalog', module: 'Treatments' },
  { code: 'prescriptions.create', name: 'Create prescriptions', module: 'Prescriptions' },
  { code: 'prescriptions.edit', name: 'Edit prescriptions', module: 'Prescriptions' },
  { code: 'prescriptions.print', name: 'Print prescriptions', module: 'Prescriptions' },
  { code: 'appointments.view', name: 'View appointments', module: 'Appointments' },
  { code: 'appointments.manage', name: 'Manage appointments', module: 'Appointments' },
  { code: 'queue.manage', name: 'Manage queue', module: 'Queue' },
  { code: 'invoices.view', name: 'View invoices', module: 'Billing' },
  { code: 'invoices.create', name: 'Create invoices', module: 'Billing' },
  { code: 'invoices.edit', name: 'Edit invoices', module: 'Billing' },
  { code: 'invoices.delete', name: 'Delete invoices', module: 'Billing' },
  { code: 'invoices.print', name: 'Print invoices', module: 'Billing' },
  { code: 'payments.view', name: 'View payments', module: 'Billing' },
  { code: 'payments.record', name: 'Record payments', module: 'Billing' },
  { code: 'payments.reverse', name: 'Reverse payments', module: 'Billing' },
  { code: 'inventory.view', name: 'View inventory', module: 'Inventory' },
  { code: 'inventory.manage', name: 'Manage inventory', module: 'Inventory' },
  { code: 'accounting.view', name: 'View accounting', module: 'Accounting' },
  { code: 'accounting.manage', name: 'Manage accounting', module: 'Accounting' },
  { code: 'staff.view', name: 'View staff', module: 'Staff' },
  { code: 'staff.manage', name: 'Manage staff', module: 'Staff' },
  { code: 'users.manage', name: 'Manage users', module: 'Administration' },
  { code: 'roles.manage', name: 'Manage roles & permissions', module: 'Administration' },
  { code: 'settings.manage', name: 'Manage settings', module: 'Administration' },
  { code: 'printers.manage', name: 'Manage printer profiles', module: 'Administration' },
  { code: 'backup.run', name: 'Run backups', module: 'Administration' },
  { code: 'backup.restore', name: 'Restore backups', module: 'Administration' },
  { code: 'audit.view', name: 'View audit log', module: 'Administration' },
  { code: 'reports.view', name: 'View reports', module: 'Reports' },
  { code: 'reports.financial', name: 'View financial reports', module: 'Reports' },
  { code: 'data.danger', name: 'Destructive data operations', module: 'Administration' },
] as const;

export type PermissionCode = (typeof PERMISSIONS)[number]['code'];

export const ALL_PERMISSION_CODES: string[] = PERMISSIONS.map((p) => p.code);

/** Default grants for built-in roles (used at setup; admin may change later). */
export const DEFAULT_ROLE_GRANTS: Record<string, string[]> = {
  Owner: ['*'],
  Administrator: ALL_PERMISSION_CODES.filter((c) => c !== 'data.danger'),
  Dentist: [
    'patients.view', 'patients.create', 'patients.edit', 'patients.attachments',
    'clinical.view', 'clinical.create_visit', 'clinical.edit_visit', 'clinical.chart',
    'clinical.referral', 'treatments.manage',
    'prescriptions.create', 'prescriptions.edit', 'prescriptions.print',
    'appointments.view', 'reports.view',
  ],
  Receptionist: [
    'patients.view', 'patients.create', 'patients.edit', 'patients.attachments',
    'appointments.view', 'appointments.manage', 'queue.manage', 'reports.view',
  ],
  Assistant: [
    'patients.view', 'clinical.view', 'clinical.create_visit', 'clinical.chart',
    'appointments.view', 'queue.manage',
  ],
  Accountant: [
    'patients.view', 'invoices.view', 'invoices.create', 'invoices.edit', 'invoices.print',
    'payments.view', 'payments.record', 'accounting.view', 'accounting.manage',
    'reports.view', 'reports.financial', 'audit.view',
  ],
  'Inventory Manager': ['inventory.view', 'inventory.manage', 'reports.view'],
};

export function hasPermission(granted: Set<string> | string[], code: string): boolean {
  if (Array.isArray(granted)) granted = new Set(granted);
  return granted.has('*') || granted.has(code);
}
