document.addEventListener('DOMContentLoaded', () => {
    let currentUser = null;
    let usersList = [];
    let bookingsList = [];
    let requestsList = [];

    // API URL
    const API_URL = '/api/v1'; 

    // --- SESSION WIEDERHERSTELLEN (Robuste Version) ---
    const storedUser = localStorage.getItem('zes_user');
    if (storedUser) {
        try {
            const parsed = JSON.parse(storedUser);
            if (parsed && parsed.token) {
                currentUser = parsed;
                console.log("Session wiederhergestellt für:", currentUser.displayName);
            }
        } catch (e) {
            console.error("Session defekt (JSON Fehler), logge aus...", e);
            localStorage.removeItem('zes_user');
        }
    }

    // Falls wir einen User haben, bauen wir die UI auf
    if (currentUser) {
        // Kurze Verzögerung, damit Funktionen wie setupAfterLogin sicher geladen sind
        setTimeout(() => {
            try {
                setupAfterLogin();
            } catch (e) {
                console.error("Fehler beim UI-Aufbau (aber Session ist ok):", e);
            }
        }, 10);
    }

    async function apiFetch(endpoint, method = 'GET', body = null, isFormData = false) {
        const headers = {};
        if (currentUser && currentUser.token) headers['Authorization'] = `Bearer ${currentUser.token}`;
        if (!isFormData) headers['Content-Type'] = 'application/json';

        const config = { method, headers };
        if (body) config.body = isFormData ? body : JSON.stringify(body);

        try {
            const res = await fetch(`${API_URL}${endpoint}`, config);
            if (!res.ok) {
                if (res.status === 401) {
                    console.warn("Token abgelaufen -> Logout");
                    logout();
                    return null;
                }
                const errData = await res.json().catch(() => ({}));
                throw new Error(errData.message || `API Error ${res.status}`);
            }
            return await res.json();
        } catch (err) {
            console.error("API Fetch Error:", err);
            return { status: "error", message: err.message };
        }
    }
    
    // LOGIN LOGIK
    document.getElementById('login-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const u = document.getElementById('username').value;
        const p = document.getElementById('password').value;
        
        const data = await apiFetch('/login', 'POST', { username: u, password: p });
        
        if (data && data.status === "success") {
            currentUser = { ...data.user, token: data.token };
            
            // Zwangspasswort Check
            if (currentUser.mustChangePassword) {
                alert("Willkommen! Dies ist Ihre erste Anmeldung.\nBitte ändern Sie Ihr Passwort.");
                document.getElementById('login-page').classList.add('hidden');
                document.getElementById('tracker-page').classList.remove('hidden');
                document.getElementById('password-modal').classList.remove('hidden');
                document.getElementById('close-pw-modal').style.display = 'none'; // Kein Abbrechen
                return; 
            }

            // Speichern im Browser (Damit Reload klappt!)
            localStorage.setItem('zes_user', JSON.stringify(currentUser));

            setupAfterLogin();
        } else {
            const errEl = document.getElementById('error-message');
            errEl.textContent = data.message || "Anmeldung fehlgeschlagen.";
            errEl.classList.remove('hidden');
        }
    });

    function setupAfterLogin() {
        document.getElementById('user-display-name').textContent = currentUser.displayName;
        document.getElementById('client-name-display').textContent = currentUser.clientName || "System";

        // Admin Button im Header
        const createUserBtn = document.getElementById('nav-create-user-btn');
        if (currentUser.role === 'admin') {
            createUserBtn.classList.remove('hidden');
            createUserBtn.onclick = () => document.getElementById('create-user-modal').classList.remove('hidden');
        }

        // UI Setup nach Rolle
        if (currentUser.role === 'admin') {
            document.getElementById('nav-dashboard-button').classList.add('hidden');
            document.getElementById('nav-live-button').classList.remove('hidden');
            document.getElementById('user-live-terminal').classList.add('hidden');
            document.getElementById('admin-live-dashboard').classList.remove('hidden');
            
            // Initial User laden für Dropdowns
            apiFetch('/users').then(data => {
                if(Array.isArray(data)) {
                    usersList = data;
                    initAllDropdowns();
                }
            });
        } else {
            document.getElementById('nav-dashboard-button').classList.remove('hidden');
            document.getElementById('nav-live-button').classList.add('hidden');
            document.getElementById('user-live-terminal').classList.remove('hidden');
            document.getElementById('admin-live-dashboard').classList.add('hidden');
            
            usersList = [{
                id: currentUser.id,
                displayName: currentUser.displayName,
                dailyTarget: currentUser.dailyTarget,
                vacationDays: currentUser.vacationDays
            }];
            initAllDropdowns();
        }
        
        checkNotifications();
        document.getElementById('login-page').classList.add('hidden');
        document.getElementById('tracker-page').classList.remove('hidden');
        
        if (!window.location.hash) {
            // Kein Hash? Dann Standard setzen
            window.location.hash = (currentUser.role === 'admin') ? 'live' : 'dashboard';
        } else {
            // Hash da? Dann diesen ausführen!
            handleRouting(); 
        }
    }

    document.getElementById('logout-button').addEventListener('click', () => logout());

    function logout() {
        currentUser = null;
        localStorage.removeItem('zes_user'); // Session löschen
        location.reload();
    }

    // --- NEUER MITARBEITER ANLEGEN ---
    const createUserModal = document.getElementById('create-user-modal');
    const closeCreateUser = document.getElementById('close-create-user-modal');
    const createUserForm = document.getElementById('create-user-form');

    if (closeCreateUser) {
        closeCreateUser.addEventListener('click', () => {
            createUserModal.classList.add('hidden');
        });
    }

    if (createUserForm) {
        createUserForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const body = {
                username: e.target.username.value,
                displayName: e.target.displayName.value,
                cardId: e.target.cardId.value,
                vacationDays: e.target.vacationDays.value,
                dailyTarget: e.target.dailyTarget.value
            };

            const res = await apiFetch('/users', 'POST', body);
            if (res && res.status === 'success') {
                alert(res.message); 
                createUserModal.classList.add('hidden');
                e.target.reset();
                // Reload erzwingen, um Dropdowns zu aktualisieren (jetzt sicher dank LocalStorage!)
                location.reload(); 
            } else {
                alert(res ? res.message : "Fehler beim Anlegen.");
            }
        });
    }

// --- NAVIGATION (Mit Zurück-Button Support) ---
    
    // 1. Die Funktion, die die Ansicht tatsächlich ändert (UI Update)
    function renderSection(name) {
        // Inhalt umschalten
        document.querySelectorAll('.content-section').forEach(el => el.classList.add('hidden'));
        const contentEl = document.getElementById(`content-${name}`);
        if(contentEl) contentEl.classList.remove('hidden');
        
        // Buttons aktualisieren (Highlight)
        document.querySelectorAll('.nav-item').forEach(btn => {
            btn.classList.remove('bg-brand', 'text-white', 'shadow');
            btn.classList.add('text-textMuted');
        });

        // Den aktiven Button suchen und blau machen
        const activeBtn = document.getElementById(`nav-${name}-button`);
        if (activeBtn) {
            activeBtn.classList.remove('text-textMuted');
            activeBtn.classList.add('bg-brand', 'text-white', 'shadow');
        }

        // Daten laden
        refreshData(name);
    }

    // 2. Mapping: Welcher Button führt zu welchem Hash?
    const navMap = { 
        'dashboard': 'dashboard', 'overview': 'overview', 'live':'live',
        'requests':'requests', 'monthly':'monthly', 'account': 'account', 'history':'history' 
    };

    // 3. Klick-Listener: Ändert NUR die URL (#hash)
    Object.keys(navMap).forEach(k => {
        const btn = document.getElementById(`nav-${k}-button`);
        if(btn) {
            // Alte Listener entfernen (trickreich, daher überschreiben wir onclick hier sicherheitshalber)
            btn.onclick = () => {
                window.location.hash = navMap[k];
            };
        }
    });

    // 4. Auf URL-Änderungen hören (Das ist das Herzstück!)
    window.addEventListener('hashchange', () => {
        handleRouting();
    });

    // Zentrale Routing-Funktion
    function handleRouting() {
        // Hash aus der URL lesen (z.B. "#requests" -> "requests")
        let hash = window.location.hash.replace('#', '');
        
        // Fallback: Wenn kein Hash da ist oder er ungültig ist
        if (!hash || !Object.values(navMap).includes(hash)) {
            // Default je nach Rolle
            if (currentUser && currentUser.role === 'admin') hash = 'live';
            else hash = 'dashboard';
        }

        // Admin-Schutz: User darf nicht auf #live zugreifen
        if (currentUser && currentUser.role !== 'admin' && hash === 'live') {
            hash = 'dashboard';
        }

        renderSection(hash);
    }

    // Hilfsfunktion, damit alte Aufrufe im Code (z.B. aus Benachrichtigungen) noch gehen
    window.switchSection = function(name) {
        window.location.hash = name;
    };

    Object.keys(navMap).forEach(k => {
        const btn = document.getElementById(`nav-${k}-button`);
        if(btn) btn.addEventListener('click', () => switchSection(navMap[k]));
    });

    async function refreshData(name) {
        if(!currentUser) return; // Nicht laden wenn ausgeloggt
        
        // Paralleles Laden für Performance
        const [bookings, requests] = await Promise.all([
            apiFetch('/bookings'),
            apiFetch('/requests')
        ]);
        
        if(Array.isArray(bookings)) bookingsList = bookings;
        if(Array.isArray(requests)) requestsList = requests;

        if (name === 'overview') loadOverview();
        if (name === 'live') loadLiveMonitor();
        if (name === 'requests') loadRequests();
        if (name === 'monthly') loadMonthly();
        if (name === 'history') loadHistory();
        if (name === 'account') loadTimeAccount();
        if (name === 'dashboard') loadDashboard();
    }

    // --- DROPDOWNS ---
    function initAllDropdowns() {
        const selects = ['overview-user-select', 'req-filter-user', 'request-target-user', 'cal-filter-user', 'account-user-select'];
        selects.forEach(id => {
            const el = document.getElementById(id);
            if(!el) return;
            // Aktuellen Wert merken
            const oldVal = el.value;
            el.innerHTML = '<option value="" disabled selected>Bitte wählen...</option>';
            // Wir zeigen alle User an (oder nur 'user' Rolle, je nach Wunsch. Hier alle:)
            usersList.forEach(u => {
                el.add(new Option(u.displayName, u.id));
            });
            if(oldVal) el.value = oldVal;
        });
        
        // Monat/Jahr Init
        const monthSelect = document.getElementById('cal-filter-month');
        if(monthSelect && monthSelect.options.length === 0) {
            ['Januar','Februar','März','April','Mai','Juni','Juli','August','September','Oktober','November','Dezember'].forEach((m,i) => {
                monthSelect.add(new Option(m, i));
            });
            monthSelect.value = new Date().getMonth();
        }
        
        const yearSelect = document.getElementById('cal-filter-year');
        if(yearSelect && yearSelect.options.length === 0) {
            [2024, 2025, 2026, 2027].forEach(y => yearSelect.add(new Option(y, y)));
            yearSelect.value = new Date().getFullYear();
        }
    }

    // --- HELPER ---
    function getUserName(id) { 
        const u = usersList.find(u => u.id === id); 
        return u ? u.displayName : `ID ${id}`; 
    }
    
    function timeToDec(t) { 
        if(!t) return 0; 
        const [h,m] = t.split(':').map(Number); 
        return h + m/60; 
    }
    
    function decToTime(d) { 
        const h = Math.floor(Math.abs(d)); 
        const m = Math.round((Math.abs(d)-h)*60); 
        return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`; 
    }
    
    function calcPause(brutto) { return brutto > 9 ? 0.75 : (brutto > 6 ? 0.5 : 0); }
    
    function getUserTarget(uid) { 
        const u = usersList.find(x => x.id === uid); 
        return u ? (Number(u.dailyTarget) || 8.0) : 8.0; 
    }

    // --- 1. LIVE MONITOR ---
    window.manualStamp = async (action) => {
        const res = await apiFetch('/stamp-manual', 'POST', { action });
        if(res && res.status === 'success') { refreshData('live'); }
    };

    function loadLiveMonitor() {
        const today = new Date().toLocaleDateString('en-CA');
        const container = document.getElementById('live-users-grid');
        
        // Admin View
        if(currentUser.role === 'admin') {
            container.innerHTML = '';
            const active = bookingsList.filter(b => b.date === today && b.start && !b.end);
            if (active.length === 0) {
                container.innerHTML = '<div class="col-span-full text-center text-gray-500 italic p-10">Keine Mitarbeiter aktiv.</div>';
                return;
            }
            active.forEach(b => {
                container.innerHTML += `
                <div class="bg-[#112240] border-l-4 border-green-500 p-4 rounded shadow-lg flex items-center justify-between animate-fade">
                    <div>
                        <div class="font-bold text-white text-lg font-brand">${getUserName(b.userId)}</div>
                        <div class="text-green-400 font-mono text-sm mt-1"><i class="fas fa-clock mr-1"></i> Seit ${b.start} Uhr</div>
                    </div>
                    <div class="relative"><div class="h-3 w-3 bg-green-500 rounded-full animate-ping"></div></div>
                </div>`;
            });
        } 
        // User View
        else {
            const myLast = bookingsList.filter(b => b.userId === currentUser.id && b.date === today).pop();
            const statEl = document.getElementById('status-display');
            const lastStamp = document.getElementById('last-stamp-time');
            
            if(myLast && !myLast.end) {
                statEl.textContent = "ANWESEND";
                statEl.className = "text-5xl lg:text-6xl font-brand font-bold text-green-400 mb-4 drop-shadow-md";
                lastStamp.textContent = `Seit ${myLast.start} Uhr`;
                lastStamp.className = "inline-block bg-[#0a192f] px-6 py-2 rounded-full text-green-400 font-mono border border-green-900/50 mb-10 text-sm";
            } else {
                statEl.textContent = "ABWESEND";
                statEl.className = "text-5xl lg:text-6xl font-brand font-bold text-gray-500 mb-4 drop-shadow-md";
                lastStamp.textContent = "--:--";
                lastStamp.className = "inline-block bg-[#0a192f] px-6 py-2 rounded-full text-gray-500 font-mono border border-[#233554] mb-10 text-sm";
            }
        }
    }



    // 2. JOURNAL
    async function loadOverview() {
        const isAdmin = currentUser.role === 'admin';
        const filterUser = document.getElementById('overview-user-select');
        const startInp = document.getElementById('filter-date-start');
        const endInp = document.getElementById('filter-date-end');

        if(isAdmin) document.getElementById('admin-filters-overview').classList.remove('hidden');
        document.getElementById('apply-filter-btn').onclick = loadOverview;

        let url = '/bookings?';
        if(startInp && endInp && startInp.value && endInp.value) {
            url += `from=${startInp.value}&to=${endInp.value}&`;
        }
        
        let data = await apiFetch(url);
        if(!Array.isArray(data)) data = [];

        if (isAdmin && filterUser.value) data = data.filter(b => b.userId == filterUser.value);
        else if (!isAdmin) data = data.filter(b => b.userId === currentUser.id);

        data.sort((a,b) => new Date(b.date) - new Date(a.date));
        
        const container = document.getElementById('overview-list-container');
        const header = document.getElementById('overview-header');
        container.innerHTML = '';

            const gridClass = isAdmin 
            ? 'grid-cols-[0.5fr_1.5fr_1fr_0.7fr_0.7fr_0.6fr_0.6fr_0.6fr_0.6fr_0.6fr_2fr]' // 11 Werte
            : 'grid-cols-[1fr_1fr_1fr_1fr_1fr_1fr_1fr_1fr_2fr]'; // 9 Werte        

        let headHTML = isAdmin ? `<div class="text-textMuted">ID</div><div class="text-textMuted">Name</div>` : ``;
        headHTML += `
            <div class="text-textMuted">Datum</div>
            <div class="text-center text-textMuted">Beginn</div>
            <div class="text-center text-textMuted">Ende</div>
            <div class="text-center text-textMuted text-[10px] uppercase">Pause</div>
            <div class="text-center text-textMuted text-[10px] uppercase">Soll</div>
            <div class="text-center text-textMuted text-[10px] uppercase">Ist</div>
            <div class="text-center font-bold text-brand">Netto</div>
            ${isAdmin ? '<div class="text-center text-textMuted">Saldo</div>' : ''}
            <div class="text-textMuted">Info</div>
        `;
        
        header.className = `grid ${gridClass} gap-2 px-4 py-3 bg-[#0d1b33] border-b border-border text-xs font-bold uppercase items-center sticky top-0 z-10`;
        header.innerHTML = headHTML;

        if(data.length === 0) { container.innerHTML = '<div class="p-10 text-center text-gray-500 italic">Keine Einträge.</div>'; return; }

        data.forEach(b => {
            const target = getUserTarget(b.userId);
            const isFullDay = (b.type === 'Urlaub' || b.type === 'Krank'); 
            
            const rawDiff = (!isFullDay && b.end && b.start) ? timeToDec(b.end) - timeToDec(b.start) : 0;
            const pause = (b.end && !isFullDay) ? calcPause(rawDiff) : 0;
            const net = Math.max(0, rawDiff - pause);
            const saldo = b.end ? (isFullDay ? 0 : (net - target)) : 0; 

            const div = document.createElement('div');
            div.className = `grid ${gridClass} gap-2 px-4 py-3 items-center hover:bg-[#1a2f55] transition border-b border-border text-sm text-gray-300 group`;
            
            let html = isAdmin ? `<div class="font-mono text-xs text-gray-500">${b.userId}</div><div class="font-bold text-white truncate text-xs">${getUserName(b.userId)}</div>` : ``;
            
            const displayStart = isFullDay ? '-' : b.start;
            const displayEnd   = isFullDay ? '-' : (b.end || '--:--');
            const displayPause = isFullDay ? '-' : decToTime(pause);
            const displayNet   = isFullDay ? decToTime(target) : (b.end ? decToTime(net) : '...'); 
            
            // --- NEUE LOGIK FÜR TYPE/ICONS ---
            let typeIcon = '';
            let typeText = b.type; // Fallback

            if (b.type === 'Urlaub') { typeIcon = '<i class="fas fa-umbrella-beach text-purple-400"></i>'; }
            else if (b.type === 'Krank') { typeIcon = '<i class="fas fa-first-aid text-red-400"></i>'; }
            else if (b.type === 'Web-Terminal') { typeIcon = '<i class="fas fa-laptop text-blue-300"></i>'; typeText = 'Web Buchung'; }
            else if (b.type === 'valid') { typeIcon = '<i class="fas fa-id-card text-green-400"></i>'; typeText = 'Terminal Buchung'; } // "valid" ersetzt!
            else if (b.type === 'Korrektur') { typeIcon = '<i class="fas fa-edit text-yellow-400"></i>'; }
            
            // Bemerkung hat Vorrang vor Typ-Text, außer Typ ist wichtig
            let displayText = b.remarks || typeText;

            html += `
                <div class="text-gray-400 font-mono text-xs">${b.date.split('-').reverse().join('.')}</div>
                <div class="text-center font-mono bg-[#0a192f] rounded py-0.5 text-xs">${displayStart}</div>
                <div class="text-center font-mono bg-[#0a192f] rounded py-0.5 text-xs">${displayEnd}</div>
                <div class="text-center text-gray-500 text-xs font-mono">${displayPause}</div>
                <div class="text-center text-gray-500 text-xs font-mono">${decToTime(target)}</div>
                <div class="text-center text-gray-500 text-xs font-mono">${b.end ? (isFullDay ? decToTime(target) : decToTime(rawDiff)) : '-'}</div>
                <div class="text-center font-bold text-brand font-mono text-sm">${displayNet}</div>
                ${isAdmin ? `<div class="text-center font-mono font-bold ${saldo >= 0 ? 'text-green-500' : 'text-red-500'}">${b.end ? (saldo > 0 ? '+' : '') + decToTime(saldo) : '-'}</div>` : ''}
                
                <div class="text-gray-400 text-xs flex items-center gap-2 truncate" title="${displayText}">
                    <span class="shrink-0 w-4 text-center">${typeIcon}</span>
                    <span class="truncate">${displayText}</span>
                </div>
            `;
            div.innerHTML = html;
            container.appendChild(div);
        });
    }

    // 3. ANTRÄGE
    window.handleRequest = async (id, status) => {
        if(!confirm('Status wirklich ändern?')) return;
        const res = await apiFetch(`/requests/${id}`, 'PUT', { status });
        if(res && res.status === 'success') refreshData('requests');
    };

    function loadRequests() {
        const isAdmin = currentUser.role === 'admin';
        const listContainer = document.getElementById('request-list-container');
        
        if(isAdmin) {
            document.getElementById('admin-request-filter-area').classList.remove('hidden');
            document.getElementById('admin-request-filter-area').classList.add('flex');
            document.getElementById('request-target-user-container').classList.remove('hidden');
            document.getElementById('req-filter-btn').onclick = loadRequests;
        }

        let data = requestsList;
        if(isAdmin) {
            const fUserId = document.getElementById('req-filter-user').value;
            const fStatus = document.getElementById('req-filter-status').value;
            if(fUserId) data = data.filter(r => r.userId == fUserId);
            if(fStatus) data = data.filter(r => r.status === fStatus);
        }
        
        data.sort((a,b) => b.id - a.id);
        listContainer.innerHTML = '';
        
        if(data.length === 0) { listContainer.innerHTML = '<p class="text-gray-500 italic p-4 text-center">Keine Anträge.</p>'; return; }

        data.forEach(req => {
            const item = document.createElement('div');
            item.className = "bg-[#0a192f] p-4 rounded border border-border mb-3 hover:border-brand/50 transition shadow-sm relative overflow-hidden";
            
            let statusBadge = '';
            if(req.status === 'pending') statusBadge = '<span class="text-yellow-500 bg-yellow-900/20 px-2 py-0.5 rounded text-[10px] font-bold border border-yellow-900/50">OFFEN</span>';
            else if(req.status === 'approved') statusBadge = '<span class="text-green-500 bg-green-900/20 px-2 py-0.5 rounded text-[10px] font-bold border border-green-900/50">GENEHMIGT</span>';
            else statusBadge = '<span class="text-red-500 bg-red-900/20 px-2 py-0.5 rounded text-[10px] font-bold border border-red-900/50">ABGELEHNT</span>';

            let buttons = (isAdmin && req.status === 'pending') ? 
                `<div class="mt-3 flex gap-2 justify-end border-t border-border pt-2">
                    <button onclick="window.handleRequest(${req.id}, 'approved')" class="text-xs bg-green-600 hover:bg-green-500 text-white px-3 py-1 rounded font-bold shadow">OK</button>
                    <button onclick="window.handleRequest(${req.id}, 'rejected')" class="text-xs bg-red-600 hover:bg-red-500 text-white px-3 py-1 rounded font-bold shadow">ABLEHNEN</button>
                 </div>` : '';

            item.innerHTML = `
                <div class="flex justify-between items-start mb-2">
                    <div class="flex items-center gap-2"><div class="text-sm font-bold text-white font-brand">${getUserName(req.userId)}</div></div>
                    ${statusBadge}
                </div>
                <div class="text-xs text-brand font-bold mb-1 uppercase tracking-wide">${req.type} <span class="text-gray-500 font-normal ml-2 font-mono">${req.date} ${req.endDate ? '-> '+req.endDate : ''}</span></div>
                <div class="bg-[#112240] p-2 rounded text-xs text-gray-300 italic mb-1 border border-border/50">"${req.reason}"</div>
                ${buttons}
            `;
            listContainer.appendChild(item);
        });
    }

    document.getElementById('request-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const data = {
            targetUserId: e.target.targetUserId ? e.target.targetUserId.value : null,
            type: e.target.type.value,
            date: e.target.date.value,
            endDate: e.target.endDate.value,
            newStart: e.target.newStart.value,
            newEnd: e.target.newEnd.value,
            reason: e.target.reason.value
        };
        const res = await apiFetch('/requests', 'POST', data);
        if(res && res.status === 'success') {
            alert('Antrag gesendet.');
            e.target.reset();
            refreshData('requests');
        }
    });

    // 4. BENACHRICHTIGUNGEN
    // 4. BENACHRICHTIGUNGEN (Status Farben & Deutsch)
    async function checkNotifications() {
        if(!currentUser) return;
        const data = await apiFetch('/notifications');
        if(!data) return;
        const badge = document.getElementById('notification-badge');
        const list = document.getElementById('notification-list');
        
        if(data.count > 0) {
            badge.textContent = data.count;
            badge.classList.remove('hidden');
        } else {
            badge.classList.add('hidden');
        }

        list.innerHTML = '';
        if (data.items.length === 0) {
            list.innerHTML = '<div class="p-4 text-center text-gray-500 text-xs italic">Keine neuen Nachrichten.</div>';
        }


        data.items.forEach(item => {
            const div = document.createElement('div');
            div.className = "p-3 border-l-4 mb-1 cursor-pointer hover:bg-[#1a2f55] transition text-xs border-b border-border last:border-0";
            
            if(currentUser.role === 'admin') {
                // Admin sieht offene Anträge (Gelb)
                div.classList.add('border-yellow-500');
                div.innerHTML = `
                    <div class="font-bold text-white">${item.user}</div>
                    <div class="text-brand font-bold mt-1 uppercase text-[10px]">${item.type}</div>
                    <div class="text-gray-500 text-[10px]">${item.date}</div>
                `;
                div.onclick = () => { switchSection('requests'); document.getElementById('notification-dropdown').classList.add('hidden'); }
            } else {
                // User sieht Antwort (Grün/Rot)
                const isAppr = item.status === 'approved';
                div.classList.add(isAppr ? 'border-green-500' : 'border-red-500');
                
                const statusText = isAppr ? 'GENEHMIGT' : 'ABGELEHNT';
                const statusColor = isAppr ? 'text-green-400' : 'text-red-400';
                
                div.innerHTML = `
                    <div class="flex justify-between items-center">
                        <span class="font-bold text-white uppercase tracking-wider">${item.type}</span>
                        <span class="${statusColor} font-bold text-[9px] border border-current px-1 rounded">${statusText}</span>
                    </div>
                    <div class="text-gray-400 italic mt-1 text-[10px]">"${item.reason || '-'}"</div>
                    <div class="text-gray-600 text-[9px] mt-1 text-right">${item.date}</div>
                `;
            }
            list.appendChild(div);
        });
    }
    // --- EVENT LISTENER FÜR DIE GLOCKE (Wichtig!) ---
    const notiBtn = document.getElementById('notification-btn');
    if (notiBtn) {
        notiBtn.onclick = (e) => {
            e.stopPropagation(); // Verhindert, dass der Klick das Menü sofort wieder schließt
            const dropdown = document.getElementById('notification-dropdown');
            dropdown.classList.toggle('hidden');
        };
    }

    // Event Listener für "Als gelesen markieren"
    const clearBtn = document.getElementById('notification-clear-btn');
    if (clearBtn) {
        clearBtn.onclick = async (e) => {
            e.stopPropagation(); // Menü offen lassen
            await apiFetch('/notifications/read', 'POST', {});
            checkNotifications(); // Liste aktualisieren (sollte dann leer sein)
        };
    }

    // Klick außerhalb schließt das Menü (UX Verbesserung)
    document.addEventListener('click', (e) => {
        const dropdown = document.getElementById('notification-dropdown');
        if (!dropdown.classList.contains('hidden') && !e.target.closest('#notification-btn') && !e.target.closest('#notification-dropdown')) {
            dropdown.classList.add('hidden');
        }
    });

    // 5. PASSWORT ÄNDERN & ETC (aus deinem Code)
    const pwForm = document.getElementById('password-form');
    if(pwForm) {
        pwForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const old = document.getElementById('pw-old').value;
            const n = document.getElementById('pw-new').value;
            const c = document.getElementById('pw-confirm').value;
            
            if(n !== c) { alert("Passwörter stimmen nicht überein"); return; }
            
            const res = await apiFetch('/password', 'PUT', { oldPassword: old, newPassword: n });
            if(res.status === 'success') {
                alert("Passwort geändert!");
                // Falls Zwang, jetzt aufheben im UI
                currentUser.mustChangePassword = false;
                localStorage.setItem('zes_user', JSON.stringify(currentUser));
                document.getElementById('password-modal').classList.add('hidden');
                document.getElementById('close-pw-modal').style.display = 'block'; // Knopf wieder zeigen für später
            } else {
                alert(res.message);
            }
        });
    }
    document.getElementById('nav-password-button').onclick = () => {
        document.getElementById('password-modal').classList.remove('hidden');
    }
    document.getElementById('close-pw-modal').onclick = () => {
        document.getElementById('password-modal').classList.add('hidden');
    }

    
    // --- 5. DASHBOARD (mit Resturlaub) ---
    async function loadDashboard() {
        // Daten vom Server holen
        const data = await apiFetch('/dashboard');
        if (!data) return;
        
        // Wochenstunden
        const hoursEl = document.getElementById('dash-hours-week');
        if(hoursEl) hoursEl.textContent = (data.hoursWeek || 0).toString().replace('.', ',');
        
        // Warnungen (Alerts)
        const alertContainer = document.getElementById('dashboard-alerts-container');
        if(alertContainer) {
            alertContainer.innerHTML = '';
            if (data.alerts && data.alerts.length > 0) {
                alertContainer.classList.remove('hidden');
                data.alerts.forEach(alert => {
                    const div = document.createElement('div');
                    div.className = "bg-red-900/10 border-l-4 border-red-500 p-4 rounded flex justify-between items-center shadow-lg mb-2";
                    div.innerHTML = `
                        <div>
                            <div class="text-red-400 font-bold text-sm uppercase tracking-wide"><i class="fas fa-exclamation-triangle mr-2"></i> Fehler: ${alert.date}</div>
                            <div class="text-gray-500 text-xs mt-1">Kein "Gehen" gebucht (Start: ${alert.start})</div>
                        </div>
                        <div class="text-[10px] text-red-300">Bitte korrigieren</div>
                    `;
                    alertContainer.appendChild(div);
                });
            } else {
                alertContainer.classList.add('hidden');
            }
        }
    }

    // --- 6. MONATSKALENDER (mit Admin-Auswahl) ---
    window.loadMonthly = function() {
        const grid = document.getElementById('calendar-grid');
        const calUserContainer = document.getElementById('cal-user-container');
        const calFilterUser = document.getElementById('cal-filter-user');
        
        const selectedMonth = parseInt(document.getElementById('cal-filter-month').value);
        const selectedYear = parseInt(document.getElementById('cal-filter-year').value);
        
        let targetUserId = currentUser.id;

        // Admin-Logik: Darf anderen User wählen
        if (currentUser.role === 'admin') {
            calUserContainer.classList.remove('hidden'); 
            calUserContainer.classList.add('flex'); // Flexbox erzwingen
            
            if (calFilterUser.value) {
                targetUserId = parseInt(calFilterUser.value);
            } else {
                // Wenn Admin noch niemanden gewählt hat
                grid.innerHTML = '<div class="col-span-7 text-center py-10 text-gray-500 italic">Bitte Mitarbeiter oben auswählen und "Laden" klicken.</div>';
                return;
            }
        } else {
            calUserContainer.classList.add('hidden');
            calUserContainer.classList.remove('flex');
        }

        // Grid bauen
        grid.innerHTML = '';
        
        // Header (Mo-So)
        const days = ['Mo','Di','Mi','Do','Fr','Sa','So'];
        days.forEach(d => grid.innerHTML += `<div class="text-center text-gray-500 text-[10px] font-bold py-2 uppercase bg-[#0d1b33]">${d}</div>`);

        const firstDay = new Date(selectedYear, selectedMonth, 1);
        const lastDay = new Date(selectedYear, selectedMonth + 1, 0);
        
        // Leere Zellen davor (Montag startend)
        let emptyDays = firstDay.getDay() - 1; 
        if (emptyDays === -1) emptyDays = 6; // Sonntag fix
        
        for(let i=0; i<emptyDays; i++) {
            grid.innerHTML += `<div class="h-24 bg-[#112240]/50 border border-[#233554]/50"></div>`;
        }

        // Tage füllen
        // Soll-Stunden holen (für den gewählten User)
        const targetHours = getUserTarget(targetUserId);
        let monthActual = 0;
        let monthTarget = 0;

        for(let d=1; d<=lastDay.getDate(); d++) {
            const currentStr = `${selectedYear}-${String(selectedMonth+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
            const dayBooking = bookingsList.find(b => b.userId === targetUserId && b.date === currentStr);
            const dateObj = new Date(selectedYear, selectedMonth, d);
            const isWeekend = (dateObj.getDay() === 0 || dateObj.getDay() === 6);

            let content = '';
            let styleClass = isWeekend ? 'bg-[#0d1b33]/50' : 'bg-[#112240]';
            
            if(dayBooking) {
                const rawDiff = timeToDec(dayBooking.end) - timeToDec(dayBooking.start);
                const pause = dayBooking.end ? calcPause(rawDiff) : 0;
                const net = Math.max(0, rawDiff - pause);
                
                monthActual += net;
                if(!isWeekend && dayBooking.type !== 'Urlaub' && dayBooking.type !== 'Krank') monthTarget += targetHours;

                let colorClass = 'text-white';
                if(dayBooking.type === 'Urlaub') { colorClass = 'text-purple-400'; content = '<i class="fas fa-umbrella-beach"></i>'; }
                else if(dayBooking.type === 'Krank') { colorClass = 'text-red-400'; content = '<i class="fas fa-first-aid"></i>'; }
                else if(dayBooking.end) { content = decToTime(net); }
                else { content = 'Offen'; colorClass = 'text-yellow-500 animate-pulse'; }

                grid.innerHTML += `
                    <div class="h-24 border border-[#233554] p-1 flex flex-col justify-between ${styleClass} hover:bg-[#1a2f55] transition relative group">
                        <span class="text-xs text-gray-500 font-mono">${d}</span>
                        <div class="text-center font-bold ${colorClass} text-sm">${content}</div>
                        <div class="text-[9px] text-gray-500 text-center truncate">${dayBooking.start || ''} - ${dayBooking.end || ''}</div>
                    </div>`;
            } else {
                if(!isWeekend) monthTarget += targetHours;
                grid.innerHTML += `
                    <div class="h-24 border border-[#233554] p-1 ${styleClass} hover:bg-[#1a2f55] transition">
                        <span class="text-xs text-gray-600 font-mono">${d}</span>
                    </div>`;
            }
        }

        // Stats updaten
        document.getElementById('cal-stat-target').textContent = decToTime(monthTarget);
        document.getElementById('cal-stat-actual').textContent = decToTime(monthActual);
        const balance = monthActual - monthTarget;
        const balEl = document.getElementById('cal-stat-balance');
        balEl.textContent = (balance > 0 ? '+' : '') + decToTime(balance);
        balEl.className = `text-xl font-mono font-bold ${balance >= 0 ? 'text-green-500' : 'text-red-500'}`;
    }

    // --- 7. ZEITKONTO ---
    async function loadTimeAccount() {
        const isAdmin = currentUser.role === 'admin';
        const filterEl = document.getElementById('account-user-select');
        const filterArea = document.getElementById('account-filter-area');
        
        let targetId = currentUser.id;

        if (isAdmin) {
            filterArea.classList.remove('hidden');
            filterArea.classList.add('flex');
            // Wenn ausgewählt, nimm den, sonst Admin selbst
            if(filterEl.value) targetId = parseInt(filterEl.value);
            
            // Event Listener für Change (nur einmal hinzufügen wäre besser, aber hier pragmatisch)
            filterEl.onchange = loadTimeAccount;
        }

        // Hier vereinfacht: Wir berechnen das Konto basierend auf den geladenen Buchungen
        // In einer echten App würde das Backend '/account-summary' liefern.
        // Wir filtern die Buchungen für den Ziel-User
        const myBookings = bookingsList.filter(b => b.userId === targetId);
        
        // Urlaubstage holen (aus User Liste)
        const targetUser = usersList.find(u => u.id === targetId) || currentUser;
        const totalVacation = parseInt(targetUser.vacationDays || 30);
        
        // Urlaub genommen (vereinfacht: Anzahl Urlaubsbuchungen dieses Jahr)
        const currentYear = new Date().getFullYear();
        const vacTaken = myBookings.filter(b => b.type === 'Urlaub' && b.date.startsWith(currentYear)).length;
        
        // Gleitzeit (Summe aller Abweichungen)
        let balance = 0;
        const dailyTarget = Number(targetUser.dailyTarget) || 8.0;

        myBookings.forEach(b => {
            // Nur berechnen wenn Buchung abgeschlossen und kein Wochenende (vereinfacht)
            if(b.end && b.type !== 'Urlaub' && b.type !== 'Krank') {
                const dateObj = new Date(b.date);
                if(dateObj.getDay() !== 0 && dateObj.getDay() !== 6) {
                    const diff = timeToDec(b.end) - timeToDec(b.start);
                    const pause = calcPause(diff);
                    const net = Math.max(0, diff - pause);
                    balance += (net - dailyTarget);
                }
            }
        });

        document.getElementById('acc-vacation-total').textContent = totalVacation;
        document.getElementById('acc-vacation-left').textContent = totalVacation - vacTaken;
        
        const sickDays = myBookings.filter(b => b.type === 'Krank' && b.date.startsWith(currentYear)).length;
        document.getElementById('acc-sick').textContent = sickDays;

        const balText = (balance > 0 ? '+' : '') + decToTime(balance) + ' h';
        const balEl = document.getElementById('acc-balance');
        balEl.textContent = balText;
        balEl.className = `text-3xl font-mono font-bold ${balance >= 0 ? 'text-green-400' : 'text-red-400'}`;

        // Letzte Buchungen Liste
        const histContainer = document.getElementById('account-history-list');
        histContainer.innerHTML = '';
        // Neueste 10
        myBookings.sort((a,b) => new Date(b.date) - new Date(a.date)).slice(0, 10).forEach(b => {
            histContainer.innerHTML += `
                <div class="py-2 flex justify-between items-center text-xs">
                    <span class="text-gray-400 font-mono">${b.date}</span>
                    <span class="text-white font-bold">${b.type}</span>
                </div>
            `;
        });
    }

    // --- 8. HISTORIE (Optimiert) ---
    async function loadHistory() {
        const data = await apiFetch('/history');
        const body = document.getElementById('audit-log-body');
        body.innerHTML = '';
        
        if(!Array.isArray(data) || data.length === 0) {
            body.innerHTML = '<tr><td colspan="5" class="p-4 text-center italic">Keine Aktivitäten.</td></tr>';
            return;
        }

        data.forEach(row => {
            const tr = document.createElement('tr');
            tr.className = "hover:bg-[#1a2f55] transition border-b border-border last:border-0";
            const ts = new Date(row.timestamp).toLocaleString('de-DE');
            
            let actionDisplay = row.action;
            let valDisplay = row.newValue || row.oldValue || '-';
            let colorClass = 'text-gray-400';

            // Status-Mapping (Englisch -> Deutsch)
            if (actionDisplay.includes('approved')) actionDisplay = actionDisplay.replace('approved', 'Genehmigt');
            if (actionDisplay.includes('rejected')) actionDisplay = actionDisplay.replace('rejected', 'Abgelehnt');
            
            // Logik für Status-Anzeige im Detail-Text
            // Wenn im Aktionstext "Genehmigt" steht, färben wir es grün
            if (actionDisplay.includes('Genehmigt') || (typeof valDisplay === 'string' && valDisplay.includes('approved'))) {
                colorClass = 'text-green-400 font-bold';
                // Falls valDisplay nur "approved" war, machen wir es schön
                if(valDisplay === 'approved') valDisplay = '<i class="fas fa-check-circle mr-1"></i> Genehmigt';
            }
            
            if (actionDisplay.includes('Abgelehnt') || (typeof valDisplay === 'string' && valDisplay.includes('rejected'))) {
                colorClass = 'text-red-500 font-bold';
                if(valDisplay === 'rejected') valDisplay = '<i class="fas fa-times-circle mr-1"></i> Abgelehnt';
            }

            // Kommen/Gehen Icons
            if (valDisplay === 'Kommen') { valDisplay = '<i class="fas fa-sign-in-alt mr-1"></i> Kommen'; colorClass = 'text-green-400'; }
            if (valDisplay === 'Gehen') { valDisplay = '<i class="fas fa-sign-out-alt mr-1"></i> Gehen'; colorClass = 'text-orange-400'; }

            tr.innerHTML = `
                <td class="px-6 py-3 text-gray-500 text-xs font-mono">${ts}</td>
                <td class="px-6 py-3 text-white font-bold text-xs">${row.actor || '-'}</td>
                <td class="px-6 py-3 text-brand text-xs uppercase tracking-wide font-bold">${actionDisplay}</td>
                <td class="px-6 py-3 ${colorClass} text-xs" colspan="2">
                    ${valDisplay}
                </td>
            `;
            body.appendChild(tr);
        });
    }

    // --- EXPORT ---
    window.exportToCSV = function() {
        let csvContent = "data:text/csv;charset=utf-8,Datum,Mitarbeiter,Start,Ende,Typ,Bemerkung\n";
        bookingsList.forEach(b => {
            csvContent += `${b.date},${getUserName(b.userId)},${b.start},${b.end || ''},${b.type},${b.remarks || ''}\n`;
        });
        const encodedUri = encodeURI(csvContent);
        const link = document.createElement("a");
        link.setAttribute("href", encodedUri);
        link.setAttribute("download", "zes_export.csv");
        document.body.appendChild(link);
        link.click();
    };

    // --- 9. MOBILE MENU ---
    const mobMenuBtn = document.getElementById('mobile-menu-btn');
    const mobMenuOverlay = document.getElementById('mobile-menu-overlay');
    const mobCloseBtn = document.getElementById('close-mobile-menu');

    // Öffnen
    if (mobMenuBtn && mobMenuOverlay) {
        mobMenuBtn.addEventListener('click', () => {
            mobMenuOverlay.classList.remove('hidden');
        });
    }

    // Schließen (X-Button)
    if (mobCloseBtn && mobMenuOverlay) {
        mobCloseBtn.addEventListener('click', () => {
            mobMenuOverlay.classList.add('hidden');
        });
    }

    // Schließen bei Klick auf einen Link (Navigation)
    const mobLinks = document.querySelectorAll('#mobile-menu-overlay button[id^="mob-nav-"]');
    mobLinks.forEach(btn => {
        btn.addEventListener('click', () => {
            // Mapping für Mobile Buttons auf Section-Namen
            const target = btn.id.replace('mob-nav-', '');
            switchSection(target);
            mobMenuOverlay.classList.add('hidden');
        });
    });

    // Mobile Logout
    const mobLogout = document.getElementById('mob-logout');
    if (mobLogout) {
        mobLogout.addEventListener('click', logout);
    }

    // --- UI SCHALTER ---
    window.toggleEndDateInput = function() {
        const typeSelect = document.getElementById('req-type-select');
        const type = typeSelect ? typeSelect.value : '';
        
        const endContainer = document.getElementById('container-end-date');
        const timeContainer = document.getElementById('container-time-inputs');
        const startLabel = document.getElementById('label-date-start');
        
        // Sicherheitscheck, falls Elemente nicht gefunden werden
        if(!endContainer || !timeContainer || !startLabel) return;

        // LOGIK:
        // Urlaub/Krank -> Zeitraum (Von-Bis), KEINE Uhrzeit
        if (type === 'Urlaub' || type === 'Krank') {
            endContainer.classList.remove('hidden'); // Bis-Datum AN
            timeContainer.classList.add('hidden');   // Uhrzeit AUS
            startLabel.innerText = "Von";            // Label ändern
            
            // Pflichtfelder anpassen (HTML5 validation)
            document.querySelector('input[name="endDate"]').required = true;
            document.querySelector('input[name="newStart"]').required = false;
        } 
        // Korrektur/Sonstiges -> Datum + Uhrzeit
        else {
            endContainer.classList.add('hidden');    // Bis-Datum AUS
            timeContainer.classList.remove('hidden');// Uhrzeit AN
            startLabel.innerText = "Datum";          // Label zurücksetzen
            
            // Pflichtfelder anpassen
            document.querySelector('input[name="endDate"]').required = false;
            // Uhrzeit nicht zwingend required machen, falls man nur Bemerkung senden will,
            // aber meistens sinnvoll:
            // document.querySelector('input[name="newStart"]').required = true; 
        }
    };
});