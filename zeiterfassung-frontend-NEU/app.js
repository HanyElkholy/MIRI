document.addEventListener('DOMContentLoaded', () => {

    // --- GLOBALE VARIABLEN ---
    let currentUser = null;
    let usersList = [];
    let bookingsList = [];
    let requestsList = [];
    let currentCalDate = new Date();
    let selectedCalUserId = null;

    const API_URL = 'http://localhost:3001/api/v1'; 

    // --- DOM ELEMENTE ---
    const loginPage = document.getElementById('login-page');
    const trackerPage = document.getElementById('tracker-page');
    const loginForm = document.getElementById('login-form');
    const userRoleDisplay = document.getElementById('user-role-display');
    
    // --- API FUNKTIONEN ---
    async function apiFetch(endpoint, method = 'GET', body = null) {
        const headers = { 'Content-Type': 'application/json' };
        if (currentUser && currentUser.token) headers['Authorization'] = `Bearer ${currentUser.token}`;
        const config = { method, headers };
        if (body) config.body = JSON.stringify(body);
        try {
            const res = await fetch(`${API_URL}${endpoint}`, config);
            if (!res.ok) { if(res.status===401) logout(); return null; }
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
                usersList = await apiFetch('/users');
            } else {
                userRoleDisplay.classList.add('hidden');
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
        ['content-overview','content-corrections','content-monthly'].forEach(id => document.getElementById(id).classList.add('hidden'));
        ['nav-overview-button','nav-corrections-button','nav-monthly-button'].forEach(id => {
            document.getElementById(id).classList.remove('active-nav');
            document.getElementById(id).classList.add('inactive-nav');
        });
        document.getElementById(`content-${name}`).classList.remove('hidden');
        const btn = document.getElementById(`nav-${name}-button`);
        btn.classList.remove('inactive-nav');
        btn.classList.add('active-nav');
        refreshData(name);
    }

    async function refreshData(name) {
        bookingsList = await apiFetch('/bookings') || [];
        requestsList = await apiFetch('/requests') || [];
        if (name === 'overview') loadOverview();
        if (name === 'corrections') loadCorrections();
        if (name === 'monthly') loadMonthly();
    }

    ['overview','corrections','monthly'].forEach(n => document.getElementById(`nav-${n}-button`).addEventListener('click', () => switchSection(n)));

    // --- LOGIK & BERECHNUNGEN (ArbZG) ---
    function timeToDec(timeStr) {
        if (!timeStr) return 0;
        const [h, m] = timeStr.split(':').map(Number);
        return h + (m / 60);
    }

    function decToTime(dec) {
        const h = Math.floor(dec);
        const m = Math.round((dec - h) * 60);
        return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`;
    }

    // Automatische Pausenregel (ArbZG)
    function calcPause(brutto) {
        // Bei > 9 Std Arbeit: 45 Min Pause
        if (brutto > 9.0) return 0.75; 
        // Bei > 6 Std Arbeit: 30 Min Pause
        if (brutto > 6.0) return 0.50; 
        return 0.0;
    }

    function getUserTarget(userId) {
        const u = usersList.find(u => u.id === userId);
        return u ? (u.dailyTarget || 8.0) : 8.0;
    }
    
    function getUserName(id) {
        const u = usersList.find(u => u.id === id);
        return u ? u.displayName : `ID ${id}`;
    }

    // --- EXPORT FUNKTION (CSV) ---
    window.exportToCSV = function() {
        let csvContent = "data:text/csv;charset=utf-8,";
        csvContent += "ID;Mitarbeiter;Datum;Beginn;Ende;Pause;Soll;Ist;Erfasst;Saldo;Bemerkung\n";

        const year = currentCalDate.getFullYear();
        const month = currentCalDate.getMonth() + 1;
        const prefix = `${year}-${String(month).padStart(2,'0')}`;

        let data = bookingsList.filter(b => b.date.startsWith(prefix));
        if (selectedCalUserId) data = data.filter(b => b.userId === selectedCalUserId);

        data.forEach(b => {
            const target = getUserTarget(b.userId);
            const brutto = timeToDec(b.end) - timeToDec(b.start);
            const pause = b.end ? calcPause(brutto) : 0;
            const erfasst = Math.max(0, brutto - pause);
            const saldo = b.end ? (erfasst - target) : 0;
            
            const row = [
                b.userId, getUserName(b.userId), b.date, b.start, b.end || '',
                decToTime(pause), decToTime(target), decToTime(brutto), decToTime(erfasst),
                decToTime(saldo), b.remarks || ''
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

    // --- TAGESÜBERSICHT & LIVE MONITOR ---
    function loadOverview() {
        const header = document.getElementById('overview-header');
        const container = document.getElementById('overview-list-container');
        const liveMonitor = document.getElementById('admin-live-monitor');
        const isAdmin = currentUser.role === 'admin';

        // 1. Live Monitor (Nur für Admin)
        if (isAdmin) {
            liveMonitor.classList.remove('hidden');
            const liveContainer = document.getElementById('live-users-grid');
            liveContainer.innerHTML = '';
            const today = new Date().toISOString().split('T')[0];
            
            // Finde aktive Buchungen (Ende fehlt)
            const activeBookings = bookingsList.filter(b => b.date === today && b.start && !b.end);

            if (activeBookings.length === 0) {
                liveContainer.innerHTML = '<div class="text-gray-500 text-sm italic col-span-full p-2">Aktuell ist niemand eingestempelt.</div>';
            } else {
                activeBookings.forEach(b => {
                    const div = document.createElement('div');
                    div.className = "bg-green-900/30 border border-green-600/50 p-3 rounded flex items-center gap-3 shadow-lg transform transition hover:scale-105";
                    div.innerHTML = `
                        <div class="relative">
                            <div class="w-3 h-3 rounded-full bg-green-500 animate-pulse"></div>
                            <div class="w-3 h-3 rounded-full bg-green-500 absolute top-0 left-0 animate-ping opacity-75"></div>
                        </div>
                        <div>
                            <div class="text-white font-bold text-sm truncate w-32" title="${getUserName(b.userId)}">${getUserName(b.userId)}</div>
                            <div class="text-xs text-green-300 font-mono">Seit ${b.start} Uhr</div>
                        </div>`;
                    liveContainer.appendChild(div);
                });
            }
        } else {
            if(liveMonitor) liveMonitor.classList.add('hidden');
        }

        // 2. Filterlogik
        const filterSelect = document.getElementById('filter-user-overview');
        const filterDate = document.getElementById('filter-date').value;
        if (isAdmin && filterSelect.options.length <= 0) {
            filterSelect.innerHTML = '<option value="">Alle Mitarbeiter</option>';
            usersList.forEach(u => filterSelect.add(new Option(u.displayName, u.id)));
            filterSelect.onchange = loadOverview;
        }
        document.getElementById('admin-filters').className = isAdmin ? '' : 'hidden';

        let data = bookingsList;
        if (isAdmin && filterSelect.value) data = data.filter(b => b.userId == filterSelect.value);
        if (filterDate) data = data.filter(b => b.date === filterDate);
        data.sort((a, b) => new Date(b.date) - new Date(a.date));

        // 3. Grid Layout (Angepasst auf neue Spalten)
        // Spalten: Datum | Beginn | Ende | Pause | Soll | Ist(Brutto) | Erfasst(Netto) | Saldo | Info
        const gridCols = isAdmin 
            ? 'grid-cols-[50px_1.5fr_1fr_0.8fr_0.8fr_0.6fr_0.6fr_0.8fr_0.8fr_0.8fr_1fr_50px]' 
            : 'grid-cols-[1.2fr_1fr_1fr_0.8fr_0.8fr_0.8fr_0.8fr_0.8fr_2fr]';

        container.innerHTML = '';
        let headHTML = '';
        if(isAdmin) headHTML += `<div>ID</div><div>Mitarbeiter</div>`;
        headHTML += `
            <div>Datum</div>
            <div class="text-center">Beginn</div>
            <div class="text-center">Ende</div>
            <div class="text-center text-gray-500">Pause</div>
            <div class="text-center text-gray-500">Soll</div>
            <div class="text-center text-gray-500">Ist</div>
            <div class="text-center text-ahmtimus-blue font-bold">Erfasst</div>
            <div class="text-center">Saldo</div>
            <div>Info</div>
        `;
        if(isAdmin) headHTML += `<div class="text-right">Aktion</div>`;

        header.className = `grid ${gridCols} gap-2 bg-gray-800 px-4 py-3 text-xs font-bold text-gray-400 uppercase tracking-wider items-center border-b border-gray-700`;
        header.innerHTML = headHTML;

        if(data.length === 0) { container.innerHTML = `<div class="p-8 text-center text-gray-500 italic">Keine Buchungen vorhanden.</div>`; return; }

        data.forEach(b => {
            // Berechnungen
            const target = getUserTarget(b.userId);
            const brutto = timeToDec(b.end) - timeToDec(b.start);
            let pause = 0;
            if (b.end) pause = calcPause(brutto); // Auto-Pause
            
            const erfasst = Math.max(0, brutto - pause);
            
            let saldoText = '-';
            let saldoClass = 'text-gray-500';
            
            if (b.end) {
                const saldo = erfasst - target;
                saldoText = (saldo > 0 ? '+' : '') + decToTime(saldo);
                saldoClass = saldo >= 0 ? 'text-green-400' : 'text-red-400';
            }

            // DSGVO Audit Indikator
            const isEdited = b.history && b.history.length > 0;
            let statusIcon = '';
            if (isEdited) {
                const last = b.history[b.history.length-1];
                const dateDE = new Date(last.changedAt).toLocaleDateString('de-DE');
                const tooltip = `Bearbeitet von: ${last.changedBy} am ${dateDE}\nGrund: ${last.type || 'Korrektur'}\nUrsprünglich: ${last.oldStart||'?'} - ${last.oldEnd||'?'}`;
                statusIcon = `<i class="fas fa-info-circle text-orange-400 cursor-help ml-1" title="${tooltip}"></i>`;
            }

            const row = document.createElement('div');
            row.className = `grid ${gridCols} gap-2 px-4 py-3 items-center hover:bg-gray-800/50 border-b border-gray-800 transition text-sm`;

            let html = '';
            if(isAdmin) html += `<div class="text-gray-600 font-mono text-xs">#${b.userId}</div><div class="font-bold text-white truncate">${getUserName(b.userId)}</div>`;
            
            html += `
                <div class="text-gray-300">${b.date.split('-').reverse().join('.')}</div>
                <div class="text-center font-mono text-white bg-gray-700/40 rounded px-1">${b.start}</div>
                <div class="text-center font-mono text-white bg-gray-700/40 rounded px-1">${b.end || '--:--'}</div>
                <div class="text-center text-gray-500 text-xs">-${decToTime(pause)}</div>
                <div class="text-center text-gray-500 text-xs">${decToTime(target)}</div>
                <div class="text-center text-gray-400 text-xs">${b.end ? decToTime(brutto) : '-'}</div>
                <div class="text-center font-bold ${b.end ? 'text-white' : 'text-yellow-500 animate-pulse'}">${b.end ? decToTime(erfasst) : 'Läuft'}</div>
                <div class="text-center font-mono font-bold ${saldoClass}">${saldoText}</div>
                <div class="flex items-center gap-2 truncate text-xs text-gray-500">${b.remarks || ''} ${statusIcon}</div>
            `;
            if(isAdmin) html += `<div class="text-right"><button onclick="window.openEdit(${b.id})" class="text-ahmtimus-blue hover:text-blue-400" title="Bearbeiten"><i class="fas fa-pen"></i></button></div>`;
            row.innerHTML = html;
            container.appendChild(row);
        });
    }
    document.getElementById('apply-filter-btn').addEventListener('click', loadOverview);

    // --- KALENDER & KORREKTUREN (Logik übernommen) ---
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
                usersList.forEach(u => userSelect.add(new Option(u.displayName, u.id)));
                userSelect.value = selectedCalUserId || currentUser.id;
                userSelect.onchange = () => { selectedCalUserId = parseInt(userSelect.value); loadMonthly(); };
            }
            if (!selectedCalUserId) selectedCalUserId = parseInt(userSelect.value);
        } else {
            userSelectContainer.classList.add('hidden'); userDisplay.classList.remove('hidden');
            userDisplay.textContent = currentUser.displayName; selectedCalUserId = currentUser.id;
        }

        const year = currentCalDate.getFullYear();
        const month = currentCalDate.getMonth();
        monthLabel.textContent = `${new Date(year, month).toLocaleString('de-DE', { month: 'long' })} ${year}`;

        const daysInMonth = new Date(year, month + 1, 0).getDate();
        let firstDayIndex = new Date(year, month, 1).getDay(); firstDayIndex = firstDayIndex === 0 ? 6 : firstDayIndex - 1; 

        for (let i = 0; i < firstDayIndex; i++) grid.appendChild(Object.assign(document.createElement('div'), {className: 'calendar-day calendar-day-empty'}));

        let sumTarget = 0; let sumActual = 0;
        const currentTarget = getUserTarget(selectedCalUserId); 

        for (let day = 1; day <= daysInMonth; day++) {
            const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
            const cell = document.createElement('div'); cell.className = 'calendar-day relative';
            if ((new Date(year, month, day).getDay() % 6 === 0)) cell.classList.add('calendar-day-weekend');

            cell.innerHTML = `<div class="calendar-date-number text-right">${day}</div>`;
            const booking = bookingsList.find(b => b.date === dateStr && b.userId === selectedCalUserId);

            if (booking) {
                const gross = timeToDec(booking.end) - timeToDec(booking.start);
                const pause = booking.end ? calcPause(gross) : 0;
                const net = Math.max(0, gross - pause);
                if (!(new Date(year, month, day).getDay() % 6 === 0)) sumTarget += currentTarget;
                sumActual += net;
                let statusClass = (!booking.end || (net < currentTarget && !(new Date(year, month, day).getDay() % 6 === 0))) ? 'error' : 'valid';
                cell.innerHTML += `<div class="cal-entry ${statusClass}"><div>${booking.start} - ${booking.end || '...'}</div></div><div class="text-right text-xs mt-auto font-mono ${statusClass === 'error' ? 'text-red-400' : 'text-green-400'}">${booking.end ? decToTime(net)+'h' : '??'}</div>`;
                if(currentUser.role === 'admin') { cell.classList.add('cursor-pointer', 'hover:border-blue-500'); cell.onclick = () => window.openEdit(booking.id); }
            } else {
                const todayStr = new Date().toISOString().split('T')[0];
                if (!(new Date(year, month, day).getDay() % 6 === 0) && dateStr < todayStr) {
                    sumTarget += currentTarget;
                    cell.innerHTML += `<div class="mt-auto text-center text-red-900 text-[10px] uppercase font-bold tracking-wider">Fehlt</div>`;
                }
            }
            grid.appendChild(cell);
        }
        document.getElementById('cal-stat-target').textContent = decToTime(sumTarget);
        document.getElementById('cal-stat-actual').textContent = decToTime(sumActual);
        const bal = sumActual - sumTarget;
        const balEl = document.getElementById('cal-stat-balance');
        balEl.textContent = (bal > 0 ? '+' : '') + decToTime(bal);
        balEl.className = `text-2xl font-bold ${bal >= 0 ? 'text-green-400' : 'text-red-400'}`;
    }

    document.getElementById('prev-month-btn').addEventListener('click', () => { currentCalDate.setMonth(currentCalDate.getMonth() - 1); loadMonthly(); });
    document.getElementById('next-month-btn').addEventListener('click', () => { currentCalDate.setMonth(currentCalDate.getMonth() + 1); loadMonthly(); });
    if(document.getElementById('export-csv-btn')) document.getElementById('export-csv-btn').addEventListener('click', window.exportToCSV);

    function loadCorrections() {
        const listContainer = document.getElementById('correction-list-container'); listContainer.innerHTML = '';
        let requests = requestsList.sort((a, b) => (a.status === 'pending' ? -1 : 1));
        if(requests.length === 0) { listContainer.innerHTML = '<p class="text-gray-500 italic p-4">Keine offenen Anträge.</p>'; return; }
        requests.forEach(req => {
            const item = document.createElement('div'); item.className = "bg-gray-800 p-4 rounded border border-gray-700 flex justify-between items-center";
            let actionArea = '';
            if (currentUser.role === 'admin' && req.status === 'pending') {
                actionArea = `<div class="flex space-x-2"><button onclick="window.handleRequest(${req.id}, 'approved')" class="bg-green-600 hover:bg-green-500 text-white w-8 h-8 rounded flex items-center justify-center shadow-lg"><i class="fas fa-check"></i></button><button onclick="window.handleRequest(${req.id}, 'rejected')" class="bg-red-600 hover:bg-red-500 text-white w-8 h-8 rounded flex items-center justify-center shadow-lg"><i class="fas fa-times"></i></button></div>`;
            } else {
                let color = req.status === 'pending' ? 'text-yellow-500' : (req.status === 'approved' ? 'text-green-500' : 'text-red-500');
                const st = req.status === 'pending' ? 'Ausstehend' : (req.status === 'approved' ? 'Genehmigt' : 'Abgelehnt');
                actionArea = `<span class="text-xs font-bold uppercase ${color} border border-gray-600 px-2 py-1 rounded bg-gray-900">${st}</span>`;
            }
            item.innerHTML = `<div><div class="text-white font-bold text-sm mb-1">${getUserName(req.userId)} | ${req.date.split('-').reverse().join('.')}</div><div class="text-xs text-blue-300 bg-blue-900/30 inline-block px-2 py-0.5 rounded mb-2">Neu: ${req.newStart} - ${req.newEnd}</div><div class="text-sm text-gray-400 italic">"${req.reason}"</div></div><div class="ml-4">${actionArea}</div>`;
            listContainer.appendChild(item);
        });
    }

    document.getElementById('correction-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const payload = { date: document.getElementById('corr-date').value, newStart: document.getElementById('corr-start').value, newEnd: document.getElementById('corr-end').value, reason: document.getElementById('corr-reason').value };
        const res = await apiFetch('/requests', 'POST', payload);
        if(res && res.status === 'success') { alert("Antrag gesendet."); e.target.reset(); refreshData('corrections'); }
    });

    window.openEdit = function(id) {
        const b = bookingsList.find(x => x.id === id); if(!b) return;
        document.getElementById('edit-id').value = b.id; document.getElementById('edit-user').value = getUserName(b.userId); document.getElementById('edit-start').value = b.start; document.getElementById('edit-end').value = b.end; document.getElementById('edit-remark').value = b.remarks || '';
        document.getElementById('admin-edit-modal').classList.remove('hidden');
    }
    document.getElementById('close-modal-btn').addEventListener('click', () => document.getElementById('admin-edit-modal').classList.add('hidden'));
    document.getElementById('admin-edit-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const id = document.getElementById('edit-id').value;
        const body = { start: document.getElementById('edit-start').value, end: document.getElementById('edit-end').value, remarks: document.getElementById('edit-remark').value };
        const res = await apiFetch(`/bookings/${id}`, 'PUT', body);
        if(res && res.status === 'success') { document.getElementById('admin-edit-modal').classList.add('hidden'); refreshData('overview'); }
    });
    window.handleRequest = async function(reqId, status) {
        const res = await apiFetch(`/requests/${reqId}`, 'PUT', { status });
        if(res && res.status === 'success') refreshData('corrections');
    };
});