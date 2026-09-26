// Dentiva Pro — reusable print rendering engine.
// Inputs: document type + data + printer profile + paper. Outputs: paginated HTML
// for preview, OS printing (all Windows printers incl. wireless/BT), and Save-as-PDF.

import { formatBdt } from '../lib/money';
import { formatDate, formatTime, ageFromDob } from '../lib/format';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>;

export type PaperSize = 'A4' | 'A5' | 'THERMAL_80' | 'THERMAL_58' | 'CUSTOM';

export interface PrinterProfile {
  name: string;
  paper_size: PaperSize;
  margins_mm: string;
  orientation: 'portrait' | 'landscape';
  font_scale: number;
  copies: number;
}

export interface PrintPackage {
  html: string;
  title: string;
  paper: PaperSize;
}

function esc(s: unknown): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function doseCell(it: R): string {
  const parts = [it.morning && `${it.morning} morning`, it.noon && `${it.noon} noon`, it.night && `${it.night} night`].filter(Boolean);
  const sched = parts.join(' + ') || esc(it.dosage || '—');
  const meal = it.meal_relation ? ` (${esc(it.meal_relation)})` : '';
  return `${sched}${meal}`;
}

export function buildPrescriptionHtml(args: {
  clinic: R; logoDataUrl: string; dentist: R; designations: string[];
  patient: R; rx: R; items: R[]; showCode: boolean; dateFormat: string; footerHours: string;
}): PrintPackage {
  const { clinic, logoDataUrl, dentist, designations, patient, rx, items } = args;
  const age = patient.age_years ? `${patient.age_years} y` : ageFromDob(patient.dob);
  const rows = items.map((it, i) => `
    <tr>
      <td>${i + 1}</td>
      <td><strong>${esc(it.medicine_name)}</strong>${it.generic_name ? `<br/><span style="font-size:10px;color:#444">${esc(it.generic_name)}</span>` : ''}</td>
      <td>${esc(it.form || '')}</td>
      <td>${esc(it.strength || '')}</td>
      <td>${doseCell(it)}${it.frequency ? `<br/>${esc(it.frequency)}` : ''}</td>
      <td>${esc(it.duration || '')}</td>
      <td>${esc(it.instruction || '')}${it.prn ? `<br/>PRN: ${esc(it.prn)}` : ''}${it.quantity ? `<br/>Qty: ${esc(it.quantity)}` : ''}</td>
    </tr>`).join('');
  const html = `
  <div class="dp-doc">
    <div class="dp-rx-head">
      ${logoDataUrl ? `<img class="dp-rx-logo" src="${logoDataUrl}" alt="Clinic logo"/>` : ''}
      <div class="dp-rx-clinic">
        <h1>${esc(clinic.name)}</h1>
        <div class="addr">${esc(clinic.address)}${clinic.phone ? ` · ${esc(clinic.phone)}` : ''}</div>
      </div>
      <div class="dp-rx-doc">
        <div class="dname">${esc(dentist?.name || '')}</div>
        ${designations.map((d) => `<div>${esc(d)}</div>`).join('')}
        ${dentist?.registration_no ? `<div>Reg: ${esc(dentist.registration_no)}</div>` : ''}
      </div>
    </div>
    <div class="dp-rx-patient">
      <span><strong>Patient:</strong> ${esc(patient.name)}</span>
      <span><strong>Age:</strong> ${esc(age)}</span>
      <span><strong>Gender:</strong> ${esc(patient.gender || '—')}</span>
      ${args.showCode ? `<span><strong>Code:</strong> ${esc(patient.code)}</span>` : ''}
      <span><strong>Date:</strong> ${esc(formatDate(rx.prescription_date, args.dateFormat as never))}</span>
    </div>
    <div class="dp-rx-body">
      <div class="dp-rx-left">
        <div class="dp-rx-sec"><h3>C/C</h3><div class="body">${esc(rx.cc_text || '—')}</div></div>
        <div class="dp-rx-sec"><h3>O/E</h3><div class="body">${esc(rx.oe_text || '—')}</div></div>
        <div class="dp-rx-sec"><h3>R/E</h3><div class="body">${esc(rx.re_text || '—')}</div></div>
        <div class="dp-rx-sec"><h3>Advice</h3><div class="body">${esc(rx.advice || clinic.message || '—')}</div></div>
        ${rx.follow_up ? `<div class="dp-rx-sec"><h3>Follow-up</h3><div class="body">${esc(rx.follow_up)}</div></div>` : ''}
      </div>
      <div class="dp-rx-right">
        <div style="font-size:22px;font-weight:700;color:#0f2240;margin-bottom:4px;">℞</div>
        <table class="dp-med-table">
          <thead><tr><th>#</th><th>Medicine</th><th>Form</th><th>Strength</th><th>Dosage</th><th>Duration</th><th>Instruction</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
        ${rx.notes ? `<div class="dp-rx-sec" style="margin-top:8px"><h3>Notes</h3><div class="body">${esc(rx.notes)}</div></div>` : ''}
      </div>
    </div>
    <div class="dp-rx-foot">
      <div>
        ${clinic.message ? `<div>${esc(clinic.message)}</div>` : ''}
        ${args.footerHours ? `<div>${esc(args.footerHours)}</div>` : ''}
        ${clinic.footer_text ? `<div>${esc(clinic.footer_text)}</div>` : ''}
      </div>
      <div class="dp-sign">
        <div class="space"></div>
        <div class="line">${esc(dentist?.name || 'Dentist')}<br/>Signature &amp; seal</div>
      </div>
    </div>
  </div>`;
  return { html, title: `Prescription_${patient.code}_${rx.prescription_date}`, paper: 'A4' };
}

export function buildInvoiceHtml(args: {
  clinic: R; logoDataUrl: string; invoice: R; items: R[]; showSignature: boolean; dateFormat: string;
}): PrintPackage {
  const { clinic, invoice, items } = args;
  const rows = items.map((it, i) => `
    <tr><td>${i + 1}</td><td>${esc(it.description)}${it.tooth_codes ? ` <span style="color:#555">(Teeth: ${esc(it.tooth_codes)})</span>` : ''}</td>
    <td style="text-align:center">${it.qty}</td><td style="text-align:right">${formatBdt(it.unit_price_paisa)}</td>
    <td style="text-align:right">${formatBdt(it.line_total_paisa)}</td></tr>`).join('');
  const due = invoice.total_paisa - invoice.paid_paisa;
  const html = `
  <div class="dp-doc">
    <div class="dp-rx-head">
      ${args.logoDataUrl ? `<img class="dp-rx-logo" src="${args.logoDataUrl}" alt="Clinic logo"/>` : ''}
      <div class="dp-rx-clinic">
        <h1>${esc(clinic.name)}</h1>
        <div class="addr">${esc(clinic.address)}${clinic.phone ? ` · ${esc(clinic.phone)}` : ''}</div>
      </div>
      <div class="dp-rx-doc">
        <div class="dname">INVOICE</div>
        <div><strong>${esc(invoice.invoice_no)}</strong></div>
        <div>${esc(formatDate(invoice.invoice_date, args.dateFormat as never))}</div>
        <div>Status: <strong>${esc(invoice.status)}</strong></div>
      </div>
    </div>
    <div class="dp-rx-patient">
      <span><strong>Patient:</strong> ${esc(invoice.patient_name)}</span>
      <span><strong>Code:</strong> ${esc(invoice.patient_code)}</span>
      ${invoice.patient_phone ? `<span><strong>Phone:</strong> ${esc(invoice.patient_phone)}</span>` : ''}
    </div>
    <table class="dp-inv-table">
      <thead><tr><th>#</th><th>Description</th><th>Qty</th><th>Unit price</th><th>Amount</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <div class="dp-inv-totals">
      <div class="row"><span>Subtotal</span><span>${formatBdt(invoice.subtotal_paisa)}</span></div>
      ${invoice.discount_paisa ? `<div class="row"><span>Discount</span><span>− ${formatBdt(invoice.discount_paisa)}</span></div>` : ''}
      ${invoice.tax_paisa ? `<div class="row"><span>Tax</span><span>${formatBdt(invoice.tax_paisa)}</span></div>` : ''}
      <div class="row grand"><span>Total</span><span>${formatBdt(invoice.total_paisa)}</span></div>
      <div class="row"><span>Paid</span><span>${formatBdt(invoice.paid_paisa)}</span></div>
      <div class="row grand"><span>Due</span><span>${formatBdt(due)}</span></div>
    </div>
    ${invoice.notes ? `<div style="margin-top:8px;font-size:11.5px"><strong>Notes:</strong> ${esc(invoice.notes)}</div>` : ''}
    <div class="dp-rx-foot">
      <div style="font-size:11px">${esc(clinic.footer_text || 'Thank you for choosing us. Please preserve this invoice for future reference.')}</div>
      ${args.showSignature ? '<div class="dp-sign"><div class="space"></div><div class="line">Authorized signature</div></div>' : '<div></div>'}
    </div>
  </div>`;
  return { html, title: `Invoice_${invoice.invoice_no}`, paper: 'A5' };
}

export function buildSummaryHtml(args: { clinic: R; logoDataUrl: string; patient: R; visits: R[]; financials: R | null; dateFormat: string }): PrintPackage {
  const { clinic, patient, visits, financials } = args;
  const vrows = visits.slice(0, 20).map((v) => `
    <tr><td>${esc(formatDate(v.visit_date, args.dateFormat as never))}</td><td>${esc(v.dentist_name || '')}</td>
    <td>${esc(v.complaint || '')}</td><td>${esc(v.diagnosis || '')}</td></tr>`).join('');
  const html = `
  <div class="dp-doc">
    <div class="dp-rx-head">
      ${args.logoDataUrl ? `<img class="dp-rx-logo" src="${args.logoDataUrl}" alt="Clinic logo"/>` : ''}
      <div class="dp-rx-clinic"><h1>${esc(clinic.name)}</h1>
      <div class="addr">${esc(clinic.address)}${clinic.phone ? ` · ${esc(clinic.phone)}` : ''}</div></div>
      <div class="dp-rx-doc"><div class="dname">Patient Summary</div></div>
    </div>
    <div class="dp-rx-patient">
      <span><strong>Patient:</strong> ${esc(patient.name)}</span>
      <span><strong>Code:</strong> ${esc(patient.code)}</span>
      <span><strong>Age:</strong> ${esc(patient.age_years ? `${patient.age_years} y` : ageFromDob(patient.dob))}</span>
      <span><strong>Gender:</strong> ${esc(patient.gender || '—')}</span>
      <span><strong>Phone:</strong> ${esc(patient.phone || '—')}</span>
      <span><strong>Blood:</strong> ${esc(patient.blood_group || '—')}</span>
    </div>
    ${patient.allergies ? `<div class="dp-rx-sec"><h3>Allergies</h3><div class="body">${esc(patient.allergies)}</div></div>` : ''}
    <div class="dp-rx-sec"><h3>Recent visits</h3>
      <table class="dp-inv-table"><thead><tr><th>Date</th><th>Dentist</th><th>Complaint</th><th>Diagnosis</th></tr></thead>
      <tbody>${vrows || '<tr><td colspan="4">No visits recorded.</td></tr>'}</tbody></table>
    </div>
    ${financials ? `<div class="dp-rx-sec"><h3>Financial summary</h3>
      <div>Total billed: <strong>${formatBdt(financials.billed)}</strong> · Paid: <strong>${formatBdt(financials.paid)}</strong> · Outstanding: <strong>${formatBdt(financials.outstanding)}</strong></div>
    </div>` : ''}
  </div>`;
  return { html, title: `Summary_${patient.code}`, paper: 'A4' };
}

export function buildReportHtml(args: { clinic: R; title: string; from: string; to: string; columns: string[]; rows: R[]; moneyCols?: number[] }): PrintPackage {
  const { clinic } = args;
  const keys = args.rows.length ? Object.keys(args.rows[0]) : [];
  const body = args.rows.map((r) => `<tr>${keys.map((k, i) => {
    const v = r[k];
    const cell = args.moneyCols?.includes(i) && typeof v === 'number' ? formatBdt(v) : esc(v ?? '');
    return `<td${typeof v === 'number' ? ' style="text-align:right"' : ''}>${cell}</td>`;
  }).join('')}</tr>`).join('');
  const html = `
  <div class="dp-doc">
    <div class="dp-rx-head">
      <div class="dp-rx-clinic"><h1>${esc(clinic.name)}</h1>
      <div class="addr">${esc(args.title)} · ${esc(args.from)} to ${esc(args.to)}</div></div>
      <div class="dp-rx-doc"><div>${esc(formatDate(new Date().toISOString().slice(0, 10), 'DD MMM YYYY'))} ${esc(formatTime(new Date().toTimeString().slice(0, 5)))}</div></div>
    </div>
    <table class="dp-inv-table">
      <thead><tr>${args.columns.map((c) => `<th>${esc(c)}</th>`).join('')}</tr></thead>
      <tbody>${body || `<tr><td colspan="${args.columns.length}">No records.</td></tr>`}</tbody>
    </table>
  </div>`;
  return { html, title: args.title.replace(/\s+/g, '_'), paper: 'A4' };
}

/** Send a package to the OS printer (covers all Windows printers + Save as PDF). */
export function printPackage(pkg: PrintPackage, paper: PaperSize, orientation: 'portrait' | 'landscape' = 'portrait', fontScale = 1): void {
  const root = ensurePrintRoot();
  const pageSize = paper === 'A5' ? 'A5' : paper.startsWith('THERMAL') ? '80mm auto' : 'A4';
  root.innerHTML = `
    <style>@page { size: ${pageSize} ${orientation}; margin: 8mm; }</style>
    <div style="font-size:${fontScale * 100}%">${pkg.html}</div>`;
  document.title = pkg.title;
  document.body.classList.add('printing');
  const cleanup = () => {
    document.body.classList.remove('printing');
    root.innerHTML = '';
    document.title = 'Dentiva Pro — Dental Clinic Management';
    window.removeEventListener('afterprint', cleanup);
  };
  window.addEventListener('afterprint', cleanup);
  // Fallback cleanup in case afterprint does not fire (e.g. dialog dismissed oddly).
  setTimeout(() => { if (document.body.classList.contains('printing')) cleanup(); }, 120000);
  window.print();
}

function ensurePrintRoot(): HTMLElement {
  let root = document.getElementById('print-root');
  if (!root) {
    root = document.createElement('div');
    root.id = 'print-root';
    root.style.display = 'none';
    document.body.appendChild(root);
  }
  return root;
}

/** Wrap raw attachment bytes as printable HTML for images (PDFs print natively). */
export function printableImageHtml(dataUrl: string, caption: string): PrintPackage {
  return {
    title: caption,
    paper: 'A4',
    html: `<div class="dp-doc"><h3 style="color:#0f2240">${esc(caption)}</h3><img src="${dataUrl}" style="max-width:100%" alt="${esc(caption)}"/></div>`,
  };
}
