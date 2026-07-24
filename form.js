// --- 1. INITIALIZE DEXIE ---
const db = new Dexie("SiramGoDB");
db.version(1).stores({
    pending_queue: '++id, plot_name, timestamp' // Local warehouse for offline logs
});

let isSyncing = false;

// 1. SECURITY CHECK
const currentUser = localStorage.getItem('loggedInUser');
if (!currentUser) {
    window.location.href = "index.html";
}

// 2. CONFIGURATION
const supabaseUrl = 'https://kibqjztozokohqmhqqqf.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtpYnFqenRvem9rb2hxbWhxcXFmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQyMzQzNjIsImV4cCI6MjA4OTgxMDM2Mn0.J7qJUZhWXYf5b9oey4wXJkjdi66jomEMw_NeV9NWF7M';
const _supabase = supabase.createClient(supabaseUrl, supabaseKey);

// 2a. SESSION VALIDITY CHECK — force re-login ONLY when online AND the session
// is confirmed missing (no error). If getSession() returns an error (network
// hiccup, Supabase 5xx, refresh token race, captive portal), we keep the user
// logged in — a real invalid session returns { session: null, error: null }.
// Skipped when offline because getSession() tries to refresh expired tokens over
// the network, which fails offline → would falsely kick workers out.
// Pending records in Dexie and active timers in localStorage['activeWateringSessions']
// are preserved regardless.
(async () => {
    if (!currentUser) return;
    if (!navigator.onLine) return;
    try {
        const { data: { session } = {}, error } = await _supabase.auth.getSession();
        // Only log out on a genuinely-missing session. Any error means the check
        // is inconclusive (network/refresh problem) — leave the user alone.
        if (!session && !error) {
            localStorage.removeItem('loggedInUser');
            alert('Sesi tamat. Sila log masuk semula.');
            window.location.href = 'index.html';
        }
    } catch (e) { /* getSession threw (rare) — don't risk worker flow */ }
})();

// 2b. FIELD COORDINATOR REDIRECT — FCs only view dashboard, never the worker form
(async () => {
    if (!currentUser) return;
    try {
        const { data } = await _supabase.from('watering_field_coordinators')
            .select('email').eq('email', currentUser).maybeSingle();
        if (data) window.location.href = 'dashboard.html';
    } catch (e) { /* table missing or error — treat as non-FC, do nothing */ }
})();

// 2c. WORKER WHITELIST GATE — block authenticated users who aren't allowed to
// use Siram Go! (e.g. users from the merged app who shouldn't see this page).
// Runs in parallel with the FC redirect above — FCs pass this check too and
// get sent to dashboard.html by that IIFE. Skipped offline so field workers
// with expired tokens or captive portals aren't falsely blocked. Network/RLS
// errors fail-open so a temporary Supabase issue can't lock the whole team out.
(async () => {
    if (!currentUser) return;
    if (!navigator.onLine) return; // offline: trust localStorage
    try {
        const [adminRes, workerRes, fcRes] = await Promise.all([
            _supabase.from('watering_admins').select('email').eq('email', currentUser).maybeSingle(),
            _supabase.from('watering_workers').select('email').eq('email', currentUser).maybeSingle(),
            _supabase.from('watering_field_coordinators').select('email').eq('email', currentUser).maybeSingle()
        ]);
        const isAllowed = !!adminRes.data || !!workerRes.data || !!fcRes.data;
        if (!isAllowed) {
            alert('Akaun anda tidak dibenarkan mengakses Siram Go!');
            try { await _supabase.auth.signOut(); } catch (e) { /* offline OK */ }
            localStorage.removeItem('loggedInUser');
            window.location.href = 'index.html';
        }
    } catch (e) {
        // Network / RLS error — do NOT block. Try again next page load.
        console.error('worker whitelist check:', e);
    }
})();

let activeTimers = {};
let currentPlotPending = "";
const cameraInput = document.getElementById('cameraInput');
// --- INITIALIZATION ---
function updateSyncUI(count) {
    const bar = document.getElementById('offlineSyncStatus');
    const text = document.getElementById('statusText');
    if (!bar || !text) return;
    
    if (count > 0) {
        bar.style.display = 'block';
        bar.style.backgroundColor = '#fff3cd'; // Yellow
        bar.style.color = '#856404';
        text.innerHTML = `⏳ Offline: ${count} rekod tunggu signal...`;
    } else {
        bar.style.backgroundColor = '#d4edda'; // Green
        bar.style.color = '#155724';
        text.innerHTML = `✅ Semua rekod berjaya disimpan!`;
        setTimeout(() => { bar.style.display = 'none'; }, 3000);
    }
}

function displayUserBadge() {
    const badge = document.getElementById('userBadge');
    if (badge && currentUser) badge.textContent = currentUser.split('@')[0];
}

async function checkAdminAndShowPayrollButton() {
    if (!currentUser) return;
    try {
        const { data } = await _supabase
            .from('watering_admins')
            .select('email')
            .eq('email', currentUser)
            .maybeSingle();
        if (data) {
            const btn = document.getElementById('payrollBtn');
            if (btn) btn.style.display = '';
            // Also reveal Admin Insert button (it's display:none in CSS by default)
            const insertBtn = document.getElementById('adminInsertBtn');
            if (insertBtn) insertBtn.style.display = 'inline-block';
        }
    } catch (e) {
        console.warn('Admin check failed:', e);
    }
}

// ===== Admin Insert Record modal =====
function openAdminInsertModal() {
    const m = document.getElementById('adminInsertModal');
    if (m) m.style.display = 'flex';
}
function closeAdminInsertModal() {
    const m = document.getElementById('adminInsertModal');
    if (m) m.style.display = 'none';
}

function adminSyncPlots() {
    const loc = document.getElementById('adminLokasi').value;
    const plotSel = document.getElementById('adminPlot');
    plotSel.innerHTML = '<option value="">— Pilih Plot —</option>';
    if (!loc || !plotData[loc]) return;
    // Area-wide option (issues affecting whole area)
    const allOpt = document.createElement('option');
    allOpt.value = loc;
    allOpt.text = `🌍 Semua Plot ${loc}`;
    plotSel.add(allOpt);
    plotData[loc].forEach(p => {
        const opt = document.createElement('option');
        opt.value = p;
        opt.text = p;
        plotSel.add(opt);
    });
}

function adminUpdateDuration() {
    const s = document.getElementById('adminStartTime').value;
    const e = document.getElementById('adminEndTime').value;
    const display = document.getElementById('adminDurationDisplay');
    if (!s || !e) { display.style.display = 'none'; return; }
    const ms = new Date(e) - new Date(s);
    if (ms <= 0) {
        display.innerHTML = '⚠️ Tamat mesti selepas Mula';
        display.style.background = '#fff3cd';
        display.style.color = '#856404';
        display.style.display = '';
        return;
    }
    const mins = Math.round(ms / 60000);
    const status = mins >= 50 ? '✓ Berjaya (≥50 min)' : '⚠️ Separuh (<50 min)';
    display.innerHTML = `Durasi: <strong>${mins} minit — ${status}</strong>`;
    display.style.background = mins >= 50 ? '#f0f7f0' : '#fff8e1';
    display.style.color = mins >= 50 ? '#155724' : '#856404';
    display.style.display = '';
}

async function submitAdminRecord() {
    const lokasi = document.getElementById('adminLokasi').value;
    const plot = document.getElementById('adminPlot').value;
    const startTime = document.getElementById('adminStartTime').value;
    const endTime = document.getElementById('adminEndTime').value;
    const issueReason = document.getElementById('adminIssueReason').value || null;
    const startPhotoFile = document.getElementById('adminStartPhoto').files[0];
    const endPhotoFile = document.getElementById('adminEndPhoto').files[0];

    if (!lokasi) return alert('Sila pilih Lokasi.');
    if (!plot) return alert('Sila pilih Plot.');
    if (!startTime || !endTime) return alert('Sila isi Masa Mula dan Masa Tamat.');
    const startDate = new Date(startTime);
    const endDate = new Date(endTime);
    if (endDate <= startDate) return alert('Masa Tamat mesti selepas Masa Mula.');
    const durationMins = Math.round((endDate - startDate) / 60000);

    const btn = document.getElementById('adminSubmitBtn');
    const originalText = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Memuat naik...';

    try {
        const ts = Date.now();
        let startPhotoUrl = null, endPhotoUrl = null;

        if (startPhotoFile) {
            const path = `${ts}_${plot}_S.jpg`;
            const { error: upErr } = await _supabase.storage.from('watering-photos').upload(path, startPhotoFile, { upsert: true });
            if (upErr) throw new Error('Gambar mula upload gagal: ' + upErr.message);
            startPhotoUrl = _supabase.storage.from('watering-photos').getPublicUrl(path).data.publicUrl;
        }
        if (endPhotoFile) {
            const path = `${ts}_${plot}_E.jpg`;
            const { error: upErr } = await _supabase.storage.from('watering-photos').upload(path, endPhotoFile, { upsert: true });
            if (upErr) throw new Error('Gambar tamat upload gagal: ' + upErr.message);
            endPhotoUrl = _supabase.storage.from('watering-photos').getPublicUrl(path).data.publicUrl;
        }

        const { error } = await _supabase.from('watering_logs').insert({
            user_email: currentUser,
            plot_name: plot,
            start_time: startDate.toISOString(),
            end_time: endDate.toISOString(),
            duration: durationMins,
            start_photo_url: startPhotoUrl,
            end_photo_url: endPhotoUrl,
            issue_reason: issueReason
        });
        if (error) throw error;

        alert(`✓ Record disimpan untuk ${plot} (${durationMins} min).`);
        document.getElementById('adminStartTime').value = '';
        document.getElementById('adminEndTime').value = '';
        document.getElementById('adminIssueReason').value = '';
        document.getElementById('adminStartPhoto').value = '';
        document.getElementById('adminEndPhoto').value = '';
        document.getElementById('adminDurationDisplay').style.display = 'none';
        closeAdminInsertModal();
        fetchLatestRecords();
    } catch (err) {
        console.error('submitAdminRecord:', err);
        alert('Gagal: ' + (err.message || err));
    } finally {
        btn.disabled = false;
        btn.textContent = originalText;
    }
}

let userBadgePopupTimer = null;

function showUserBadgePopup(anchor) {
    if (!currentUser) return;
    closeUserBadgePopup();

    const popup = document.createElement('div');
    popup.id = 'userBadgePopup';
    popup.textContent = currentUser;
    popup.style.cssText = 'position:fixed; background:#333; color:white; padding:6px 10px; border-radius:6px; font-size:13px; white-space:nowrap; z-index:10000; box-shadow:0 2px 8px rgba(0,0,0,0.2);';

    const rect = anchor.getBoundingClientRect();
    popup.style.top = (rect.bottom + 5) + 'px';
    popup.style.left = Math.max(8, Math.min(window.innerWidth - 250, rect.right - 200)) + 'px';

    document.body.appendChild(popup);

    userBadgePopupTimer = setTimeout(closeUserBadgePopup, 2500);
    anchor.addEventListener('mouseleave', closeUserBadgePopup, { once: true });
}

function closeUserBadgePopup() {
    const popup = document.getElementById('userBadgePopup');
    if (popup) popup.remove();
    if (userBadgePopupTimer) {
        clearTimeout(userBadgePopupTimer);
        userBadgePopupTimer = null;
    }
}

// --- UPDATED ONLOAD (With Migration) ---
window.onload = async function() {
    displayUserBadge();
    checkAdminAndShowPayrollButton();

    const saved = localStorage.getItem('activeWateringSessions');
    if (saved) {
        activeTimers = JSON.parse(saved);
        renderActiveSessions();
    }

    // MIGRATION: Move old localStorage records to Dexie once
    let oldQueue = JSON.parse(localStorage.getItem('pending_sync_queue') || "[]");
    if (oldQueue.length > 0) {
        console.log("Moving old records to Dexie...");
        for (let item of oldQueue) {
            await db.pending_queue.add(item);
        }
        localStorage.removeItem('pending_sync_queue'); // Clear old storage
    }

    syncOfflineData(); 
    fetchLatestRecords();
};

// 4. NEW: Function to handle the sliding animation for History Tabs
function showHistoryTab(loc) {
    const stage = document.getElementById('historyStage');
    const btns = {
        'BNN': document.getElementById('tabBtnBNN'),
        'UNN1': document.getElementById('tabBtnUNN1'),
        'UNN2': document.getElementById('tabBtnUNN2')
    };

    // Slide Logic
    if (loc === 'BNN') stage.style.transform = 'translateX(0%)';
    if (loc === 'UNN1') stage.style.transform = 'translateX(-33.33%)';
    if (loc === 'UNN2') stage.style.transform = 'translateX(-66.66%)';

    // Button Styling
    Object.keys(btns).forEach(key => {
        if (!btns[key]) return;
        if (key === loc) {
            btns[key].style.background = '#28a745';
            btns[key].style.color = 'white';
        } else {
            btns[key].style.background = '#eee';
            btns[key].style.color = '#666';
        }
    });
}

// --- DROPDOWN LOGIC ---
function syncPlotOptions(locId, plotId, includeAll) {
    const locValue = document.getElementById(locId).value;
    const plotDropdown = document.getElementById(plotId);
    plotDropdown.innerHTML = '<option value="">-- Pilih Plot --</option>';
    if (locValue && plotData[locValue]) {
        if (includeAll) {
            // Area-wide option: plot_name = area code (e.g. "BNN")
            // Means "this issue affects every plot in the area"
            const allOpt = document.createElement('option');
            allOpt.value = locValue;
            allOpt.text = `🌍 Semua Plot ${locValue}`;
            plotDropdown.add(allOpt);
        }
        plotData[locValue].forEach(plot => {
            let option = document.createElement("option");
            option.value = plot;
            option.text = plot;
            plotDropdown.add(option);
        });
    }
}

// --- IMAGE COMPRESSION ---
// --- BALANCED IMAGE COMPRESSION ---
function compressImage(file, callback) {
    const reader = new FileReader();
    reader.onload = function(e) {
        const img = new Image();
        img.onload = function() {
            const canvas = document.createElement('canvas');
            
            // 900px is the "Goldilocks" width: Sharp but light
            const MAX_WIDTH = 900; 
            let width = img.width;
            let height = img.height;
            
            if (width > MAX_WIDTH) {
                height *= MAX_WIDTH / width;
                width = MAX_WIDTH;
            }
            
            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, width, height);
            
            // 0.3 Quality (30%)
            const dataUrl = canvas.toDataURL('image/jpeg', 0.3); 
            callback(dataUrl);
        };
        img.src = e.target.result;
    };
    reader.readAsDataURL(file);
}

// --- WATERING ACTIONS ---
function triggerStartCamera() {
    const plot = document.getElementById('plotSelect').value;
    if (!plot) return alert("Sila pilih plot!");
    if (activeTimers[plot]) return alert("Plot sedang disiram!");
    currentPlotPending = plot;
    cameraInput.click();
}

cameraInput.onchange = function() {
    if (this.files && this.files.length > 0) {
        const plot = currentPlotPending;
        compressImage(this.files[0], (compressedBase64) => {
            activeTimers[plot] = {
                startTime: new Date().toISOString(),
                startPhotoData: compressedBase64
            };
            try {
                localStorage.setItem('activeWateringSessions', JSON.stringify(activeTimers));
            } catch (e) {
                alert("Memori telefon penuh! Sila tekan STOP untuk plot yang sedang berjalan sebelum tutup app, supaya rekod tidak hilang.");
            }
            renderActiveSessions();
        });
        this.value = ''; 
    }
};

function triggerEndCamera(plot) {
    currentPlotPending = plot;
    const endCamera = document.createElement('input');
    endCamera.type = 'file';
    endCamera.accept = 'image/*';
    endCamera.capture = 'camera';
    endCamera.onchange = function() {
        if (this.files && this.files.length > 0) {
            compressImage(this.files[0], (compressedBase64) => {
                finalizeStop(plot, compressedBase64);
            });
        }
    };
    endCamera.click();
}

// --- 3. UPDATED FINALIZESTOP (Saves to Dexie) ---
async function finalizeStop(plot, compressedEndBase64) {
    const endTime = new Date();
    const session = activeTimers[plot];
    if (!session) return;

    const startDateObj = new Date(session.startTime);
    const durationMins = parseFloat(((endTime - startDateObj) / (1000 * 60)).toFixed(2));

    const pendingRecord = {
        user_email: currentUser,
        plot_name: plot,
        start_time: startDateObj.toISOString(),
        end_time: endTime.toISOString(),
        duration: durationMins,
        start_photo_data: session.startPhotoData,
        end_photo_data: compressedEndBase64,
        timestamp: Date.now(),
        issue_reason: null
    };

    // SAVE TO DEXIE (Unlimited storage)
    await db.pending_queue.add(pendingRecord);

    delete activeTimers[plot];
    localStorage.setItem('activeWateringSessions', JSON.stringify(activeTimers));
    renderActiveSessions();
    syncOfflineData(); 
}

// --- UPDATED ISSUE REPORTING FOR DEXIE ---
async function reportIssue() {
    const plot = document.getElementById('issuePlotSelect').value;
    const reason = document.getElementById('reasonDropdown').value;
    
    if (!plot || !reason) return alert("Sila pilih Plot dan Sebab!");

    const now = new Date().toISOString();
    
    // Prepare the record for the Dexie Warehouse
    const issueRecord = {
        user_email: currentUser,
        plot_name: plot,
        start_time: now,
        end_time: now,
        duration: 0,
        issue_reason: reason,
        timestamp: Date.now(),
        // These are null for issues, but the sync engine needs the keys
        start_photo_data: null,
        end_photo_data: null
    };

    // SAVE TO DEXIE instead of localStorage
    await db.pending_queue.add(issueRecord);

    alert("Isu '" + reason + "' disimpan ke memori telefon!");
    
    // Trigger sync immediately
    syncOfflineData(); 
}

async function syncOfflineData() {
    if (isSyncing) return;
    
    // Read from Dexie Warehouse
    const queue = await db.pending_queue.toArray();
    if (queue.length === 0) {
        updateSyncUI(0);
        return;
    }

    isSyncing = true;
    updateSyncUI(queue.length);

    for (const item of queue) {
        try {
            let payload = {
                user_email: item.user_email,
                plot_name: item.plot_name,
                start_time: item.start_time,
                end_time: item.end_time,
                duration: item.duration,
                issue_reason: item.issue_reason || null
            };

            // Process Photos (Existing Logic)
            if (item.start_photo_data && item.end_photo_data) {
                const ts = item.timestamp || Date.now();
                const sPath = `${ts}_${item.plot_name}_S.jpg`;
                const ePath = `${ts}_${item.plot_name}_E.jpg`;

                const sBlob = await (await fetch(item.start_photo_data)).blob();
                const eBlob = await (await fetch(item.end_photo_data)).blob();

                await _supabase.storage.from('watering-photos').upload(sPath, sBlob, { contentType: 'image/jpeg', upsert: true });
                await _supabase.storage.from('watering-photos').upload(ePath, eBlob, { contentType: 'image/jpeg', upsert: true });

                payload.start_photo_url = _supabase.storage.from('watering-photos').getPublicUrl(sPath).data.publicUrl;
                payload.end_photo_url = _supabase.storage.from('watering-photos').getPublicUrl(ePath).data.publicUrl;
            }

            // Insert to Supabase Production
            const { error: dbErr } = await _supabase.from('watering_logs').insert([payload]);

            if (!dbErr || dbErr.code === '23505') {
                // SUCCESS: Delete from Phone Warehouse
                await db.pending_queue.delete(item.id);
            } else {
                throw dbErr; 
            }

            const remaining = await db.pending_queue.count();
            updateSyncUI(remaining);
            fetchLatestRecords();

        } catch (err) {
            console.error("Sync failed for " + item.plot_name, err.message);
            break; 
        }
    }
    isSyncing = false;
}

// --- UI RENDERING ---
function renderActiveSessions() {
    const area = document.getElementById('activeSessionsArea');
    if (!area) return;
    area.innerHTML = '<h4>Plot Sedang Disiram:</h4>';
    const plots = Object.keys(activeTimers);
    if (plots.length === 0) {
        area.innerHTML += '<p style="color:gray">Tiada plot sedang disiram.</p>';
        return;
    }
    plots.forEach(plot => {
        area.innerHTML += `
            <div class="active-session" style="background:#f9f9f9; padding:10px; border-radius:8px; margin-bottom:10px; display:flex; justify-content:space-between; align-items:center; border:1px solid #ddd;">
                <div><strong>${plot}</strong></div>
                <button class="stop-btn-small" onclick="triggerEndCamera('${plot}')" style="background:#e91e63; color:white; border:none; padding:8px 12px; border-radius:5px;">📸 Selesai</button>
            </div>`;
    });
}

function showTab(tabName) {
    const stage = document.getElementById('tabStage');
    const btnWater = document.getElementById('btnWater');
    const btnIssue = document.getElementById('btnIssue');

    if (tabName === 'wateringSection') {
        // Slide to Watering
        stage.style.transform = 'translateX(0)';
        
        // Active Style
        btnWater.style.background = '#28a745';
        btnWater.style.color = 'white';
        btnWater.style.border = '1px solid #28a745';
        btnWater.style.borderBottom = 'none';
        
        // Inactive Style
        btnIssue.style.background = '#ddd';
        btnIssue.style.color = '#555';
        btnIssue.style.border = '1px solid #ddd';
        btnIssue.style.borderLeft = 'none';
        btnIssue.style.borderBottom = 'none';
    } else {
        // Slide to Issues (-50% because the stage is 200% wide)
        stage.style.transform = 'translateX(-50%)';
        
        // Active Style
        btnIssue.style.background = '#d9534f';
        btnIssue.style.color = 'white';
        btnIssue.style.border = '1px solid #d9534f';
        btnIssue.style.borderBottom = 'none';
        
        // Inactive Style
        btnWater.style.background = '#ddd';
        btnWater.style.color = '#555';
        btnWater.style.border = '1px solid #ddd';
        btnWater.style.borderBottom = 'none';
    }
}


// Updated Fetch Logic
async function fetchLatestRecords() {
    // This map ensures "BNN" tab looks for plots starting with "B"
    const locMap = { 'BNN': 'B', 'UNN1': 'U', 'UNN2': 'N' };
    let totalMinutes = 0;

    for (const [tabId, prefix] of Object.entries(locMap)) {
        const { data, error } = await _supabase
            .from('watering_logs')
            .select('*')
            .ilike('plot_name', `${prefix}%`) // This is the fix: prefix (B, U, N)
            .order('end_time', { ascending: false })
            .limit(10);

        if (error) {
            console.error(`Supabase Error for ${tabId}:`, error);
            continue;
        }

        const tbody = document.getElementById(`logBody${tabId}`);
        if (!tbody) continue;
        
        tbody.innerHTML = '';

        if (!data || data.length === 0) {
            tbody.innerHTML = '<tr><td colspan="3" style="text-align:center; padding:20px; color:#999;">Tiada rekod.</td></tr>';
            continue;
        }

        data.forEach(record => {
            const dur = parseFloat(record.duration || 0);
            totalMinutes += dur;
            
            const timeDone = record.end_time ? new Date(record.end_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '-';
            const imgStyle = "width: 40px; height: 40px; object-fit: cover; border-radius: 6px; margin-right: 4px; border: 1px solid #eee; vertical-align: middle;";

            const row = document.createElement('tr');
            row.style.borderBottom = "1px solid #f0f0f0";
            row.innerHTML = `
                <td style="padding: 12px;">
                    <div style="font-weight: bold; color: #333;">${record.plot_name}</div>
                    <div style="font-size: 11px; color: #999;">${record.user_email ? record.user_email.split('@')[0] : 'User'}</div>
                </td>
                <td style="padding: 12px; white-space: nowrap;">
                    ${record.start_photo_url ? `<img src="${record.start_photo_url}" style="${imgStyle}" onclick="window.open(this.src)">` : ''}
                    ${record.end_photo_url ? `<img src="${record.end_photo_url}" style="${imgStyle}" onclick="window.open(this.src)">` : ''}
                </td>
                <td style="padding: 12px; text-align: right;">
                    <div style="font-weight: bold; color: #28a745;">${dur.toFixed(2)}m</div>
                    <div style="font-size: 10px; color: #bbb;">${timeDone}</div>
                </td>
            `;
            tbody.appendChild(row);
        });
    }

    const totalEl = document.getElementById('grandTotal');
    if (totalEl) totalEl.innerText = totalMinutes.toFixed(2) + ' min';
}

async function logout() {
    const count = await db.pending_queue.count();
    if (count > 0) {
        if (!confirm("You have " + count + " records not uploaded. Logout anyway?")) return;
    }
    // Clear the Supabase session too — otherwise index.html's auto-restore
    // detects the still-valid session and bounces the user back in.
    try { await _supabase.auth.signOut(); } catch (e) { /* offline OK — local state is cleared regardless */ }
    localStorage.removeItem('loggedInUser');
    window.location.href = "index.html";
}

window.addEventListener('online', syncOfflineData);
setInterval(async () => {
    if (!navigator.onLine) return;
    const count = await db.pending_queue.count();
    if (count > 0) syncOfflineData();
}, 30000);