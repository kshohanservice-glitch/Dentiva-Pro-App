// Dentiva Pro — system seed data (permissions, roles, tooth conditions,
// accounting categories, default settings, printer profiles). Shared conceptually
// with the Rust backend; both seed identically-named rows.

import { PERMISSIONS, DEFAULT_ROLE_GRANTS } from '../lib/permissions';

export const SCHEMA_VERSION = 1;
export const APP_VERSION = '1.0.0';

export const TOOTH_CONDITIONS = [
  { code: 'healthy', name: 'Healthy', color: '#10b981', sort: 0 },
  { code: 'caries', name: 'Caries', color: '#ef4444', sort: 1 },
  { code: 'restoration', name: 'Restoration / Filling', color: '#3b82f6', sort: 2 },
  { code: 'missing', name: 'Missing', color: '#64748b', sort: 3 },
  { code: 'extraction', name: 'Extraction advised/done', color: '#f97316', sort: 4 },
  { code: 'impacted', name: 'Impacted', color: '#a855f7', sort: 5 },
  { code: 'root_canal', name: 'Root canal treated', color: '#0ea5e9', sort: 6 },
  { code: 'crown', name: 'Crown', color: '#eab308', sort: 7 },
  { code: 'bridge', name: 'Bridge', color: '#ca8a04', sort: 8 },
  { code: 'fracture', name: 'Fracture', color: '#dc2626', sort: 9 },
  { code: 'mobility', name: 'Mobility', color: '#fb7185', sort: 10 },
  { code: 'perio', name: 'Periodontal issue', color: '#f43f5e', sort: 11 },
  { code: 'watch', name: 'Watch / review', color: '#8b5cf6', sort: 12 },
] as const;

export const ACCOUNTING_CATEGORIES = [
  { kind: 'income', name: 'Consultation', description: 'Consultation fees' },
  { kind: 'income', name: 'Treatment', description: 'Treatment income' },
  { kind: 'income', name: 'Other income', description: 'Miscellaneous income' },
  { kind: 'expense', name: 'Clinic rent', description: '' },
  { kind: 'expense', name: 'Electricity', description: '' },
  { kind: 'expense', name: 'Internet', description: '' },
  { kind: 'expense', name: 'Accessories', description: '' },
  { kind: 'expense', name: 'Dental supplies', description: '' },
  { kind: 'expense', name: 'Staff salary', description: '' },
  { kind: 'expense', name: 'Maintenance', description: '' },
  { kind: 'expense', name: 'Transport', description: '' },
  { kind: 'expense', name: 'Marketing', description: '' },
  { kind: 'expense', name: 'Equipment', description: '' },
  { kind: 'expense', name: 'Miscellaneous', description: '' },
] as const;

export const DEFAULT_SETTINGS: Record<string, string> = {
  currency: 'BDT',
  date_format: 'DD MMM YYYY',
  time_format: '12h',
  default_paper_size: 'A4',
  patient_code_prefix: 'DP-',
  patient_code_next: '1',
  patient_code_pad: '5',
  invoice_prefix: 'INV-',
  invoice_next: '1',
  receipt_prefix: 'RCP-',
  receipt_next: '1',
  auto_lock_minutes: '15',
  allow_never_lock: '0',
  session_timeout_minutes: '480',
  backup_location: '',
  auto_backup_days: '7',
  last_auto_backup: '',
  prescription_show_code: '1',
  invoice_show_signature: '0',
  invoice_tax_percent: '0',
  clinic_message_default: 'Take care of your smile. Follow the prescribed advice and visit for follow-up as advised.',
};

export const DEFAULT_PRINTER_PROFILES = [
  { name: 'Prescription — A4', document_type: 'prescription', paper_size: 'A4', margins_mm: '12,12,14,12', orientation: 'portrait', font_scale: 1.0, is_default: 1 },
  { name: 'Prescription — A5', document_type: 'prescription', paper_size: 'A5', margins_mm: '10,10,12,10', orientation: 'portrait', font_scale: 0.92, is_default: 0 },
  { name: 'Invoice — A5', document_type: 'invoice', paper_size: 'A5', margins_mm: '10,10,10,10', orientation: 'portrait', font_scale: 1.0, is_default: 1 },
  { name: 'Invoice — Thermal 80mm', document_type: 'invoice', paper_size: 'THERMAL_80', margins_mm: '4,4,4,4', orientation: 'portrait', font_scale: 0.95, is_default: 0 },
  { name: 'Patient Summary — A4', document_type: 'summary', paper_size: 'A4', margins_mm: '12,12,14,12', orientation: 'portrait', font_scale: 1.0, is_default: 1 },
  { name: 'Report — A4', document_type: 'report', paper_size: 'A4', margins_mm: '12,12,14,12', orientation: 'portrait', font_scale: 1.0, is_default: 1 },
] as const;

export { PERMISSIONS, DEFAULT_ROLE_GRANTS };
