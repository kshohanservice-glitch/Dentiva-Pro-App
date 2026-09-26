# Dentiva Pro — Permission Matrix (RBAC)

Enforced in the **command layer** (Rust + fallback backend). UI visibility mirrors
permissions but is never the enforcement point.

## Permission codes (module.grouped)

### Patients
- `patients.view` `patients.create` `patients.edit` `patients.delete`
- `patients.attachments` `patients.merge` `patients.export`

### Clinical
- `clinical.view` `clinical.create_visit` `clinical.edit_visit` `clinical.delete_visit`
- `clinical.chart` `clinical.referral`

### Treatments & prescriptions
- `treatments.manage`
- `prescriptions.create` `prescriptions.edit` `prescriptions.print`

### Appointments & queue
- `appointments.view` `appointments.manage` `queue.manage`

### Billing
- `invoices.view` `invoices.create` `invoices.edit` `invoices.delete` `invoices.print`
- `payments.view` `payments.record` `payments.reverse`

### Inventory / accounting
- `inventory.view` `inventory.manage`
- `accounting.view` `accounting.manage`

### Administration
- `staff.view` `staff.manage`
- `users.manage` `roles.manage`
- `settings.manage` `printers.manage`
- `backup.run` `backup.restore`
- `audit.view`
- `reports.view` `reports.financial`
- `data.danger` (delete-all / reset — typed confirmation + pre-backup)

## Default role grants

| Capability              | Owner | Admin | Dentist | Receptionist | Assistant | Accountant | Inv.Mgr |
|-------------------------|:-----:|:-----:|:-------:|:------------:|:---------:|:----------:|:-------:|
| patients.*              |  full |  full | view    | create/edit/view | view   | view       | —       |
| clinical.*              |  full |  full | full    | —            | create/view | —        | —       |
| prescriptions           |  full |  full | full    | —            | —       | —          | —       |
| appointments/queue      |  full |  full | view    | full         | view    | —          | —       |
| invoices/payments       |  full |  full | —       | view*        | —       | full       | —       |
| inventory               |  full |  full | —       | —            | —       | —          | full    |
| accounting              |  full |  full | —       | —            | —       | full       | —       |
| staff/users/roles       |  full |  full | —       | —            | —       | —          | —       |
| backup/restore          |  full |  full | —       | —            | —       | —          | —       |
| audit                   |  full |  full | —       | —            | —       | view       | —       |
| reports / financial rep |  full |  full | clinical| —            | —       | full       | stock   |
| data.danger             |  yes  |  —    | —       | —            | —       | —          | —       |

`*` Receptionist `invoices.view`/`payments.view` are OFF by default; owner may grant.
Custom roles are fully configurable. Every grant/revoke is audit-logged with
before/after permission sets.
