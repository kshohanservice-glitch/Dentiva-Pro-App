// Dentiva Pro — root component: boot gating (activation → setup → login → app).

import { AppProvider, useApp } from './state/app';
import { Shell } from './components/layout';
import { Loading } from './components/ui';
import { ActivationScreen } from './features/activation';
import { SetupWizard } from './features/setup';
import { LoginScreen, LockScreen } from './features/login';
import { DashboardPage } from './features/dashboard';
import { PatientsPage, PatientProfilePage } from './features/patients';
import { AppointmentsPage } from './features/appointments';
import { QueuePage } from './features/queue';
import { TreatmentsPage } from './features/treatments';
import { PrescriptionsPage } from './features/prescriptions';
import { InvoicesPage, InvoiceDetailPage } from './features/invoices';
import { PaymentsPage } from './features/payments';
import { InventoryPage } from './features/inventory';
import { AccountingPage } from './features/accounting';
import { StaffPage } from './features/staff';
import { ReportsPage } from './features/reports';
import { AuditPage } from './features/audit';
import { BackupPage } from './features/backup';
import { SettingsPage } from './features/settings';
import { AboutPage } from './features/about';

function Router() {
  const { route, routeParam, can } = useApp();
  const deny = (code: string) => !can(code) && (
    <div className="card card-pad">
      <h3 className="card-title">Access restricted</h3>
      <p className="muted">Your role does not include the <strong>{code}</strong> permission. Contact your administrator.</p>
    </div>
  );
  switch (route) {
    case 'dashboard': return <DashboardPage />;
    case 'patients':
      if (routeParam) return <PatientProfilePage id={routeParam} />;
      return deny('patients.view') || <PatientsPage />;
    case 'appointments': return deny('appointments.view') || <AppointmentsPage />;
    case 'queue': return deny('queue.manage') || <QueuePage />;
    case 'treatments': return deny('clinical.view') || <TreatmentsPage />;
    case 'prescriptions': return deny('clinical.view') || <PrescriptionsPage />;
    case 'invoices':
      if (routeParam) return <InvoiceDetailPage id={routeParam} />;
      return deny('invoices.view') || <InvoicesPage />;
    case 'payments': return deny('payments.view') || <PaymentsPage />;
    case 'inventory': return deny('inventory.view') || <InventoryPage />;
    case 'accounting': return deny('accounting.view') || <AccountingPage />;
    case 'staff': return deny('staff.view') || <StaffPage />;
    case 'reports': return deny('reports.view') || <ReportsPage />;
    case 'audit': return deny('audit.view') || <AuditPage />;
    case 'backup': return deny('backup.run') || <BackupPage />;
    case 'settings': return <SettingsPage />;
    case 'about': return <AboutPage />;
    default: return <DashboardPage />;
  }
}

function Gate() {
  const { status, loading } = useApp();
  if (loading || !status) {
    return (
      <div className="auth-wrap">
        <div className="auth-card" style={{ textAlign: 'center' }}>
          <Loading label="Starting Dentiva Pro…" />
        </div>
      </div>
    );
  }
  if (!status.activated) return <ActivationScreen />;
  if (!status.setupComplete) return <SetupWizard />;
  if (!status.session) return <LoginScreen />;
  if (status.locked) return <LockScreen />;
  return (
    <Shell>
      <Router />
    </Shell>
  );
}

export default function App() {
  return (
    <AppProvider>
      <Gate />
    </AppProvider>
  );
}
