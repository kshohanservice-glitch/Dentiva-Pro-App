// Dentiva Pro — typed command client. UI calls these; never SQL, never storage.

import { invoke } from './lib/ipc';

export interface SessionInfo {
  id: number;
  fullName: string;
  username: string;
  roleId: number;
  roleName: string;
  permissions: string[];
}

export interface AppStatus {
  backend: string;
  version: string;
  schemaVersion: number;
  activated: boolean;
  setupComplete: boolean;
  locked: boolean;
  installId: string;
  session: SessionInfo | null;
  autoLockMinutes: number;
  integrityWarning: string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRec = Record<string, any>;

export const api = {
  status: () => invoke<AppStatus>('app_status'),
  activate: (code: string) => invoke<{ ok: boolean }>('activate', { code }),
  setupInit: (payload: AnyRec) => invoke<{ ok: boolean }>('setup_init', payload),
  login: (username: string, password: string) => invoke<{ session: SessionInfo }>('login', { username, password }),
  logout: () => invoke('logout'),
  lock: () => invoke('lock_app'),
  unlock: (password: string) => invoke('unlock', { password }),
  changePassword: (current: string, next: string) => invoke('change_password', { current, next }),

  settingsGet: (keys?: string[]) => invoke<Record<string, string>>('settings_get', { keys }),
  settingsSet: (values: Record<string, string>) => invoke('settings_set', { values }),

  dashboard: () => invoke<AnyRec>('dashboard_stats'),
  search: (query: string) => invoke<Array<AnyRec>>('global_search', { query }),

  patientsList: (p: AnyRec) => invoke<{ rows: AnyRec[]; total: number; page: number; pageSize: number }>('patients_list', p),
  patientsGet: (id: number) => invoke<AnyRec>('patients_get', { id }),
  patientsCreate: (p: AnyRec) => invoke<{ id: number; code: string; warnings: string[] }>('patients_create', p),
  patientsUpdate: (p: AnyRec) => invoke('patients_update', p),
  patientsDelete: (id: number, mode: 'archive' | 'delete') => invoke('patients_delete', { id, mode }),
  patientsMerge: (masterId: number, duplicateId: number) => invoke('patients_merge', { masterId, duplicateId }),
  timeline: (id: number, filter = 'all') => invoke<Array<AnyRec>>('patient_timeline', { id, filter }),
  financials: (id: number) => invoke<AnyRec>('patient_financials', { id }),

  visitsList: (patientId: number) => invoke<Array<AnyRec>>('visits_list', { patientId }),
  visitsCreate: (p: AnyRec) => invoke<{ id: number }>('visits_create', p),
  visitsUpdate: (p: AnyRec) => invoke('visits_update', p),
  visitsDelete: (id: number) => invoke('visits_delete', { id }),

  chartGet: (patientId: number) => invoke<AnyRec>('chart_get', { patientId }),
  chartSet: (p: AnyRec) => invoke('chart_set', p),

  treatmentsList: (search = '', activeOnly = true) => invoke<Array<AnyRec>>('treatments_list', { search, activeOnly }),
  treatmentsSave: (p: AnyRec) => invoke<{ id: number }>('treatments_save', p),
  treatmentRecord: (p: AnyRec) => invoke<{ id: number }>('treatment_records_create', p),

  medicationsList: (search = '') => invoke<Array<AnyRec>>('medications_list', { search }),
  medicationsSave: (p: AnyRec) => invoke<{ id: number }>('medications_save', p),

  prescriptionsList: (p: AnyRec) => invoke<Array<AnyRec>>('prescriptions_list', p),
  prescriptionsGet: (id: number) => invoke<AnyRec>('prescriptions_get', { id }),
  prescriptionsSave: (p: AnyRec) => invoke<{ id: number }>('prescriptions_save', p),
  prescriptionsDelete: (id: number) => invoke('prescriptions_delete', { id }),

  appointmentsList: (p: AnyRec) => invoke<Array<AnyRec>>('appointments_list', p),
  appointmentsSave: (p: AnyRec) => invoke<{ id: number }>('appointments_save', p),
  appointmentsDelete: (id: number) => invoke('appointments_delete', { id }),

  queueList: (date: string) => invoke<Array<AnyRec>>('queue_list', { date }),
  queueAdd: (p: AnyRec) => invoke<{ id: number; queueNo: number }>('queue_add', p),
  queueAction: (id: number, action: string) => invoke('queue_action', { id, action }),

  referralsList: (patientId: number) => invoke<Array<AnyRec>>('referrals_list', { patientId }),
  referralsSave: (p: AnyRec) => invoke<{ id: number }>('referrals_save', p),
  referralsDelete: (id: number) => invoke('referrals_delete', { id }),

  attachmentsList: (patientId: number) => invoke<Array<AnyRec>>('attachments_list', { patientId }),
  attachmentUpload: (p: AnyRec) => invoke<{ id: number }>('attachment_upload', p),
  attachmentGet: (id: number) => invoke<{ name: string; mime: string; base64: string }>('attachment_get', { id }),
  attachmentDelete: (id: number) => invoke('attachment_delete', { id }),

  mednotesList: (patientId: number) => invoke<Array<AnyRec>>('mednotes_list', { patientId }),
  mednotesCreate: (patientId: number, note: string) => invoke('mednotes_create', { patientId, note }),

  invoicesList: (p: AnyRec) => invoke<{ rows: AnyRec[]; total: number }>('invoices_list', p),
  invoicesGet: (id: number) => invoke<AnyRec>('invoices_get', { id }),
  invoicesSave: (p: AnyRec) => invoke<{ id: number; invoiceNo: string }>('invoices_save', p),
  invoicesDelete: (id: number) => invoke('invoices_delete', { id }),

  paymentsList: (p: AnyRec) => invoke<{ rows: AnyRec[]; total: number; summary: Array<AnyRec> }>('payments_list', p),
  paymentsCreate: (p: AnyRec) => invoke<{ id: number; receiptNo: string }>('payments_create', p),
  paymentsReverse: (id: number, reason: string) => invoke('payments_reverse', { id, reason }),

  inventoryList: (p: AnyRec) => invoke<Array<AnyRec>>('inventory_list', p),
  inventoryGet: (id: number) => invoke<AnyRec>('inventory_get', { id }),
  inventorySave: (p: AnyRec) => invoke<{ id: number }>('inventory_save', p),
  stockReceive: (p: AnyRec) => invoke('stock_receive', p),
  stockIssue: (p: AnyRec) => invoke('stock_issue', p),
  stockAdjust: (p: AnyRec) => invoke('stock_adjust', p),
  suppliersList: (search = '') => invoke<Array<AnyRec>>('suppliers_list', { search }),
  suppliersSave: (p: AnyRec) => invoke<{ id: number }>('suppliers_save', p),
  inventoryAlerts: () => invoke<AnyRec>('inventory_alerts'),

  categoriesList: (kind = '') => invoke<Array<AnyRec>>('categories_list', { kind }),
  categoriesSave: (p: AnyRec) => invoke<{ id: number }>('categories_save', p),
  expensesList: (p: AnyRec) => invoke<Array<AnyRec>>('expenses_list', p),
  expensesSave: (p: AnyRec) => invoke<{ id: number }>('expenses_save', p),
  incomesList: (p: AnyRec) => invoke<Array<AnyRec>>('incomes_list', p),
  incomesSave: (p: AnyRec) => invoke<{ id: number }>('incomes_save', p),
  accountingSummary: (from: string, to: string) => invoke<AnyRec>('accounting_summary', { from, to }),

  staffList: (search = '') => invoke<Array<AnyRec>>('staff_list', { search }),
  staffSave: (p: AnyRec) => invoke<{ id: number }>('staff_save', p),
  staffDelete: (id: number) => invoke('staff_delete', { id }),

  usersList: () => invoke<Array<AnyRec>>('users_list'),
  usersSave: (p: AnyRec) => invoke<{ id: number }>('users_save', p),
  usersDelete: (id: number) => invoke('users_delete', { id }),
  rolesList: () => invoke<{ roles: Array<AnyRec>; permissions: Array<AnyRec> }>('roles_list'),
  rolesSave: (p: AnyRec) => invoke<{ id: number }>('roles_save', p),
  rolesDelete: (id: number) => invoke('roles_delete', { id }),

  clinicGet: () => invoke<AnyRec>('clinic_get'),
  clinicUpdate: (p: AnyRec) => invoke('clinic_update', p),
  logoSave: (base64: string, mime: string) => invoke('logo_save', { base64, mime }),
  logoGet: () => invoke<{ base64: string; mime: string }>('logo_get'),

  dentistsList: () => invoke<Array<AnyRec>>('dentists_list'),
  dentistsSave: (p: AnyRec) => invoke<{ id: number }>('dentists_save', p),
  dentistsDelete: (id: number) => invoke('dentists_delete', { id }),

  printerProfiles: () => invoke<Array<AnyRec>>('printer_profiles_list'),
  printerProfileSave: (p: AnyRec) => invoke<{ id: number }>('printer_profiles_save', p),

  notifications: (unreadOnly = false) => invoke<{ rows: Array<AnyRec>; unread: number }>('notifications_list', { unreadOnly }),
  notificationsMark: (id?: number, all = false) => invoke('notifications_mark', { id, all }),
  notificationsClear: () => invoke('notifications_clear'),
  notificationsRefresh: () => invoke('notifications_refresh'),

  auditList: (p: AnyRec) => invoke<{ rows: Array<AnyRec>; total: number }>('audit_list', p),

  backupRun: (kind = 'manual') => invoke<{ id: number; filename: string; base64: string; sizeBytes: number; missing: string[] }>('backup_run', { kind }),
  backupList: () => invoke<Array<AnyRec>>('backup_list'),
  restoreValidate: (filename: string, base64: string) => invoke<AnyRec>('restore_validate', { filename, base64 }),
  restoreRun: (filename: string, base64: string, typed: string) => invoke('restore_run', { filename, base64, typed }),

  reportRun: (type: string, from: string, to: string) => invoke<{ columns: string[]; rows: Array<AnyRec>; total: number }>('report_run', { type, from, to }),
  dataExport: (module: string, format: string, from: string, to: string) => invoke<{ filename: string; base64: string; count: number }>('data_export', { module, format, from, to }),
  dataReset: (typed: string) => invoke('data_reset', { typed }),
};

export function downloadBase64(filename: string, base64: string, mime = 'application/octet-stream'): void {
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const blob = new Blob([bytes as BlobPart], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => {
      const s = String(r.result ?? '');
      resolve(s.includes(',') ? s.split(',')[1] : s);
    };
    r.onerror = () => reject(new Error('Could not read file.'));
    r.readAsDataURL(file);
  });
}
