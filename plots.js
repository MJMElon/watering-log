// Nursery plots for Siram Go!
//
// plotData     — ACTIVE plots only. The worker form, the live dashboard,
//                and new payroll entry read this.
// allPlotData  — every known plot, including ones an admin has hidden.
//                Rekod, CSV, and the xlsx report use this so old rows
//                for a hidden plot still filter, export, and land on
//                the right nursery.
//
// Both start as the built-in list. A successful read of watering_plots
// overlays that list (the table wins on nursery, order, and active) and
// is cached in localStorage so the worker form still has the latest list
// offline. If the table does not exist yet, or the phone is offline with
// no cache, the built-in list is the whole story. Hidden plots are never
// removed from allPlotData.

const WATERING_NURSERIES = ['BNN', 'UNN1', 'UNN2'];
const RESERVED_PLOT_NAMES = { BNN: true, UNN1: true, UNN2: true };
const PLOT_CACHE_KEY = 'wl_plots_v1';

const BUILTIN_PLOTS = {
    BNN: ["B1", "B2", "B3", "B4", "B5", "B6", "B7", "B8", "B9", "B10", "B11", "B12", "B13", "B14"],
    UNN1: ["U1", "U2", "U3", "U4", "U5", "U6", "U7", "U8", "U9", "U10", "U11", "U12", "U13", "U14", "U15", "U16", "U17", "U18"],
    UNN2: ["N1", "N2", "N3", "N4", "N5", "N6", "N7", "N8", "N9", "N10", "N11", "N12", "N13", "N14", "N15", "N16", "N17", "N18", "N19", "N20"]
};

const plotData = {
    BNN: BUILTIN_PLOTS.BNN.slice(),
    UNN1: BUILTIN_PLOTS.UNN1.slice(),
    UNN2: BUILTIN_PLOTS.UNN2.slice()
};

const allPlotData = {
    BNN: BUILTIN_PLOTS.BNN.slice(),
    UNN1: BUILTIN_PLOTS.UNN1.slice(),
    UNN2: BUILTIN_PLOTS.UNN2.slice()
};

let plotRecordList = builtinPlotRecords();
let wateringPlotsStatus = { tableReady: false, source: 'builtin', problem: null };
let plotsLoadInflight = null;
let plotsReadWarned = false;
let foregroundClient = null;
let foregroundWatchStarted = false;
let foregroundRefreshTimer = null;
const plotUpdateListeners = [];

function builtinPlotRecords() {
    const rows = [];
    WATERING_NURSERIES.forEach((nursery) => {
        (BUILTIN_PLOTS[nursery] || []).forEach((name, index) => {
            rows.push({
                nursery: nursery,
                plot_name: name,
                active: true,
                sort_order: index + 1
            });
        });
    });
    return rows;
}

function comparePlotNames(a, b) {
    return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' });
}

// Remote or cached rows win over the built-in list for the same plot name.
// Built-in plots missing from the table stay active, so an empty table
// (SQL not seeded) still shows today's nurseries.
function applyWateringPlotRows(rows) {
    const byName = new Map();
    builtinPlotRecords().forEach((row) => byName.set(row.plot_name, row));

    (rows || []).forEach((row) => {
        const nursery = String(row.nursery || '').trim();
        const plotName = String(row.plot_name || '').trim().toUpperCase();
        if (!WATERING_NURSERIES.includes(nursery) || !plotName) return;
        if (RESERVED_PLOT_NAMES[plotName]) return;
        const prev = byName.get(plotName);
        const sortOrder = Number(row.sort_order);
        byName.set(plotName, {
            nursery: nursery,
            plot_name: plotName,
            active: row.active !== false && row.active !== 'false',
            sort_order: Number.isFinite(sortOrder) ? sortOrder : (prev ? prev.sort_order : 9999)
        });
    });

    const records = Array.from(byName.values()).sort((a, b) => {
        if (a.nursery !== b.nursery) {
            return WATERING_NURSERIES.indexOf(a.nursery) - WATERING_NURSERIES.indexOf(b.nursery);
        }
        return a.sort_order - b.sort_order || comparePlotNames(a.plot_name, b.plot_name);
    });

    const nextAll = { BNN: [], UNN1: [], UNN2: [] };
    const nextActive = { BNN: [], UNN1: [], UNN2: [] };
    records.forEach((row) => {
        nextAll[row.nursery].push(row.plot_name);
        if (row.active) nextActive[row.nursery].push(row.plot_name);
    });

    WATERING_NURSERIES.forEach((nursery) => {
        plotData[nursery] = nextActive[nursery];
        allPlotData[nursery] = nextAll[nursery];
    });
    plotRecordList = records;
    return records.map((row) => Object.assign({}, row));
}

function readPlotCache() {
    try {
        const parsed = JSON.parse(localStorage.getItem(PLOT_CACHE_KEY) || 'null');
        if (!parsed || parsed.v !== 1 || !Array.isArray(parsed.plots)) return null;
        return parsed.plots;
    } catch (e) {
        return null;
    }
}

function writePlotCache(records) {
    try {
        localStorage.setItem(PLOT_CACHE_KEY, JSON.stringify({
            v: 1,
            plots: records.map((row) => ({
                nursery: row.nursery,
                plot_name: row.plot_name,
                active: row.active,
                sort_order: row.sort_order
            }))
        }));
    } catch (e) { /* private mode or full storage — this session still has the list */ }
}

function plotProblemFromError(error) {
    const text = ((error && (error.code || '')) + ' ' + ((error && (error.message || error.details)) || '')).toLowerCase();
    if (text.indexOf('pgrst205') !== -1 || text.indexOf('42p01') !== -1 ||
        text.indexOf('does not exist') !== -1 || text.indexOf('schema cache') !== -1) {
        return 'missing';
    }
    return 'error';
}

// Apply the phone cache immediately so dropdowns work before the network returns.
(function applyCachedPlots() {
    const cached = readPlotCache();
    if (!cached) return;
    applyWateringPlotRows(cached);
    wateringPlotsStatus = { tableReady: false, source: 'cache', problem: null };
})();

function getWateringPlotRecords() {
    return plotRecordList.map((row) => Object.assign({}, row));
}

function getWateringPlotsStatus() {
    return {
        tableReady: wateringPlotsStatus.tableReady,
        source: wateringPlotsStatus.source,
        problem: wateringPlotsStatus.problem
    };
}

function isPlotActive(plotName) {
    const name = String(plotName || '');
    return WATERING_NURSERIES.some((nursery) => (plotData[nursery] || []).indexOf(name) !== -1);
}

// Pages register to rebuild dropdowns after a fetch. Not tied to login.
function onWateringPlotsUpdated(fn) {
    if (typeof fn === 'function') plotUpdateListeners.push(fn);
}

function notifyWateringPlotsUpdated() {
    plotUpdateListeners.forEach((fn) => {
        try { fn(); } catch (e) { console.warn('plot listener', e); }
    });
}

// Refetch when the page is shown again: reopen from the home screen,
// switch back to the app, or restore from the back-forward cache.
// A burst of visibility + focus + pageshow is one request.
function ensureForegroundPlotRefresh() {
    if (foregroundWatchStarted || typeof document === 'undefined' || typeof window === 'undefined') return;
    foregroundWatchStarted = true;
    const kick = () => {
        if (document.visibilityState === 'hidden') return;
        clearTimeout(foregroundRefreshTimer);
        foregroundRefreshTimer = setTimeout(() => {
            loadWateringPlots(foregroundClient);
        }, 50);
    };
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') kick();
    });
    window.addEventListener('focus', kick);
    window.addEventListener('pageshow', kick);
}

// Reads watering_plots whenever a page asks, including page load and when
// the app returns to the foreground. The local cache is only the fallback
// when the phone is offline or the request fails. This does not check who
// is logged in — the existing session is enough.
async function loadWateringPlots(client) {
    if (client) foregroundClient = client;
    ensureForegroundPlotRefresh();
    if (plotsLoadInflight) {
        const status = await plotsLoadInflight;
        return status;
    }
    plotsLoadInflight = loadWateringPlotsNow(foregroundClient).finally(() => {
        plotsLoadInflight = null;
    });
    try {
        return await plotsLoadInflight;
    } finally {
        notifyWateringPlotsUpdated();
    }
}

async function loadWateringPlotsNow(client) {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        wateringPlotsStatus = {
            tableReady: false,
            source: readPlotCache() ? 'cache' : 'builtin',
            problem: 'offline'
        };
        return getWateringPlotsStatus();
    }

    const supa = client || (typeof _supabase !== 'undefined' ? _supabase : null);
    if (!supa) {
        wateringPlotsStatus = {
            tableReady: false,
            source: wateringPlotsStatus.source || 'builtin',
            problem: 'error'
        };
        return getWateringPlotsStatus();
    }

    try {
        const { data, error } = await supa
            .from('watering_plots')
            .select('nursery, plot_name, active, sort_order')
            .order('sort_order', { ascending: true });
        if (error) {
            if (!plotsReadWarned) {
                plotsReadWarned = true;
                console.warn('watering_plots unavailable, using built-in list:', error.message || error);
            }
            wateringPlotsStatus = {
                tableReady: false,
                source: readPlotCache() ? 'cache' : 'builtin',
                problem: plotProblemFromError(error)
            };
            return getWateringPlotsStatus();
        }
        const records = applyWateringPlotRows(data || []);
        writePlotCache(records);
        plotsReadWarned = false;
        wateringPlotsStatus = { tableReady: true, source: 'remote', problem: null };
        return getWateringPlotsStatus();
    } catch (e) {
        console.warn('watering_plots read failed:', e);
        wateringPlotsStatus = {
            tableReady: false,
            source: readPlotCache() ? 'cache' : 'builtin',
            problem: 'error'
        };
        return getWateringPlotsStatus();
    }
}
