document.addEventListener('DOMContentLoaded', () => {

    // --- GLOBALE VARIABLEN ---
    let currentUser = null;
    let usersList = [];
    let bookingsList = [];
    let requestsList = [];
    let currentCalDate = new Date();
    let selectedCalUserId = null;

    // API-URL anpassen, falls nötig
    const API_URL = 'http://localhost:3001/api/v1'; 

    // --- DOM ELEMENTE ---
    const loginPage = document.getElementById('login-page');
    const trackerPage = document.getElementById('tracker-page');
    const loginForm = document.getElementById('login-form');
    const userRoleDisplay = document.getElementById('user-role-display');

    // --- API FUNKTIONEN ---
    async function apiFetch(endpoint, method = 'GET', body = null, isFormData = false) {
        const headers = {};
        if (currentUser && currentUser.token) headers['Authorization'] = `Bearer ${currentUser.token}`;
        
        // Bei FormData darf Content-Type NICHT manuell gesetzt werden (Browser übernimmt Boundary)
        if (!isFormData) headers['Content-Type'] = 'application/json';

        const config = { method, headers };
        if (body) config.body = isFormData ? body : JSON.stringify(body);

        try {
            const res = await fetch(`${API_URL}${endpoint}`, config);
            if (!res.ok) { 
                if(res.status===401) logout(); 
                const errJson = await res.json();
                console.error("API Fehler:", errJson);
                // Optional: alert(`Fehler: ${errJson.message}`);
                return null; 
            }
            return await res.json();
        } catch (err) { console.error(err); return null; }
    }

    // --- LOGIN ---
    loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const u = document.getElementById('username').value;
        const p = document.getElementById('password').value;
        const data = await apiFetch('/login', 'POST', { username: u, password: p });
        
        if (data && data.status === "success") {
            currentUser = { ...data.user, token: data.token };
            document.getElementById('user-display-name').textContent = currentUser.displayName;
            
            if (currentUser.role === 'admin') {
                userRoleDisplay.textContent = 'Administrator';
                userRoleDisplay.classList.remove('hidden');
                document.getElementById('nav-live-button').classList.remove('hidden');
                document.getElementById('nav-history-button').classList.remove('hidden');
                usersList = await apiFetch('/users');
            } else {
                userRoleDisplay.classList.add('hidden');
                document.getElementById('nav-live-button').classList.add('hidden');
                document.getElementById('nav-history-button').classList.add('hidden');
                usersList = [{ id: currentUser.id, displayName: currentUser.displayName, dailyTarget: currentUser.dailyTarget }];
            }
            loginPage.classList.add('hidden');
            trackerPage.classList.remove('hidden');
            switchSection('overview');
        } else {
            document.getElementById('error-message').classList.remove('hidden');
        }
    });

    document.getElementById('logout-button').addEventListener('click', logout);
    function logout() { currentUser = null; location.reload(); }

    // --- NAVIGATION ---
    function switchSection(name) {
        // Alle Bereiche ausblenden
        document.querySelectorAll('.content-section').forEach(el => el.classList.add('hidden'));
        // Alle Nav-Buttons zurücksetzen
        document.querySelectorAll('.nav-button').forEach(el => {
            el.classList.remove('active-nav');
            el.classList.add('inactive-nav');
        });
        
        // Gewählten Bereich anzeigen
        const contentEl = document.getElementById(`content-${name}`);
        if(contentEl) contentEl.classList.remove('hidden');
        
        // Button aktivieren
        const btn = document.getElementById(`nav-${name}-button`);
        if(btn) {
            btn.classList.remove('inactive-nav');
            btn.classList.add('active-nav');
        }
        
        refreshData(name);
    }

    async function refreshData(name) {
        bookingsList = await apiFetch('/bookings') || [];
        requestsList = await apiFetch('/requests') || [];
        
        if (name === 'overview') loadOverview();
        if (name === 'live') loadLiveMonitor();
        if (name === 'requests') loadRequests();
        if (name === 'monthly') loadMonthly();
        if (name === 'history' && currentUser.role === 'admin') loadHistory();
    }

    ['overview','live','requests','monthly','history'].forEach(n => {
        const btn = document.getElementById(`nav-${n}-button`);
        if(btn) btn.addEventListener('click', () => switchSection(n));
    });

    // --- HILFSFUNKTIONEN ---
    function getUserName(id) { const u = usersList.find(u => u.id === id); return u ? u.displayName : `ID ${id}`; }
    
    // Zeitumrechnung HH:MM -> Dezimal
    function timeToDec(t) { if(!t) return 0; const [h,m] = t.split(':').map(Number); return h + m/60; }
    
    // Zeitumrechnung Dezimal -> HH:MM
    function decToTime(d) { const h = Math.floor(d); const m = Math.round((d-h)*60); return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`; }
    
    // Automatische Pause nach ArbZG
    function calcPause(brutto) { return brutto > 9 ? 0.75 : (brutto > 6 ? 0.5 : 0); }
    
    function getUserTarget(uid) { const u = usersList.find(x=>x.id===uid); return u ? (u.dailyTarget||8.0) : 8.0; }

    // --- EXPORT FUNKTION (CSV / Excel) ---
    window.exportToCSV = function() {
        // UTF-8 BOM für korrekte Excel-Darstellung von Umlauten
        let csvContent = "data:text/csv;charset=utf-8,\uFEFF";
        csvContent += "ID;Mitarbeiter;Datum;Beginn;Ende;Pause;Soll;Ist;Netto-Zeit;Saldo;Bemerkung\n";

        const year = currentCalDate.getFullYear();
        const month = currentCalDate.getMonth() + 1;
        const prefix = `${year}-${String(month).padStart(2,'0')}`;

        // Daten filtern: Nur aktueller Monat und nur ausgewählter User
        let data = bookingsList.filter(b => b.date.startsWith(prefix));
        if (selectedCalUserId) data = data.filter(b => b.userId === selectedCalUserId);

        data.forEach(b => {
            const target = getUserTarget(b.userId);
            const brutto = timeToDec(b.end) - timeToDec(b.start);
            const pause = b.end ? calcPause(brutto) : 0;
            const erfasst = Math.max(0, brutto - pause);
            const saldo = b.end ? (erfasst - target) : 0;
            
            // CSV Zeile erstellen
            const row = [
                b.userId, 
                getUserName(b.userId), 
                b.date.split('-').reverse().join('.'), // Datum deutsch formatieren
                b.start, 
                b.end || '',
                decToTime(pause), 
                decToTime(target), 
                decToTime(brutto), 
                decToTime(erfasst),
                decToTime(saldo), 
                b.remarks || ''
            ].join(";");
            csvContent += row + "\n";
        });

        const encodedUri = encodeURI(csvContent);
        const link = document.createElement("a");
        link.setAttribute("href", encodedUri);
        link.setAttribute("download", `Zeiterfassung_${prefix}.csv`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    }
    // Event Listener für Export Button
    const expBtn = document.getElementById('export-csv-btn');
    if(expBtn) expBtn.addEventListener('click', window.exportToCSV);


    // --- 1. ANWESENHEIT (LIVE) ---
    function loadLiveMonitor() {
        const container = document.getElementById('live-users-grid');
        container.innerHTML = '';
        const today = new Date().toISOString().split('T')[0];
        const active = bookingsList.filter(b => b.date === today && b.start && !b.end);

        if (active.length === 0) {
            container.innerHTML = '<div class="col-span-full text-center text-gray-500 py-10">Kein Mitarbeiter aktuell eingestempelt.</div>';
            return;
        }

        active.forEach(b => {
            const div = document.createElement('div');
            div.className = "bg-gray-800 border-l-4 border-green-500 p-4 rounded shadow flex items-center justify-between";
            div.innerHTML = `
                <div>
                    <div class="font-bold text-white text-lg">${getUserName(b.userId)}</div>
                    <div class="text-green-400 font-mono text-sm mt-1"><i class="fas fa-clock mr-1"></i> ${b.start} Uhr</div>
                </div>
                <div class="h-3 w-3 bg-green-500 rounded-full animate-pulse shadow-[0_0_10px_#22c55e]"></div>
            `;
            container.appendChild(div);
        });
    }

    // --- 2. TAGESÜBERSICHT (JOURNAL) ---
    function loadOverview() {
        const isAdmin = currentUser.role === 'admin';
        const filterUser = document.getElementById('filter-user-overview');
        const filterDate = document.getElementById('filter-date');
        
        // Filter initialisieren (OHNE ADMIN in der Liste)
        if (isAdmin && filterUser.options.length === 0) {
            filterUser.innerHTML = '<option value="">Alle Mitarbeiter</option>';
            usersList.filter(u => u.role !== 'admin').forEach(u => filterUser.add(new Option(u.displayName, u.id)));
            filterUser.onchange = loadOverview;
            document.getElementById('admin-filters').classList.remove('hidden');
        }
        document.getElementById('apply-filter-btn').onclick = loadOverview;

        let data = bookingsList;
        // Admin-Filter Logik
        if (isAdmin && filterUser.value) data = data.filter(b => b.userId == filterUser.value);
        if (filterDate.value) data = data.filter(b => b.date === filterDate.value);
        
        // Sortierung: Neueste zuerst
        data.sort((a,b) => new Date(b.date) - new Date(a.date));

        const container = document.getElementById('overview-list-container');
        const header = document.getElementById('overview-header');
        container.innerHTML = '';

        // --- GRID LAYOUT DEFINITION ---
        // Personal-ID: 0.8fr | Name: 2fr | Datum: 1fr | Zeiten: je 0.7fr | Netto: 0.9fr | Info: 2.5fr | Aktion: 50px
        const gridClass = isAdmin 
            ? 'grid-cols-[0.8fr_2fr_1fr_0.7fr_0.7fr_0.6fr_0.6fr_0.6fr_0.9fr_2.5fr_50px]' 
            : 'grid-cols-[1fr_1fr_1fr_1fr_1fr_1fr_1fr_1fr_2fr]';
        
        let headHTML = '';
        if(isAdmin) headHTML += `<div class="text-gray-500">Personal-ID</div><div>Mitarbeiter</div>`;
        
        headHTML += `
            <div>Datum</div>
            <div class="text-center">Start</div>
            <div class="text-center">Ende</div>
            <div class="text-center text-gray-500">Pause</div>
            <div class="text-center text-gray-500">Soll</div>
            <div class="text-center text-gray-500">Ist</div>
            <div class="text-center font-bold text-blue-300">Netto-Zeit</div>
            ${isAdmin ? '' : '<div class="text-center">Saldo</div>'} 
            <div>Bemerkung</div>
        `;
        
        if(isAdmin) headHTML += `<div></div>`;

        header.className = `grid ${gridClass} gap-3 px-4 py-3 bg-gray-800 text-xs font-bold text-gray-400 uppercase border-b border-gray-700 items-center`;
        header.innerHTML = headHTML;

        if(data.length === 0) { container.innerHTML = '<div class="p-6 text-center text-gray-500 italic">Keine Einträge gefunden.</div>'; return; }

        data.forEach(b => {
            const target = getUserTarget(b.userId);
            const rawDiff = timeToDec(b.end) - timeToDec(b.start);
            const pause = b.end ? calcPause(rawDiff) : 0;
            const net = Math.max(0, rawDiff - pause);
            const saldo = b.end ? (net - target) : 0;
            
            // Audit/Historien-Icon
            let infoIcon = '';
            if(b.history && b.history.length > 0) {
                const last = b.history[b.history.length-1];
                infoIcon = `<i class="fas fa-info-circle text-orange-400 ml-2 cursor-help" title="Zuletzt geändert: ${last.changedBy} (${last.type})"></i>`;
            }

            // Status-Badges
            let typeBadge = '';
            if (b.type === 'Urlaub') typeBadge = '<span class="text-[10px] bg-green-900 text-green-300 px-1 rounded mr-1 font-bold">URLAUB</span>';
            if (b.type === 'Krank') typeBadge = '<span class="text-[10px] bg-red-900 text-red-300 px-1 rounded mr-1 font-bold">KRANK</span>';

            const div = document.createElement('div');
            div.className = `grid ${gridClass} gap-3 px-4 py-3 items-center hover:bg-gray-800/50 text-sm border-b border-gray-800 transition`;
            
            let html = '';
            // Zeile aufbauen
            if(isAdmin) html += `<div class="font-mono text-xs text-gray-500 tracking-wider">${b.userId}</div><div class="font-bold text-white truncate">${getUserName(b.userId)}</div>`;
            
            html += `
                <div class="text-gray-300 font-mono">${b.date.split('-').reverse().join('.')}</div>
                <div class="text-center font-mono text-gray-300 bg-gray-700/30 rounded py-0.5">${b.start}</div>
                <div class="text-center font-mono text-gray-300 bg-gray-700/30 rounded py-0.5">${b.end || '--:--'}</div>
                <div class="text-center text-gray-500 text-xs font-mono">${decToTime(pause)}</div>
                <div class="text-center text-gray-500 text-xs font-mono">${decToTime(target)}</div>
                <div class="text-center text-gray-500 text-xs font-mono">${b.end ? decToTime(rawDiff) : '-'}</div>
                <div class="text-center font-bold text-blue-300 font-mono text-base">${b.end ? decToTime(net) : '...'}</div>
                ${isAdmin ? '' : `<div class="text-center font-mono font-bold ${saldo >= 0 ? 'text-green-400' : 'text-red-400'}">${b.end ? (saldo>0?'+':'')+decToTime(saldo) : '-'}</div>`}
                <div class="truncate text-gray-400 text-xs">${typeBadge}${b.remarks||''} ${infoIcon}</div>
            `;
            // Bearbeiten-Button für Admin
            if(isAdmin) html += `<div class="text-right"><button onclick="window.openEdit(${b.id})" class="text-blue-500 hover:text-blue-400 transition transform hover:scale-110" title="Eintrag bearbeiten"><i class="fas fa-pen"></i></button></div>`;
            
            div.innerHTML = html;
            container.appendChild(div);
        });
    }

    // --- 3. ANTRAGSWESEN ---
    function loadRequests() {
        const isAdmin = currentUser.role === 'admin';
        const listContainer = document.getElementById('request-list-container');
        const targetSelect = document.getElementById('request-target-user');
        
        if (isAdmin) {
            document.getElementById('admin-request-filter-area').classList.remove('hidden');
            document.getElementById('request-target-user-container').classList.remove('hidden');
            
            // Fülle "Für Mitarbeiter"-Dropdown (OHNE ADMIN)
            if(targetSelect.options.length <= 1) {
                usersList.filter(u => u.role !== 'admin').forEach(u => targetSelect.add(new Option(u.displayName, u.id)));
            }
            
            // Filter Selector füllen (OHNE ADMIN)
            const fUser = document.getElementById('req-filter-user');
            if(fUser.options.length <= 1) {
                usersList.filter(u => u.role !== 'admin').forEach(u => fUser.add(new Option(u.displayName, u.id)));
            }
            document.getElementById('req-filter-btn').onclick = loadRequests;
        }

        let data = requestsList;
        if (isAdmin) {
            const fUserId = document.getElementById('req-filter-user').value;
            const fStatus = document.getElementById('req-filter-status').value;
            if(fUserId) data = data.filter(r => r.userId == fUserId);
            if(fStatus) data = data.filter(r => r.status === fStatus);
        }
        
        // Sortierung: Ausstehende zuerst, dann ID absteigend
        data.sort((a,b) => {
            if(a.status === 'pending' && b.status !== 'pending') return -1;
            if(a.status !== 'pending' && b.status === 'pending') return 1;
            return b.id - a.id;
        });

        listContainer.innerHTML = '';
        if(data.length === 0) { listContainer.innerHTML = '<p class="text-gray-500 italic">Keine Anträge gefunden.</p>'; return; }

        data.forEach(req => {
            const item = document.createElement('div');
            item.className = "bg-gray-800 p-4 rounded border border-gray-700 flex flex-col gap-2 relative group hover:border-gray-600 transition";
            
            // Status-Badge (Übersetzung ins Deutsche)
            let statusBadge = '';
            if(req.status === 'pending') statusBadge = '<span class="bg-yellow-600/20 text-yellow-500 px-2 py-1 rounded text-xs font-bold border border-yellow-600/50">Ausstehend</span>';
            if(req.status === 'approved') statusBadge = '<span class="bg-green-600/20 text-green-500 px-2 py-1 rounded text-xs font-bold border border-green-600/50">Genehmigt</span>';
            if(req.status === 'rejected') statusBadge = '<span class="bg-red-600/20 text-red-500 px-2 py-1 rounded text-xs font-bold border border-red-600/50">Abgelehnt</span>';

            let typeColor = req.type === 'Urlaub' ? 'text-green-300' : (req.type === 'Krank' ? 'text-red-300' : 'text-blue-300');
            let attachmentHtml = req.attachment ? `<span class="text-xs text-gray-400 ml-2"><i class="fas fa-paperclip"></i> Anhang vorhanden</span>` : '';

            // Admin-Buttons
            let buttons = '';
            if(isAdmin && req.status === 'pending') {
                buttons = `
                <div class="mt-2 flex gap-2 justify-end border-t border-gray-700 pt-2">
                    <button onclick="window.handleRequest(${req.id}, 'approved')" class="bg-green-700 hover:bg-green-600 text-white px-3 py-1 rounded text-xs font-bold shadow">Genehmigen</button>
                    <button onclick="window.handleRequest(${req.id}, 'rejected')" class="bg-red-700 hover:bg-red-600 text-white px-3 py-1 rounded text-xs font-bold shadow">Ablehnen</button>
                </div>`;
            }

            item.innerHTML = `
                <div class="flex justify-between items-start">
                    <div>
                        <div class="text-sm font-bold text-white flex items-center gap-2">
                            ${getUserName(req.userId)} 
                            <span class="font-normal text-gray-500 text-xs">| ${req.date.split('-').reverse().join('.')}</span>
                        </div>
                        <div class="text-xs font-bold uppercase mt-1 ${typeColor}">${req.type} ${attachmentHtml}</div>
                    </div>
                    <div>${statusBadge}</div>
                </div>
                <div class="text-sm text-gray-300 bg-gray-900/50 p-2 rounded italic border-l-2 border-gray-600 mt-1">
                    "${req.reason}"
                    ${(req.newStart && req.newEnd) ? `<div class="not-italic text-xs text-gray-500 mt-1 font-mono">Zeitraum: ${req.newStart} - ${req.newEnd}</div>` : ''}
                </div>
                ${buttons}
            `;
            listContainer.appendChild(item);
        });
    }

    // Formular Handler für neuen Antrag
    document.getElementById('request-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const formData = new FormData(e.target);
        const res = await apiFetch('/requests', 'POST', formData, true); 
        if (res && res.status === 'success') {
            alert('Antrag erfolgreich erstellt.');
            e.target.reset();
            refreshData('requests');
        }
    });

    // Antrag bearbeiten (Genehmigen/Ablehnen)
    window.handleRequest = async (id, status) => {
        const actionText = status === 'approved' ? 'genehmigen' : 'ablehnen';
        if(!confirm(`Möchten Sie diesen Antrag wirklich ${actionText}?`)) return;
        
        const res = await apiFetch(`/requests/${id}`, 'PUT', { status });
        if(res && res.status === 'success') refreshData('requests');
    };

    // --- 4. KALENDER (Monatsjournal) ---
    function loadMonthly() {
        const grid = document.getElementById('calendar-grid');
        const monthLabel = document.getElementById('calendar-month-label');
        const userSelectContainer = document.getElementById('calendar-user-select-container');
        const userSelect = document.getElementById('calendar-user-select');
        const userDisplay = document.getElementById('calendar-user-display');
        
        grid.innerHTML = '';
        
        if (currentUser.role === 'admin') {
            userSelectContainer.classList.remove('hidden'); userDisplay.classList.add('hidden');
            if (userSelect.options.length === 0) {
                // Nur Mitarbeiter laden (ohne Admin)
                usersList.filter(u => u.role !== 'admin').forEach(u => userSelect.add(new Option(u.displayName, u.id)));
                
                // Falls noch keiner gewählt, nimm den ersten
                if(!selectedCalUserId && usersList.length > 0) {
                    const firstUser = usersList.find(u => u.role !== 'admin');
                    if(firstUser) {
                        selectedCalUserId = firstUser.id;
                        userSelect.value = firstUser.id;
                    }
                }
                userSelect.onchange = () => { selectedCalUserId = parseInt(userSelect.value); loadMonthly(); };
            }
        } else {
            userSelectContainer.classList.add('hidden'); userDisplay.classList.remove('hidden');
            userDisplay.textContent = currentUser.displayName; selectedCalUserId = currentUser.id;
        }

        const year = currentCalDate.getFullYear();
        const month = currentCalDate.getMonth();
        monthLabel.textContent = `${new Date(year, month).toLocaleString('de-DE', { month: 'long' })} ${year}`;

        const daysInMonth = new Date(year, month + 1, 0).getDate();
        let firstDayIndex = new Date(year, month, 1).getDay(); firstDayIndex = firstDayIndex === 0 ? 6 : firstDayIndex - 1; 

        ['Mo','Di','Mi','Do','Fr','Sa','So'].forEach((d,i) => {
             const h = document.createElement('div'); h.className = `text-center text-xs font-bold uppercase ${i>4?'text-ahmtimus-blue':'text-gray-500'} mb-2`; h.innerText = d;
             grid.appendChild(h);
        });

        // Leere Tage am Anfang
        for (let i = 0; i < firstDayIndex; i++) grid.appendChild(Object.assign(document.createElement('div'), {className: 'min-h-[100px]'}));

        let sumTarget = 0, sumActual = 0;
        const target = getUserTarget(selectedCalUserId);

        for (let day = 1; day <= daysInMonth; day++) {
            const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
            const cell = document.createElement('div');
            const isWeekend = (new Date(year, month, day).getDay() % 6 === 0);
            
            cell.className = `min-h-[100px] border border-gray-800 p-2 relative flex flex-col ${isWeekend ? 'bg-[#0d121d]' : 'bg-[#111827] hover:bg-gray-800 transition'}`;
            cell.innerHTML = `<div class="text-right text-sm font-bold ${isWeekend ? 'text-blue-500' : 'text-gray-600'}">${day}</div>`;

            const b = bookingsList.find(x => x.date === dateStr && x.userId === selectedCalUserId);
            
            if (b) {
                const diff = timeToDec(b.end) - timeToDec(b.start);
                const pause = b.end ? calcPause(diff) : 0;
                const net = Math.max(0, diff - pause);
                
                if (!isWeekend) sumTarget += target;
                sumActual += net;

                let colorClass = 'text-green-400 border-green-500/30 bg-green-500/10';
                if(b.type === 'Krank') colorClass = 'text-red-400 border-red-500/30 bg-red-500/10';
                if(b.type === 'Urlaub') colorClass = 'text-blue-400 border-blue-500/30 bg-blue-500/10';
                if(!b.end) colorClass = 'text-yellow-500 border-yellow-500/30 animate-pulse';

                // Deutsche Labels im Kalender
                let label = b.end ? decToTime(net)+'h' : 'Läuft';
                if(b.type === 'Krank') label = 'Krank';
                if(b.type === 'Urlaub') label = 'Urlaub';

                cell.innerHTML += `
                    <div class="mt-auto text-xs border rounded px-1 py-0.5 text-center mb-1 ${colorClass}">
                        ${label}
                    </div>
                `;
                if(currentUser.role === 'admin') { cell.classList.add('cursor-pointer'); cell.onclick = () => window.openEdit(b.id); }
            } else {
                 const todayStr = new Date().toISOString().split('T')[0];
                 if(!isWeekend && dateStr < todayStr) {
                     sumTarget += target;
                     cell.innerHTML += `<div class="mt-auto text-center text-[10px] text-red-900 font-bold uppercase tracking-widest">Fehlt</div>`;
                 }
            }
            grid.appendChild(cell);
        }
        
        document.getElementById('cal-stat-target').textContent = decToTime(sumTarget);
        document.getElementById('cal-stat-actual').textContent = decToTime(sumActual);
        const bal = sumActual - sumTarget;
        document.getElementById('cal-stat-balance').textContent = (bal>0?'+':'') + decToTime(bal);
        document.getElementById('cal-stat-balance').className = `text-2xl font-bold ${bal>=0?'text-green-400':'text-red-400'}`;
    }

    document.getElementById('prev-month-btn').addEventListener('click', () => { currentCalDate.setMonth(currentCalDate.getMonth()-1); loadMonthly(); });
    document.getElementById('next-month-btn').addEventListener('click', () => { currentCalDate.setMonth(currentCalDate.getMonth()+1); loadMonthly(); });

    // --- 5. SYSTEMPROTOKOLL (Audit Log) ---
    async function loadHistory() {
        const log = await apiFetch('/history');
        const tbody = document.getElementById('audit-log-body');
        tbody.innerHTML = '';
        if (!log || log.length === 0) {
            tbody.innerHTML = '<tr><td colspan="4" class="px-6 py-4 text-center italic">Keine Protokolleinträge vorhanden.</td></tr>';
            return;
        }
        log.forEach(entry => {
            const tr = document.createElement('tr');
            tr.className = "hover:bg-gray-800 transition border-b border-gray-800";
            tr.innerHTML = `
                <td class="px-6 py-3 font-mono text-gray-500 text-xs">${new Date(entry.timestamp).toLocaleString('de-DE')}</td>
                <td class="px-6 py-3 font-bold text-gray-300">${entry.actor}</td>
                <td class="px-6 py-3"><span class="bg-gray-700 text-gray-300 px-2 py-1 rounded text-xs uppercase font-bold">${entry.action}</span></td>
                <td class="px-6 py-3 text-gray-400 italic text-xs">${entry.details}</td>
            `;
            tbody.appendChild(tr);
        });
    }

    // --- EDIT MODAL (Nur Admin) ---
    window.openEdit = function(id) {
        const b = bookingsList.find(x => x.id === id); if(!b) return;
        document.getElementById('edit-id').value = b.id;
        document.getElementById('edit-user').value = getUserName(b.userId);
        document.getElementById('edit-start').value = b.start;
        document.getElementById('edit-end').value = b.end;
        document.getElementById('edit-remark').value = b.remarks || '';
        document.getElementById('admin-edit-modal').classList.remove('hidden');
    }
    document.getElementById('close-modal-btn').onclick = () => document.getElementById('admin-edit-modal').classList.add('hidden');
    
    document.getElementById('admin-edit-form').onsubmit = async (e) => {
        e.preventDefault();
        const id = document.getElementById('edit-id').value;
        const body = { 
            start: document.getElementById('edit-start').value, 
            end: document.getElementById('edit-end').value, 
            remarks: document.getElementById('edit-remark').value 
        };
        const res = await apiFetch(`/bookings/${id}`, 'PUT', body);
        if(res && res.status === 'success') {
            document.getElementById('admin-edit-modal').classList.add('hidden');
            if(currentUser.role==='admin') refreshData('overview');
        }
    };
});