// nav.js — shared page navigation for Siram Go!
// Draws the Rekod / Dashboard / Payroll Report buttons on every page.
//
// Who sees which buttons:
//   admin   → Rekod, Dashboard, Payroll Report
//   worker  → Rekod, Dashboard
//   FC      → none
//   anyone else (merged-app users) → none
// The button for the page you are already on is left out.
//
// The bar starts hidden and only appears once the role is known, so a Field
// Coordinator never sees a flash of buttons they shouldn't have. The answer is
// cached per email in localStorage, so the bar still works offline and never
// carries over to a different user on a shared phone.
//
// This file NEVER touches login or session state. It only reads the three
// membership tables and writes its own cache key.

(function () {
    const ROLE_CACHE_KEY = 'wl_nav_role_v1';

    const BTN = {
        records:   { href: 'records.html',   label: '📋 Rekod',          bg: '#6c757d' },
        dashboard: { href: 'dashboard.html', label: '📊 Dashboard',      bg: '#007bff' },
        payroll:   { href: 'payroll.html',   label: '💰 Payroll Report', bg: '#6f42c1' }
    };

    const BUTTONS_FOR_ROLE = {
        admin:  ['records', 'dashboard', 'payroll'],
        worker: ['records', 'dashboard'],
        fc:     [],
        other:  []
    };

    function readCachedRole(email) {
        try {
            const cached = JSON.parse(localStorage.getItem(ROLE_CACHE_KEY) || 'null');
            return (cached && cached.email === email) ? cached.role : null;
        } catch (e) { return null; }
    }

    function writeCachedRole(email, role) {
        try {
            localStorage.setItem(ROLE_CACHE_KEY, JSON.stringify({ email: email, role: role }));
        } catch (e) { /* private mode or full storage — bar still works this session */ }
    }

    function render(role, currentPage) {
        const host = document.getElementById('wlNav');
        if (!host) return;

        const keys = (BUTTONS_FOR_ROLE[role] || []).filter((k) => k !== currentPage);
        if (keys.length === 0) { host.style.display = 'none'; return; }

        host.innerHTML =
            '<div style="display:flex; gap:10px; justify-content:center; flex-wrap:wrap;">' +
            keys.map((k) => {
                const b = BTN[k];
                return '<a href="' + b.href + '" style="text-decoration:none; background:' + b.bg +
                       '; color:white; padding:12px 20px; border-radius:8px; font-weight:bold;">' +
                       b.label + '</a>';
            }).join('') +
            '</div>';
        host.style.display = '';
    }

    // Returns 'admin' | 'worker' | 'fc' | 'other', or null when the answer is
    // inconclusive. Supabase returns failures in `error` rather than throwing,
    // so every error is checked — a network blip must not strip an admin's
    // buttons, nor hand an FC a set of buttons.
    async function resolveRole(client, email) {
        const [adminRes, workerRes, fcRes] = await Promise.all([
            client.from('watering_admins').select('email').eq('email', email).maybeSingle(),
            client.from('watering_workers').select('email').eq('email', email).maybeSingle(),
            client.from('watering_field_coordinators').select('email').eq('email', email).maybeSingle()
        ]);
        if (adminRes.error || workerRes.error || fcRes.error) return null;
        if (adminRes.data) return 'admin';
        if (workerRes.data) return 'worker';
        if (fcRes.data) return 'fc';
        return 'other';
    }

    // currentPage: 'records' | 'dashboard' | 'payroll' | '' (home)
    window.renderWateringNav = async function (currentPage, client) {
        const email = localStorage.getItem('loggedInUser');
        if (!email) return;

        // Paint from cache first — this is also the whole story when offline.
        const cached = readCachedRole(email);
        if (cached) render(cached, currentPage);

        if (!navigator.onLine) return;

        const supa = client || (typeof _supabase !== 'undefined' ? _supabase : null);
        if (!supa) return;

        try {
            const role = await resolveRole(supa, email);
            if (!role) return; // inconclusive — keep showing whatever the cache had
            writeCachedRole(email, role);
            render(role, currentPage);
        } catch (e) {
            /* threw unexpectedly — keep the cached view */
        }
    };
})();
