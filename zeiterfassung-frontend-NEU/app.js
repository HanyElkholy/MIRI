document.addEventListener('DOMContentLoaded', () => {

    let currentUser = null;
    let usersList = [];
    let bookingsList = [];
    let requestsList = [];
    
    // API CONFIG
    const API_URL = 'http://localhost:3001/api/v1'; 

    async function apiFetch(endpoint, method = 'GET', body = null, isFormData = false) {
        const headers = {};
        if (currentUser && currentUser.token) headers['Authorization'] = `Bearer ${currentUser.token}`;
        if (!isFormData) headers['Content-Type'] = 'application/json';
        const config = { method, headers };
        if (body) config.body = isFormData ? body : JSON.stringify(body);
        try {
            const res = await fetch(`${API_URL}${endpoint}`, config);
            if (!res.ok) { if(res.status===401) logout(); return null; }
            return await res.json();
        } catch (err) { console.error(err); return null; }
    }

    // LOGIN
    document.getElementById('login-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const u = document.getElementById('username').value;
        const p = document.getElementById('password').value;
        const data = await apiFetch('/login', 'POST', { username: u, password: p });
        
        if (data && data.status === "success") {
            currentUser = { ...data.user, token: data.token };
            document.getElementById('user-display-name').textContent = currentUser.displayName;
            document.getElementById('client-name-display').textContent = currentUser.clientName || "McKensy"; 
            
            // UI SETUP
            if (currentUser.role === 'admin') {
                document.getElementById('nav-live-button').classList.remove('hidden');
                document.getElementById('user-live-terminal').classList.add('hidden');
                document.getElementById('admin-live-dashboard').classList.remove('hidden');
                document.getElementById('nav-group-admin').classList.remove('hidden');
                usersList = await apiFetch('/users');
            } else {
                document.getElementById('nav-live-button').classList.add('hidden');
                document.getElementById('user-live-terminal').classList.remove('hidden');
                document.getElementById('admin-live-dashboard').classList.add('hidden');
                document.getElementById('nav-group-admin').classList.add('hidden');
                usersList = [{ id: currentUser.id, displayName: currentUser.displayName, dailyTarget: currentUser.dailyTarget, vacationDays: currentUser.vacationDays }];
            }
            
            initAllDropdowns();

            document.getElementById('login-page').classList.add('hidden');
            document.getElementById('tracker-page').classList.remove('hidden');
            switchSection('overview');
        } else {
            document.getElementById('error-message').classList.remove('hidden');
        }
    });

    document.getElementById('logout-button').addEventListener('click', () => location.reload());
    function logout() { currentUser = null; location.reload(); }

    // --- CENTRAL DROPDOWN INIT ---
    function initAllDropdowns() {
        const selects = [
            'overview-user-select', 
            'req-filter-user', 
            'request-target-user', 
            'cal-filter-user', 
            'account-user-select'
        ];

        selects.forEach(id => {
            const el = document.getElementById(id);
            if(!el) return;
            el.innerHTML = '<option value="" disabled selected>Bitte auswählen...</option>';
            usersList.filter(u => u.role !== 'admin').forEach(u => {
                el.add(new Option(u.displayName, u.id));
            });
        });

        document.getElementById('cal-filter-month').value = new Date().getMonth();
        document.getElementById('cal-filter-year').value = new Date().getFullYear();
    }

    // --- NAVIGATION ---
    function switchSection(name) {
        document.querySelectorAll('.content-section').forEach(el => el.classList.add('hidden'));
        document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
        document.querySelectorAll('.dropdown-link').forEach(el => el.classList.remove('bg-ahmtimus-blue', 'text-white'));

        const contentEl = document.getElementById(`content-${name}`);
        if(contentEl) contentEl.classList.remove('hidden');
        
        if(name === 'overview') document.getElementById('nav-overview-button').classList.add('active');
        if(name === 'live') document.getElementById('nav-live-button').classList.add('active');
        if(name === 'monthly') document.getElementById('nav-monthly-button').classList.add('bg-ahmtimus-blue', 'text-white');
        if(name === 'requests') document.getElementById('nav-requests-button').classList.add('bg-ahmtimus-blue', 'text-white');
        if(name === 'account') document.getElementById('nav-account-button').classList.add('bg-ahmtimus-blue', 'text-white');
        if(name === 'history') document.getElementById('nav-history-button').classList.add('text-white');

        refreshData(name);
    }
    const navMap = { 'overview':'overview', 'live':'live', 'requests':'requests', 'monthly':'monthly', 'account':'account', 'history':'history' };
    Object.keys(navMap).forEach(k => {
        const btn = document.getElementById(`nav-${k}-button`);
        if(btn) btn.addEventListener('click', () => switchSection(navMap[k]));
    });

    async function refreshData(name) {
        bookingsList = await apiFetch('/bookings') || [];
        requestsList = await apiFetch('/requests') || [];
        if (name === 'overview') loadOverview();
        if (name === 'live') loadLiveMonitor();
        if (name === 'requests') loadRequests();
        if (name === 'monthly') loadMonthly();
        if (name === 'history' && currentUser.role === 'admin') loadHistory();
        if (name === 'account') loadTimeAccount();
    }

    // HELPER
    function getUserName(id) { const u = usersList.find(u => u.id === id); return u ? u.displayName : `Pers.-Nr. ${id}`; }
    function timeToDec(t) { if(!t) return 0; const [h,m] = t.split(':').map(Number); return h + m/60; }
    function decToTime(d) { const h = Math.floor(Math.abs(d)); const m = Math.round((Math.abs(d)-h)*60); return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`; }
    function calcPause(brutto) { return brutto > 9 ? 0.75 : (brutto > 6 ? 0.5 : 0); }
    function getUserTarget(uid) { const u = usersList.find(x=>x.id===uid); return u ? (u.dailyTarget||8.0) : 8.0; }

    // --- FUNCTIONS ---

    // 1. LIVE
    window.manualStamp = async (action) => {
        const res = await apiFetch('/stamp-manual', 'POST', { action });
        if(res && res.status === 'success') { refreshData('live'); }
    };
    function loadLiveMonitor() {
        const today = new Date().toISOString().split('T')[0];
        if(currentUser.role !== 'admin') {
            const myLast = bookingsList.filter(b => b.userId === currentUser.id && b.date === today).pop();
            const statEl = document.getElementById('status-display');
            if(myLast && !myLast.end) {
                statEl.textContent = "Anwesend"; statEl.className = "text-5xl font-bold text-green-400 mb-3";
                document.getElementById('last-stamp-time').textContent = `Seit ${myLast.start}`;
            } else {
                statEl.textContent = "Abwesend"; statEl.className = "text-5xl font-bold text-gray-500 mb-3";
            }
            return;
        }
        const container = document.getElementById('live-users-grid');
        container.innerHTML = '';
        const active = bookingsList.filter(b => b.date === today && b.start && !b.end);
        if (active.length === 0) { container.innerHTML = '<div class="col-span-full text-center text-gray-500 italic">Keine aktiven Mitarbeiter.</div>'; return; }
        active.forEach(b => {
            container.innerHTML += `<div class="bg-ahmtimus-card border-l-4 border-green-500 p-4 rounded shadow flex items-center justify-between"><div><div class="font-bold text-white text-lg">${getUserName(b.userId)}</div><div class="text-green-400 font-mono text-sm mt-1">Seit ${b.start} Uhr</div></div><div class="h-3 w-3 bg-green-500 rounded-full animate-pulse shadow-[0_0_10px_#22c55e]"></div></div>`;
        });
    }

    // 2. OVERVIEW (JOURNAL) - MIT BLUE HOVER & EDIT ACTION
    function loadOverview() {
        const isAdmin = currentUser.role === 'admin';
        const filterUser = document.getElementById('overview-user-select');
        const filterDate = document.getElementById('filter-date');
        
        if(isAdmin) document.getElementById('admin-filters-overview').classList.remove('hidden');
        document.getElementById('apply-filter-btn').onclick = loadOverview;

        let data = bookingsList;
        if (isAdmin && filterUser.value) data = data.filter(b => b.userId == filterUser.value);
        else if (!isAdmin) data = data.filter(b => b.userId === currentUser.id);

        if (filterDate.value) data = data.filter(b => b.date === filterDate.value);
        data.sort((a,b) => new Date(b.date) - new Date(a.date));

        const container = document.getElementById('overview-list-container');
        const header = document.getElementById('overview-header');
        container.innerHTML = '';

        const gridClass = isAdmin ? 
            'grid-cols-[0.5fr_1.5fr_1fr_0.7fr_0.7fr_0.6fr_0.6fr_0.6fr_0.8fr_2fr_0.5fr]' : 
            'grid-cols-[1fr_1fr_1fr_1fr_1fr_1fr_1fr_1fr_2fr]';
        
        let headHTML = isAdmin ? `<div>Pers.-Nr.</div><div>Name</div>` : ``;
        headHTML += `<div>Datum</div><div class="text-center">Start</div><div class="text-center">Ende</div><div class="text-center text-gray-500">Pause</div><div class="text-center text-gray-500">Soll</div><div class="text-center text-gray-500">Ist</div><div class="text-center font-bold text-blue-400">Netto</div>${isAdmin ? '' : '<div class="text-center">Saldo</div>'} <div>Bemerkung</div>`;
        if(isAdmin) headHTML += `<div class="text-center text-white">Aktion</div>`;
        
        header.className = `grid ${gridClass} gap-3 px-4 py-3 bg-ahmtimus-dark text-xs font-bold text-gray-500 uppercase border-b border-ahmtimus items-center`;
        header.innerHTML = headHTML;

        if(data.length === 0) { container.innerHTML = '<div class="p-6 text-center text-gray-500 italic">Keine Einträge gefunden.</div>'; return; }

        data.forEach(b => {
            const target = getUserTarget(b.userId);
            const rawDiff = timeToDec(b.end) - timeToDec(b.start);
            const pause = b.end ? calcPause(rawDiff) : 0;
            const net = Math.max(0, rawDiff - pause);
            const saldo = b.end ? (net - target) : 0;
            
            let typeBadge = '';
            if (b.type === 'Urlaub') typeBadge = '<span class="text-[10px] bg-blue-900 text-blue-300 px-1 rounded mr-1">URLAUB</span>';
            if (b.type === 'Krank') typeBadge = '<span class="text-[10px] bg-red-900 text-red-300 px-1 rounded mr-1">KRANK</span>';

            const div = document.createElement('div');
            // HIER: 'hover-blue' statt hover:bg-ahmtimus-dark
            div.className = `grid ${gridClass} gap-3 px-4 py-3 items-center hover-blue text-sm transition group border-b border-ahmtimus last:border-0 text-gray-300`;
            
            let html = isAdmin ? `<div class="font-mono text-xs text-gray-600">${b.userId}</div><div class="font-bold text-white truncate">${getUserName(b.userId)}</div>` : ``;
            html += `<div class="text-gray-400 font-mono">${b.date.split('-').reverse().join('.')}</div>
                <div class="text-center font-mono">${b.start}</div><div class="text-center font-mono">${b.end || '--:--'}</div>
                <div class="text-center text-gray-500 text-xs font-mono">${decToTime(pause)}</div><div class="text-center text-gray-500 text-xs font-mono">${decToTime(target)}</div>
                <div class="text-center text-gray-500 text-xs font-mono">${b.end ? decToTime(rawDiff) : '-'}</div>
                <div class="text-center font-bold text-blue-400 font-mono text-base">${b.end ? decToTime(net) : '...'}</div>
                ${isAdmin ? '' : `<div class="text-center font-mono font-bold ${saldo >= 0 ? 'text-green-500' : 'text-red-500'}">${b.end ? (saldo>0?'+':'')+decToTime(saldo) : '-'}</div>`}
                <div class="truncate text-gray-500 text-xs">${typeBadge}${b.remarks||''}</div>`;
            
            // Edit Button für Admin
            if(isAdmin) html += `<div class="text-center"><button onclick="window.openEdit(${b.id})" class="text-gray-500 hover:text-white transition bg-[#0d1b33] h-8 w-8 rounded-full border border-gray-700 hover:border-blue-500 shadow-sm"><i class="fas fa-pen text-xs"></i></button></div>`;
            
            div.innerHTML = html;
            container.appendChild(div);
        });
    }

    // 3. REQUESTS
    window.handleRequest = async (id, status) => {
        if(!confirm(`Status ändern?`)) return;
        const res = await apiFetch(`/requests/${id}`, 'PUT', { status });
        if(res && res.status === 'success') refreshData('requests');
    };
    function loadRequests() {
        const isAdmin = currentUser.role === 'admin';
        const listContainer = document.getElementById('request-list-container');
        
        if (isAdmin) {
            document.getElementById('admin-request-filter-area').classList.remove('hidden');
            document.getElementById('admin-request-filter-area').classList.add('flex');
            document.getElementById('request-target-user-container').classList.remove('hidden');
            document.getElementById('req-filter-btn').onclick = loadRequests;
        }

        let data = requestsList;
        if (isAdmin) {
            const fUserId = document.getElementById('req-filter-user').value;
            const fStatus = document.getElementById('req-filter-status').value;
            if(fUserId) data = data.filter(r => r.userId == fUserId);
            if(fStatus) data = data.filter(r => r.status === fStatus);
        }
        data.sort((a,b) => b.id - a.id);

        listContainer.innerHTML = '';
        if(data.length === 0) { listContainer.innerHTML = '<p class="text-gray-500 italic p-4">Keine Anträge.</p>'; return; }

        data.forEach(req => {
            const item = document.createElement('div');
            item.className = "bg-ahmtimus-dark p-3 rounded border border-ahmtimus mb-2 hover:border-blue-500 transition";
            let statusBadge = req.status === 'pending' ? '<span class="text-yellow-500 font-bold text-xs">OFFEN</span>' : (req.status === 'approved' ? '<span class="text-green-500 font-bold text-xs">OK</span>' : '<span class="text-red-500 font-bold text-xs">ABGELEHNT</span>');
            let buttons = (isAdmin && req.status === 'pending') ? `<div class="mt-2 flex gap-2 justify-end border-t border-ahmtimus pt-2"><button onclick="window.handleRequest(${req.id}, 'approved')" class="text-xs bg-green-700 text-white px-2 py-1 rounded">OK</button><button onclick="window.handleRequest(${req.id}, 'rejected')" class="text-xs bg-red-700 text-white px-2 py-1 rounded">NEIN</button></div>` : '';
            item.innerHTML = `<div class="flex justify-between items-center mb-1"><div class="text-sm font-bold text-white">${getUserName(req.userId)}</div>${statusBadge}</div>
                <div class="text-xs text-blue-300 font-bold mb-1">${req.type} <span class="text-gray-500 font-normal">| ${req.date}</span></div>
                <div class="text-xs text-gray-400 italic">"${req.reason}"</div>${buttons}`;
            listContainer.appendChild(item);
        });
    }
    document.getElementById('request-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const formData = new FormData(e.target);
        const res = await apiFetch('/requests', 'POST', formData, true); 
        if (res && res.status === 'success') { alert('Gesendet.'); e.target.reset(); refreshData('requests'); }
    });

    // 4. MONTHLY CALENDAR - MIT BLUE HOVER
    window.loadMonthly = function() {
        const grid = document.getElementById('calendar-grid');
        const calUserContainer = document.getElementById('cal-user-container');
        const calFilterUser = document.getElementById('cal-filter-user');
        
        const selectedMonth = parseInt(document.getElementById('cal-filter-month').value);
        const selectedYear = parseInt(document.getElementById('cal-filter-year').value);
        
        let targetUserId = currentUser.id;
        
        if (currentUser.role === 'admin') {
            calUserContainer.classList.remove('hidden');
            if (calFilterUser.value) {
                targetUserId = parseInt(calFilterUser.value);
            } else {
                grid.innerHTML = '<div class="col-span-7 text-center py-10 text-gray-500">Bitte Mitarbeiter wählen & Filtern klicken.</div>';
                return;
            }
        } else {
            calUserContainer.classList.add('hidden');
        }

        grid.innerHTML = '';
        const daysInMonth = new Date(selectedYear, selectedMonth + 1, 0).getDate();
        let firstDayIndex = new Date(selectedYear, selectedMonth, 1).getDay(); firstDayIndex = firstDayIndex === 0 ? 6 : firstDayIndex - 1; 

        ['Mo','Di','Mi','Do','Fr','Sa','So'].forEach(d => {
             const h = document.createElement('div'); h.className = `text-center text-xs font-bold text-gray-500 py-2 bg-ahmtimus-dark`; h.innerText = d;
             grid.appendChild(h);
        });
        for (let i = 0; i < firstDayIndex; i++) grid.appendChild(document.createElement('div'));

        let sumTarget = 0, sumActual = 0;
        const target = getUserTarget(targetUserId);

        for (let day = 1; day <= daysInMonth; day++) {
            const dateStr = `${selectedYear}-${String(selectedMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
            const cell = document.createElement('div');
            const isWeekend = (new Date(selectedYear, selectedMonth, day).getDay() % 6 === 0);
            
            // HIER: hover:bg-blue-900/30 statt ahmtimus-dark
            cell.className = `min-h-[80px] p-1 border-t border-l border-ahmtimus relative flex flex-col ${isWeekend ? 'bg-[#050f1e]' : 'bg-ahmtimus-card hover:bg-blue-900/30'}`;
            cell.innerHTML = `<div class="text-right text-xs font-bold ${isWeekend ? 'text-blue-500' : 'text-gray-600'}">${day}</div>`;

            const b = bookingsList.find(x => x.date === dateStr && x.userId === targetUserId);
            if (b) {
                const diff = timeToDec(b.end) - timeToDec(b.start);
                const pause = b.end ? calcPause(diff) : 0;
                const net = Math.max(0, diff - pause);
                if (!isWeekend) sumTarget += target;
                sumActual += net;
                let color = b.type === 'Krank' ? 'text-red-400' : (b.type === 'Urlaub' ? 'text-blue-400' : 'text-green-400');
                let label = b.end ? decToTime(net)+'h' : 'Läuft';
                if(b.type === 'Krank') label = 'Krank';
                if(b.type === 'Urlaub') label = 'Urlaub';
                cell.innerHTML += `<div class="mt-auto text-[10px] text-center ${color}">${label}</div>`;
                if(currentUser.role === 'admin') { cell.onclick = () => window.openEdit(b.id); cell.classList.add('cursor-pointer'); }
            } else if(!isWeekend && dateStr < new Date().toISOString().split('T')[0]) {
                 sumTarget += target;
                 cell.innerHTML += `<div class="mt-auto text-center text-[8px] text-red-900 font-bold">FEHLT</div>`;
            }
            grid.appendChild(cell);
        }
        document.getElementById('cal-stat-target').textContent = decToTime(sumTarget);
        document.getElementById('cal-stat-actual').textContent = decToTime(sumActual);
        const bal = sumActual - sumTarget;
        document.getElementById('cal-stat-balance').textContent = (bal>0?'+':'') + decToTime(bal);
        document.getElementById('cal-stat-balance').className = `text-xl font-bold ${bal>=0?'text-green-500':'text-red-500'}`;
    };

    window.exportToCSV = function() {
        const selectedMonth = parseInt(document.getElementById('cal-filter-month').value) + 1;
        const selectedYear = document.getElementById('cal-filter-year').value;
        const prefix = `${selectedYear}-${String(selectedMonth).padStart(2,'0')}`;
        
        let targetUserId = currentUser.id;
        if(currentUser.role === 'admin') {
            const val = document.getElementById('cal-filter-user').value;
            if(!val) { alert("Bitte Mitarbeiter wählen für Export."); return; }
            targetUserId = val;
        }

        let csvContent = "data:text/csv;charset=utf-8,\uFEFFPers.-Nr.;Name;Datum;Start;Ende;Pause;Soll;Ist;Netto;Saldo;Bemerkung\n";
        let data = bookingsList.filter(b => b.date.startsWith(prefix) && b.userId == targetUserId);
        
        if(data.length === 0) { alert("Keine Daten für diesen Zeitraum."); return; }
        data.sort((a,b) => new Date(a.date) - new Date(b.date));

        data.forEach(b => {
            const target = getUserTarget(b.userId);
            const brutto = timeToDec(b.end) - timeToDec(b.start);
            const pause = b.end ? calcPause(brutto) : 0;
            const erfasst = Math.max(0, brutto - pause);
            const saldo = b.end ? (erfasst - target) : 0;
            csvContent += [b.userId, getUserName(b.userId), b.date, b.start, b.end||'', decToTime(pause), decToTime(target), decToTime(brutto), decToTime(erfasst), decToTime(saldo), b.remarks||''].join(";") + "\n";
        });
        const link = document.createElement("a");
        link.href = encodeURI(csvContent);
        link.download = `Export_${prefix}_${targetUserId}.csv`;
        link.click();
    };

    // 5. ACCOUNT - BLUE HOVER
    function loadTimeAccount() {
        const isAdmin = currentUser.role === 'admin';
        const filterArea = document.getElementById('account-filter-area');
        const userSelect = document.getElementById('account-user-select');

        if (isAdmin) {
            filterArea.classList.remove('hidden');
            filterArea.classList.add('flex');
            if(!userSelect.value) { return; }
        } else {
            filterArea.classList.add('hidden');
        }

        const targetId = isAdmin ? parseInt(userSelect.value) : currentUser.id;
        const user = usersList.find(u => u.id === targetId) || currentUser;
        const bookings = bookingsList.filter(b => b.userId === targetId);
        
        let totalBalance = 0;
        let vacationTaken = 0;
        let sickDays = 0;
        const currentYear = new Date().getFullYear();

        bookings.forEach(b => {
            if(b.end && b.type !== 'Krank' && b.type !== 'Urlaub') {
                const diff = timeToDec(b.end) - timeToDec(b.start);
                const pause = calcPause(diff);
                const net = Math.max(0, diff - pause);
                const dateObj = new Date(b.date);
                const isWeekend = dateObj.getDay() === 0 || dateObj.getDay() === 6;
                const effectiveTarget = isWeekend ? 0 : (user.dailyTarget || 8.0);
                totalBalance += (net - effectiveTarget);
            }
            if(new Date(b.date).getFullYear() === currentYear) {
                if(b.type === 'Urlaub') vacationTaken++;
                if(b.type === 'Krank') sickDays++;
            }
        });

        document.getElementById('acc-balance').textContent = (totalBalance >= 0 ? '+' : '') + decToTime(Math.abs(totalBalance)) + ' h';
        document.getElementById('acc-balance').className = `text-3xl font-bold ${totalBalance >= 0 ? 'text-green-500' : 'text-red-500'}`;
        document.getElementById('acc-vacation-total').textContent = user.vacationDays || 30;
        document.getElementById('acc-vacation-left').textContent = (user.vacationDays || 30) - vacationTaken;
        document.getElementById('acc-sick').textContent = sickDays;

        const listContainer = document.getElementById('account-history-list');
        listContainer.innerHTML = '';
        const historyData = [...bookings].sort((a,b) => new Date(b.date) - new Date(a.date)).slice(0, 50);
        historyData.forEach(b => {
             const diff = b.end ? (timeToDec(b.end) - timeToDec(b.start)) : 0;
             const pause = b.end ? calcPause(diff) : 0;
             const net = Math.max(0, diff - pause);
             const div = document.createElement('div');
             // HIER: Blue Hover
             div.className = "px-6 py-2 flex justify-between items-center hover:bg-blue-900/20 text-sm text-gray-400 border-b border-[#233554] last:border-0";
             div.innerHTML = `<div><span class="font-bold text-gray-300">${b.date}</span> <span class="text-xs ml-2">${b.type}</span></div><div class="font-mono">${decToTime(net)} h</div>`;
             listContainer.appendChild(div);
        });
    }

    // 6. HISTORY - BLUE HOVER
    function loadHistory() {
        apiFetch('/history').then(log => {
            const tbody = document.getElementById('audit-log-body');
            tbody.innerHTML = '';
            if (!log || log.length === 0) return;
            log.forEach(entry => {
                const tr = document.createElement('tr');
                // HIER: Blue Hover
                tr.className = "hover:bg-blue-900/20 border-b border-ahmtimus transition";
                tr.innerHTML = `
                    <td class="px-6 py-2 text-gray-500 text-xs">${new Date(entry.timestamp).toLocaleString()}</td>
                    <td class="px-6 py-2 font-bold text-gray-300">${entry.actor}</td>
                    <td class="px-6 py-2 text-xs text-blue-400 uppercase">${entry.module || '-'}</td>
                    <td class="px-6 py-2 text-xs">${entry.action}</td>
                    <td class="px-6 py-2 text-xs text-red-300 font-mono">${entry.oldValue || '-'}</td>
                    <td class="px-6 py-2 text-xs text-green-300 font-mono">${entry.newValue || '-'}</td>
                `;
                tbody.appendChild(tr);
            });
        });
    }

    // EDIT MODAL LOGIC (WICHTIG FÜR DIE BEARBEITUNG)
    window.openEdit = function(id) {
        const b = bookingsList.find(x => x.id === id); if(!b) return;
        document.getElementById('edit-id').value = b.id;
        document.getElementById('edit-user').value = getUserName(b.userId);
        document.getElementById('edit-start').value = b.start;
        document.getElementById('edit-end').value = b.end;
        document.getElementById('edit-remark').value = b.remarks || '';
        document.getElementById('admin-edit-modal').classList.remove('hidden');
    };
    
    document.getElementById('close-modal-btn').onclick = () => document.getElementById('admin-edit-modal').classList.add('hidden');
    
    document.getElementById('admin-edit-form').onsubmit = async (e) => {
        e.preventDefault();
        const id = document.getElementById('edit-id').value;
        const body = { 
            start: document.getElementById('edit-start').value, 
            end: document.getElementById('edit-end').value, 
            remarks: document.getElementById('edit-remark').value 
        };
        // HIER: Aufruf der korrigierten PUT Route
        const res = await apiFetch(`/bookings/${id}`, 'PUT', body);
        
        if(res && res.status === 'success') { 
            document.getElementById('admin-edit-modal').classList.add('hidden'); 
            // Automatisch aktualisieren, damit die Änderung sichtbar ist
            refreshData('overview'); 
            refreshData('monthly'); 
        } else {
            alert(res.message || "Fehler beim Speichern");
        }
    };
});