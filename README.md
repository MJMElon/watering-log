# Siram Go! — Watering Log

## Who can open which page

| Page | Admin | Worker (operator) | FC | Outside account |
|---|---|---|---|---|
| `index.html` (login) | ✅ | ✅ | ✅ | ✅ |
| `form.html` (watering form) | ✅ | ✅ | ❌ sent to dashboard | ❌ sent to dashboard |
| `records.html` (Rekod) | ✅ | ✅ | ❌ sent to dashboard | ❌ sent to dashboard |
| `dashboard.html` | ✅ | ✅ | ✅ | ✅ but sees no data |
| `payroll.html` | ✅ | ❌ sent to dashboard | ❌ sent to dashboard | ❌ sent to dashboard |
| `settings.html` (Tetapan) | ✅ | ❌ sent to dashboard | ❌ sent to dashboard | ❌ sent to dashboard |

After logging in, FCs land on the dashboard and everyone else lands on the form.

## How a person gets their role

A person's role comes from which list their email is on in the database:

- **Admin**: `watering_admins`
- **Worker (operator)**: `watering_workers`
- **FC**: `watering_field_coordinators`
- **Outside account**: on none of these lists

To give someone access, add their email to the right list.

## Adding or hiding a plot

The worker form, Dashboard, Rekod, and Payroll read the plot list from `plots.js`. Once `watering_plots` exists, that table overrides the built-in list. Until the SQL below has been run, the built-in list is what everyone sees, and Tetapan cannot save.

An admin opens **Tetapan** from the nav bar on Rekod, Dashboard, or Payroll. Workers, FCs, and other accounts do not get the button, and opening `settings.html` directly sends them to the dashboard.

- **Tambah plot** — pick BNN, UNN1, or UNN2 and a plot name (for example `B15`). The plot shows up on the worker form (including offline, after the phone has loaded the list once), on the live Dashboard, in Rekod filters, and as a new bibit row in Payroll. Area bibit totals include it. Typing a name that was previously removed turns that row active again, including its saved bibit count.
- **Buang** — asks for confirmation, then sets `active` to false. The row is not deleted, and it disappears from the Tetapan list. The plot leaves the worker form and the live Dashboard. On Payroll it also leaves a month that has no watering record for it and no saved claim row for it. A month that still has a watering record, or a saved claim that already includes the plot, keeps the bibit row so updating that month does not drop the old claim. Rekod, CSV, and the xlsx report still show the plot for ranges that contain its records.

Run this once in the Supabase SQL Editor (Dashboard → SQL Editor → paste → Run):

[supabase/migrations/20261115000000_watering_plots.sql](supabase/migrations/20261115000000_watering_plots.sql)

Nurseries stay BNN, UNN1, and UNN2. Those three are still fixed in the form, Dashboard, and Payroll.

## If operators suddenly get sent to the dashboard

The database is shared with other MJM apps. A security change made in another app can stop operators from seeing their own name on the worker list. When that happens, the form treats them as an outside account and they also can't save records.

This happened in Oct 2026 and was fixed by
[supabase/migrations/20261027000000_watering_member_access.sql](supabase/migrations/20261027000000_watering_member_access.sql).
Every rule on the `watering_*` tables must allow `_mjm_ops_staff() or _watering_member()`. Any new watering table needs the same rule.

While it's broken, tell operators **not to log out or clear the app**, so the records waiting on their phones aren't lost.
