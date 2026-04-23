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
const supabaseUrl = 'https://grhzloniogyqzwyjatze.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdyaHpsb25pb2d5cXp3eWphdHplIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYxMDAyODMsImV4cCI6MjA5MTY3NjI4M30.A6_fhzaOHVAForH7Ps7fyCCdHPsjDyEQj8GJyqLwhA0';
const _supabase = supabase.createClient(supabaseUrl, supabaseKey);

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

// --- UPDATED ONLOAD (With Migration) ---
window.onload = async function() {
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
function syncPlotOptions(locId, plotId) {
    const locValue = document.getElementById(locId).value;
    const plotDropdown = document.getElementById(plotId);
    plotDropdown.innerHTML = '<option value="">-- Pilih Plot --</option>';
    if (locValue && plotData[locValue]) {
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
    localStorage.removeItem('loggedInUser');
    window.location.href = "index.html";
}

window.addEventListener('online', syncOfflineData);
setInterval(async () => {
    if (!navigator.onLine) return;
    const count = await db.pending_queue.count();
    if (count > 0) syncOfflineData();
}, 30000);