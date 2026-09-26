import { describe, it, expect } from 'vitest';
import { buildPrescriptionHtml, buildInvoiceHtml, buildSummaryHtml } from '../../src/print/engine';

const clinic = { name: 'Smile Dental Care', address: 'Dhaka', phone: '01700000000', message: 'Get well soon', footer_text: 'Thank you' };

describe('print engine', () => {
  it('builds a prescription with C/C O/E R/E, meds, and signature space', () => {
    const pkg = buildPrescriptionHtml({
      clinic,
      logoDataUrl: '',
      dentist: { name: 'Dr. Test' },
      designations: ['BDS (DU)'],
      patient: { name: 'Karim', code: 'DP-00001', gender: 'Male', age_years: 30 },
      rx: { prescription_date: '2026-09-26', cc_text: 'Pain', oe_text: 'Caries', re_text: 'X-ray advised', advice: 'Rest' },
      items: [{ medicine_name: 'Napa 500mg', form: 'Tablet', morning: '1', noon: '0', night: '1', meal_relation: 'After meal', duration: '7 days' }],
      showCode: true,
      dateFormat: 'DD MMM YYYY',
      footerHours: 'Visiting hours: 9–9',
    });
    expect(pkg.html).toContain('C/C');
    expect(pkg.html).toContain('O/E');
    expect(pkg.html).toContain('Napa 500mg');
    expect(pkg.html).toContain('Signature &amp; seal');
    expect(pkg.html).toContain('DP-00001');
    expect(pkg.html).toContain('BDS (DU)');
  });

  it('escapes HTML in clinical text (no injection into print)', () => {
    const pkg = buildPrescriptionHtml({
      clinic, logoDataUrl: '', dentist: {}, designations: [],
      patient: { name: '<img src=x onerror=alert(1)>', code: 'X', gender: '', age_years: null },
      rx: { prescription_date: '2026-09-26' }, items: [],
      showCode: true, dateFormat: 'DD MMM YYYY', footerHours: '',
    });
    expect(pkg.html).not.toContain('<img src=x');
    expect(pkg.html).toContain('&lt;img');
  });

  it('builds an invoice with totals in BDT and no signature by default decision', () => {
    const pkg = buildInvoiceHtml({
      clinic, logoDataUrl: '',
      invoice: { invoice_no: 'INV-1', invoice_date: '2026-09-26', status: 'Due', patient_name: 'Karim', patient_code: 'DP-1', subtotal_paisa: 50000, discount_paisa: 0, tax_paisa: 0, total_paisa: 50000, paid_paisa: 20000 },
      items: [{ description: 'Scaling', qty: 1, unit_price_paisa: 50000, line_total_paisa: 50000 }],
      showSignature: false,
      dateFormat: 'DD MMM YYYY',
    });
    expect(pkg.html).toContain('৳ 500.00');
    expect(pkg.html).toContain('৳ 300.00');
    expect(pkg.html).not.toContain('Authorized signature');
  });

  it('renders Bengali text through unchanged', () => {
    const pkg = buildSummaryHtml({
      clinic, logoDataUrl: '',
      patient: { name: 'করিম উদ্দিন', code: 'DP-2', age_years: 40, gender: 'Male', phone: '', blood_group: '', allergies: 'পেনিসিলিন' },
      visits: [], financials: null, dateFormat: 'DD MMM YYYY',
    });
    expect(pkg.html).toContain('করিম উদ্দিন');
    expect(pkg.html).toContain('পেনিসিলিন');
  });
});
