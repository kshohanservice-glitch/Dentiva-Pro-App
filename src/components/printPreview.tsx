// Dentiva Pro — print preview modal with real paper dimensions + profile picker.

import { useEffect, useState } from 'react';
import { api } from '../api';
import { useApp } from '../state/app';
import { Modal, Btn, Select, Field } from './ui';
import { printPackage, type PrintPackage, type PaperSize } from '../print/engine';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>;

export function PrintPreviewModal({ docType, pkg, onClose }: { docType: string; pkg: PrintPackage; onClose: () => void }) {
  const { settings, toast } = useApp();
  const [profiles, setProfiles] = useState<R[]>([]);
  const [profileId, setProfileId] = useState<number | ''>('');
  const [paper, setPaper] = useState<PaperSize>(pkg.paper);
  const [orientation, setOrientation] = useState<'portrait' | 'landscape'>('portrait');
  const [fontScale, setFontScale] = useState(1);

  useEffect(() => {
    api.printerProfiles().then((p) => {
      const list = (p as R[]).filter((x) => x.document_type === docType || x.document_type === 'report');
      setProfiles(list);
      const def = list.find((x) => x.is_default) ?? list[0];
      if (def) {
        setProfileId(def.id);
        setPaper(def.paper_size as PaperSize);
        setOrientation(def.orientation === 'landscape' ? 'landscape' : 'portrait');
        setFontScale(Number(def.font_scale) || 1);
      } else if (settings.default_paper_size) {
        setPaper(settings.default_paper_size as PaperSize);
      }
    }).catch(() => {});
  }, [docType, settings.default_paper_size]);

  const pickProfile = (id: number) => {
    setProfileId(id);
    const p = profiles.find((x) => x.id === id);
    if (p) {
      setPaper(p.paper_size as PaperSize);
      setOrientation(p.orientation === 'landscape' ? 'landscape' : 'portrait');
      setFontScale(Number(p.font_scale) || 1);
    }
  };

  const doPrint = () => {
    try {
      printPackage(pkg, paper, orientation, fontScale);
    } catch {
      toast({ kind: 'error', title: 'Print failed', message: 'No printer is available. Choose "Save as PDF" in the print dialog, or pick another printer profile.' });
    }
  };

  const dims: Record<string, { w: string; minH: string }> = {
    A4: { w: '210mm', minH: '296mm' },
    A5: { w: '148mm', minH: '209mm' },
    THERMAL_80: { w: '80mm', minH: '120mm' },
    THERMAL_58: { w: '58mm', minH: '120mm' },
    CUSTOM: { w: '210mm', minH: '296mm' },
  };
  const d = dims[paper] ?? dims.A4;

  return (
    <Modal title={`Print preview — ${pkg.title}`} onClose={onClose} size="xl" actions={
      <>
        <span className="muted small" style={{ marginRight: 'auto' }}>Use your printer dialog for wireless / Bluetooth printers or “Save as PDF”.</span>
        <Btn kind="ghost" onClick={onClose}>Close</Btn>
        <Btn kind="primary" onClick={doPrint}>Print / Save as PDF</Btn>
      </>
    }>
      <div className="toolbar">
        <Field label="Printer profile">
          <Select value={profileId} onChange={(e) => pickProfile(Number(e.target.value))} style={{ minWidth: 220 }}>
            <option value="">Custom (no profile)</option>
            {profiles.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </Select>
        </Field>
        <Field label="Paper">
          <Select value={paper} onChange={(e) => setPaper(e.target.value as PaperSize)}>
            <option value="A4">A4</option>
            <option value="A5">A5</option>
            <option value="THERMAL_80">Thermal 80mm</option>
            <option value="THERMAL_58">Thermal 58mm</option>
          </Select>
        </Field>
        <Field label="Orientation">
          <Select value={orientation} onChange={(e) => setOrientation(e.target.value as 'portrait' | 'landscape')}>
            <option value="portrait">Portrait</option>
            <option value="landscape">Landscape</option>
          </Select>
        </Field>
        <Field label="Font scale">
          <Select value={String(fontScale)} onChange={(e) => setFontScale(Number(e.target.value))}>
            {[0.8, 0.9, 0.95, 1, 1.05, 1.1, 1.2].map((f) => <option key={f} value={String(f)}>{Math.round(f * 100)}%</option>)}
          </Select>
        </Field>
      </div>
      <div style={{ background: 'var(--dp-surface-3)', padding: 20, borderRadius: 10, overflow: 'auto', maxHeight: '62vh' }}>
        <div
          className="print-preview-paper"
          style={{
            width: orientation === 'landscape' ? d.minH : d.w,
            minHeight: orientation === 'landscape' ? d.w : d.minH,
            padding: paper.startsWith('THERMAL') ? '4mm' : '10mm',
            fontSize: `${fontScale * 100}%`,
          }}
          dangerouslySetInnerHTML={{ __html: pkg.html }}
        />
      </div>
    </Modal>
  );
}
