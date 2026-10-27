# Siram Go! — Watering Log

## Who can open which page

| Page | Admin | Worker (operator) | FC | Outside account |
|---|---|---|---|---|
| `index.html` (login) | ✅ | ✅ | ✅ | ✅ |
| `form.html` (watering form) | ✅ | ✅ | ❌ sent to dashboard | ❌ sent to dashboard |
| `records.html` (Rekod) | ✅ | ✅ | ❌ sent to dashboard | ❌ sent to dashboard |
| `dashboard.html` | ✅ | ✅ | ✅ | ✅ but sees no data |
| `payroll.html` | ✅ | ❌ sent to dashboard | ❌ sent to dashboard | ❌ sent to dashboard |

After logging in, FCs land on the dashboard and everyone else lands on the form.

## How a person gets their role

A person's role comes from which list their email is on in the database:

- **Admin**: `watering_admins`
- **Worker (operator)**: `watering_workers`
- **FC**: `watering_field_coordinators`
- **Outside account**: on none of these lists

To give someone access, add their email to the right list.

## If operators suddenly get sent to the dashboard

The database is shared with other MJM apps. A security change made in another app can stop operators from seeing their own name on the worker list. When that happens, the form treats them as an outside account and they also can't save records.

This happened in Oct 2026 and was fixed by
[supabase/migrations/20261027000000_watering_member_access.sql](supabase/migrations/20261027000000_watering_member_access.sql).
Every rule on the `watering_*` tables must allow `_mjm_ops_staff() or _watering_member()`. Any new watering table needs the same rule.

While it's broken, tell operators **not to log out or clear the app**, so the records waiting on their phones aren't lost.
