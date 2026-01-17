document.addEventListener('DOMContentLoaded', () => {
    // --- ROBUSTER AUTO LOGOUT (30 Min) ---
    let idleTime = 0;

    // Timer zurücksetzen bei Aktivität
    const resetIdleTimer = () => {
        idleTime = 0;
    };

    // Events sicher registrieren (damit sie immer erkannt werden)
    const activityEvents = ['mousemove', 'mousedown', 'keypress', 'touchmove', 'scroll', 'click'];
    activityEvents.forEach(evt => {
        document.addEventListener(evt, resetIdleTimer, true);
    });

    // Timer prüfen (Jede Minute)
    setInterval(() => {
        idleTime++;

        // HIER: "30" ist die Zeit in Minuten. 
        if (idleTime >= 30) {
            // console.log("Auto-Logout wegen Inaktivität...");

            // Nur ausloggen, wenn noch jemand eingeloggt ist
            if (currentUser) {
                if (typeof logout === 'function') {
                    logout(); // Normale Logout Funktion nutzen
                } else {
                    // Notfall-Logout (falls Funktion nicht gefunden wird)
                    console.warn("Logout-Funktion fehlt, führe Hard-Reset durch");
                    sessionStorage.removeItem('zes_user');
                    window.location.hash = '';
                    window.location.reload();
                }
            }
        }
    }, 60000); // Prüft alle 60 Sekunden (1 Minute)

    let currentUser = null;
    let usersList = [];
    let bookingsList = [];
    let requestsList = [];

    // API URL
    const API_URL = '/api/v1';

    // --- SESSION WIEDERHERSTELLEN (Robuste Version) ---
    const storedUser = sessionStorage.getItem('zes_user');
    if (storedUser) {
        try {
            const parsed = JSON.parse(storedUser);
            if (parsed && parsed.token) {
                currentUser = parsed;
                // console.log("Session wiederhergestellt für:", currentUser.displayName);
            }
        } catch (e) {
            console.error("Session defekt (JSON Fehler), logge aus...", e);
            sessionStorage.removeItem('zes_user');
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

    // Wandelt Dezimalzahlen (8.5) in Zeitformat ("08:30") um
    // Funktioniert auch mit negativen Zahlen für den Saldo ("-01:15")
    function formatTimeDecimal(decimal) {
        if (!decimal && decimal !== 0) return "00:00";
        const isNegative = decimal < 0;
        const absDecimal = Math.abs(decimal);
        const hours = Math.floor(absDecimal);
        const minutes = Math.round((absDecimal - hours) * 60);
        const hStr = hours.toString().padStart(2, '0');
        const mStr = minutes.toString().padStart(2, '0');
        return (isNegative ? "-" : "") + `${hStr}:${mStr}`;
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
                // FIX: Nur ausloggen, wenn es KEIN Login-Versuch ist!
                if (res.status === 401 && endpoint !== '/login') {
                    console.warn("Token abgelaufen -> Logout");
                    logout();
                    return null;
                }

                // Bei Login-Fehlern (oder anderen) Fehlertext vom Backend holen
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

            // --- WICHTIG: NEUE ZEILE ---
            // Wir speichern den Token extra, damit der Excel-Export ihn findet!
            sessionStorage.setItem('token', data.token);
            // ---------------------------

            // Zwangspasswort Check
            if (currentUser.mustChangePassword) {
                alert("Willkommen! Dies ist Ihre erste Anmeldung.\nBitte ändern Sie Ihr Passwort.");
                document.getElementById('login-page').classList.add('hidden');
                document.getElementById('tracker-page').classList.remove('hidden');
                document.getElementById('password-modal').classList.remove('hidden');
                document.getElementById('close-pw-modal').style.display = 'none';
                return;
            }

            // Speichern im Browser
            sessionStorage.setItem('zes_user', JSON.stringify(currentUser));

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

        // --- 1. ADMIN BUTTONS IM HEADER ---
        const createUserBtn = document.getElementById('nav-create-user-btn');
        if (currentUser.role === 'admin') {
            createUserBtn.classList.remove('hidden');
            createUserBtn.onclick = () => document.getElementById('create-user-modal').classList.remove('hidden');
        }

        // --- 2. PASSWORT BUTTON LOGIK (Admin-Weiche) ---
        // Wir suchen den Button "nav-password-button"
        const changePwBtn = document.getElementById('nav-password-button');
        if (changePwBtn) {
            changePwBtn.onclick = (e) => {
                e.preventDefault();
                if (currentUser.role === 'admin') {
                    // ADMIN: Auswahl-Modal öffnen
                    document.getElementById('pw-choice-modal').classList.remove('hidden');
                } else {
                    // USER: Direkt Passwort ändern öffnen
                    document.getElementById('password-modal').classList.remove('hidden');
                    document.getElementById('old-password').value = '';
                    document.getElementById('new-password').value = '';
                }
            };
        }

        // --- 3. LISTENERS FÜR DAS AUSWAHL-MODAL ---
        const btnOwn = document.getElementById('btn-choice-own-pw');
        if (btnOwn) {
            btnOwn.onclick = () => {
                document.getElementById('pw-choice-modal').classList.add('hidden');
                document.getElementById('password-modal').classList.remove('hidden');
                document.getElementById('old-password').value = '';
                document.getElementById('new-password').value = '';
            };
        }

        const btnReset = document.getElementById('btn-choice-user-pw');
        if (btnReset) {
            btnReset.onclick = () => {
                document.getElementById('pw-choice-modal').classList.add('hidden');
                document.getElementById('admin-reset-pw-modal').classList.remove('hidden');

                const sel = document.getElementById('reset-pw-target-user');
                if (sel) {
                    sel.innerHTML = '<option value="" disabled selected>Bitte wählen...</option>';
                    usersList.forEach(u => {
                        if (u.id !== currentUser.id) {
                            sel.add(new Option(u.displayName, u.id));
                        }
                    });
                }
            };
        }

        // --- 4. NEU: LOGIK FÜR DAS ABSENDEN DES RESET-FORMULARS ---
        // Das muss HIER stehen, damit es 'apiFetch' kennt!
        const adminResetForm = document.getElementById('admin-reset-pw-form');
        // Wir entfernen alte Listener durch Klonen, um doppeltes Senden zu verhindern
        if (adminResetForm) {
            const newForm = adminResetForm.cloneNode(true);
            adminResetForm.parentNode.replaceChild(newForm, adminResetForm);

            newForm.addEventListener('submit', async (e) => {
                e.preventDefault();

                const targetId = document.getElementById('reset-pw-target-user').value;
                const newPw = document.getElementById('reset-pw-new').value;

                if (!targetId || !newPw) {
                    alert("Bitte User wählen und Passwort eingeben.");
                    return;
                }

                if (!confirm(`Passwort wirklich ändern?`)) return;

                try {
                    // Hier ist apiFetch jetzt bekannt!
                    const res = await apiFetch('/admin/reset-password', 'POST', {
                        targetUserId: targetId,
                        newPassword: newPw
                    });

                    if (res && res.status === 'success') {
                        alert(`✅ Erfolg: ${res.message}`);
                        document.getElementById('admin-reset-pw-modal').classList.add('hidden');
                        document.getElementById('reset-pw-new').value = "Start123!";
                        document.getElementById('reset-pw-target-user').value = "";
                    } else {
                        alert(`❌ Fehler: ${res ? res.message : 'Server antwortet nicht'}`);
                    }
                } catch (err) {
                    console.error(err);
                    alert("❌ Fehler: " + (err.message || "Verbindungsfehler"));
                }
            });
        }
        // -----------------------------------------------------------

        // UI Setup nach Rolle
        if (currentUser.role === 'admin') {
            document.getElementById('nav-dashboard-button').classList.add('hidden');
            document.getElementById('nav-live-button').classList.remove('hidden');
            document.getElementById('user-live-terminal').classList.add('hidden');
            document.getElementById('admin-live-dashboard').classList.remove('hidden');

            // Initial User laden für Dropdowns
            apiFetch('/users').then(data => {
                if (Array.isArray(data)) {
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
            window.location.hash = (currentUser.role === 'admin') ? 'live' : 'dashboard';
        } else {
            handleRouting();
        }

        // --- AUTOMATISCHE UPDATES (POLLING) ---

        // 1. Benachrichtigungen: Alle 30 Sekunden prüfen (das ist okay so)
        setInterval(checkNotifications, 30000);

        // 2. Live-Monitor: Alle 5 Sekunden aktualisieren (JETZT ECHTZEIT-FEELING)
        if (currentUser.role === 'admin') {
            // Einmal sofort laden, damit man nicht 5s warten muss
            if (typeof loadLiveMonitor === 'function' && window.location.hash.includes('live')) {
                loadLiveMonitor();
            }

            setInterval(() => {
                // Wir prüfen lockerer, ob wir im Live-Tab sind (z.B. "#live" oder "#live/detail")
                // Wenn der User woanders ist (z.B. "#dashboard"), sparen wir uns den Request.
                if (window.location.hash.includes('live')) {
                    // console.log(">> Auto-Reload Live Monitor"); // Debugging aktivieren falls nötig

                    if (typeof loadLiveMonitor === 'function') {
                        loadLiveMonitor();
                    } else if (typeof window.loadLiveMonitor === 'function') {
                        window.loadLiveMonitor();
                    }
                }
            }, 15000); // <--- HIER GEÄNDERT: 15000ms = 15 Sekunden (statt 30000)
        }
    }

    document.getElementById('logout-button').addEventListener('click', () => logout());

    function logout() {
        currentUser = null;
        sessionStorage.removeItem('zes_user'); // Session löschen
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
                // Reload erzwingen, um Dropdowns zu aktualisieren (jetzt sicher dank sessionStorage!)
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
        if (contentEl) contentEl.classList.remove('hidden');

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
        'dashboard': 'dashboard', 'overview': 'overview', 'live': 'live',
        'requests': 'requests', 'monthly': 'monthly', 'account': 'account', 'history': 'history'
    };

    // 3. Klick-Listener: Ändert NUR die URL (#hash)
    Object.keys(navMap).forEach(k => {
        const btn = document.getElementById(`nav-${k}-button`);
        if (btn) {
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
    window.switchSection = function (name) {
        window.location.hash = name;
    };

    Object.keys(navMap).forEach(k => {
        const btn = document.getElementById(`nav-${k}-button`);
        if (btn) btn.addEventListener('click', () => switchSection(navMap[k]));
    });

    async function refreshData(name) {
        if (!currentUser) return; // Nicht laden wenn ausgeloggt

        // Paralleles Laden für Performance
        const [bookings, requests] = await Promise.all([
            apiFetch('/bookings'),
            apiFetch('/requests')
        ]);

        if (Array.isArray(bookings)) bookingsList = bookings;
        if (Array.isArray(requests)) requestsList = requests;

        if (name === 'overview') loadOverview();
        if (name === 'live') loadLiveMonitor();
        if (name === 'requests') loadRequests();
        if (name === 'monthly') loadMonthly();
        if (name === 'history') loadHistory();
        if (name === 'account') loadTimeAccount();
        if (name === 'dashboard') loadDashboard();
    }

    // --- DROPDOWNS INITIALISIEREN ---
    function initAllDropdowns() {
        const selects = [
            'overview-user-select',  // Journal -> Braucht "Alle"
            'req-filter-user',       // Anträge Filter -> Braucht "Alle"
            'history-filter-user',   // Historie Filter -> Braucht "Alle"
            'request-target-user',   // Antrag stellen -> Braucht "Bitte wählen"
            'cal-filter-user',       // Kalender -> Nur Einzelwahl (kein "Alle")
            'account-user-select'    // Konto -> Nur Einzelwahl (kein "Alle")
        ];

        selects.forEach(id => {
            const el = document.getElementById(id);
            if (!el) return;

            // Aktuellen Wert merken, um ihn nach dem Neu-Befüllen wieder zu setzen
            const oldVal = el.value;

            // Logik: Wo darf "Alle" stehen und wo nicht?
            // Kalender (cal-), Konto (account-) und Antrag-Ziel (request-target-) sind Einzel-Ansichten
            if (['cal-filter-user', 'account-user-select', 'request-target-user'].includes(id)) {
                el.innerHTML = '<option value="" disabled selected>Bitte wählen...</option>';
            } else {
                // Journal, Historie und Antrags-Übersicht dürfen alle gleichzeitig zeigen
                el.innerHTML = '<option value="">Alle Mitarbeiter</option>';
            }

            // User Liste befüllen
            usersList.forEach(u => {
                el.add(new Option(u.displayName, u.id));
            });

            // Wert wiederherstellen (falls möglich)
            if (oldVal) el.value = oldVal;
        });

        // --- (Der Rest für Monat/Jahr bleibt unverändert) ---
        const monthSelect = document.getElementById('cal-filter-month');
        if (monthSelect && monthSelect.options.length === 0) {
            ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'].forEach((m, i) => {
                monthSelect.add(new Option(m, i));
            });
            monthSelect.value = new Date().getMonth();
        }

        const yearSelect = document.getElementById('cal-filter-year');
        if (yearSelect && yearSelect.options.length === 0) {
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
        if (!t) return 0;
        const [h, m] = t.split(':').map(Number);
        return h + m / 60;
    }

    function decToTime(d) {
        const h = Math.floor(Math.abs(d));
        const m = Math.round((Math.abs(d) - h) * 60);
        return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
    }

    // Pausen-Berechnung: 0.5h pro 6h Arbeitszeit (automatisch)
    // Beispiel: 6h = 0.5h Pause, 12h = 1h Pause, 6.5h = 0.5h Pause
    function calcPause(brutto) {
        return Math.floor(brutto / 6) * 0.5;
    }

    function getUserTarget(uid) {
        const u = usersList.find(x => x.id === uid);
        return u ? (Number(u.dailyTarget) || 8.0) : 8.0;
    }

    // --- 1. LIVE MONITOR ---
    window.manualStamp = async (action) => {
        const res = await apiFetch('/stamp-manual', 'POST', { action });
        if (res && res.status === 'success') { refreshData('live'); }
    };

    // WICHTIG: async hinzufügen, damit wir warten können bis Daten da sind
    window.loadLiveMonitor = async function () {
        const today = new Date().toLocaleDateString('en-CA');
        const container = document.getElementById('live-users-grid');

        try {
            // NEU: Wir holen uns exakt HIER die aktuellen Daten vom Server
            // &_t=${Date.now()} verhindert, dass der Browser alte Daten aus dem Cache nimmt
            const freshData = await apiFetch(`/bookings?date=${today}&_t=${Date.now()}`);

            // Falls API Fehler, brechen wir ab (oder nutzen leeres Array)
            const currentBookings = Array.isArray(freshData) ? freshData : [];

            // --- AB HIER DEIN ORIGINAL CODE (angepasst auf 'currentBookings') ---

            // Admin View
            if (currentUser.role === 'admin') {
                container.innerHTML = '';
                // HIER GEÄNDERT: bookingsList -> currentBookings
                const active = currentBookings.filter(b => b.date === today && b.start && !b.end);

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
                // HIER GEÄNDERT: bookingsList -> currentBookings
                const myLast = currentBookings.filter(b => b.userId === currentUser.id && b.date === today).pop();
                const statEl = document.getElementById('status-display');
                const lastStamp = document.getElementById('last-stamp-time');

                // Sicherheitscheck, falls Elemente nicht im DOM sind (verhindert Fehler im Admin Tab)
                if (statEl && lastStamp) {
                    if (myLast && !myLast.end) {
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
        } catch (e) {
            console.error("Fehler im Live-Monitor:", e);
        }
    }



    // 2. JOURNAL (Mit Saldo-Fix & Wochenend-Korrektur)
    async function loadOverview() {
        const isAdmin = currentUser.role === 'admin';
        const filterUser = document.getElementById('overview-user-select');
        const startInp = document.getElementById('filter-date-start');
        const endInp = document.getElementById('filter-date-end');

        if (isAdmin) document.getElementById('admin-filters-overview').classList.remove('hidden');
        document.getElementById('apply-filter-btn').onclick = loadOverview;

        let url = '/bookings?';
        if (startInp && endInp && startInp.value && endInp.value) {
            url += `from=${startInp.value}&to=${endInp.value}&`;
        }

        let data = await apiFetch(url);
        if (!Array.isArray(data)) data = [];

        if (isAdmin && filterUser.value) data = data.filter(b => b.userId == filterUser.value);
        else if (!isAdmin) data = data.filter(b => b.userId === currentUser.id);

        data.sort((a, b) => new Date(b.date) - new Date(a.date));

        const container = document.getElementById('overview-list-container');
        const header = document.getElementById('overview-header');
        container.innerHTML = '';

        const gridClass = isAdmin
            ? 'grid-cols-[0.5fr_1.5fr_1fr_0.7fr_0.7fr_0.6fr_0.6fr_0.6fr_0.6fr_0.6fr_2fr]'
            : 'grid-cols-[1fr_1fr_1fr_1fr_1fr_1fr_1fr_1fr_2fr]';

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

        if (data.length === 0) { container.innerHTML = '<div class="p-10 text-center text-gray-500 italic">Keine Einträge.</div>'; return; }

        data.forEach(b => {
            // --- ÄNDERUNG START: DYNAMISCHER ARBEITSTAG CHECK ---
            const dObj = new Date(b.date);
            const dayOfWeek = dObj.getDay(); // 0=So, 1=Mo, ... 6=Sa

            // Wir holen die erlaubten Tage aus dem User-Objekt (vom Login)
            // Falls leer, Fallback auf Mo-Fr [1,2,3,4,5]
            const allowedDays = currentUser.workingDays || [1, 2, 3, 4, 5];

            // Ist der aktuelle Tag KEIN Arbeitstag?
            const isFreeDay = !allowedDays.includes(dayOfWeek);

            // Soll ist 0 an freien Tagen, sonst Standard (z.B. 8.0)
            const standardTarget = getUserTarget(b.userId);
            const target = isFreeDay ? 0 : standardTarget;
            // --- ÄNDERUNG ENDE ---

            const isFullDay = (b.type === 'Urlaub' || b.type === 'Krank');

            const rawDiff = (!isFullDay && b.end && b.start) ? timeToDec(b.end) - timeToDec(b.start) : 0;
            const pause = (b.end && !isFullDay) ? calcPause(rawDiff) : 0;
            const net = Math.max(0, rawDiff - pause);

            // Saldo Berechnung:
            // Bei Urlaub/Krank ist Saldo 0.
            // Ansonsten: Netto - Soll. (An freien Tagen ist Soll 0, also zählt alles als Plus)
            const saldo = b.end ? (isFullDay ? 0 : (net - target)) : 0;

            // --- VORZEICHEN FIX START ---
            let saldoStr = '-';
            let saldoColor = 'text-gray-500';

            if (b.end) {
                const isNegative = saldo < -0.001;
                const isPositive = saldo > 0.001;

                let sign = '';
                if (isNegative) sign = '-';
                else if (isPositive) sign = '+';

                if (isNegative) saldoColor = 'text-red-500';
                else if (isPositive) saldoColor = 'text-green-500';

                saldoStr = sign + decToTime(Math.abs(saldo));
            }
            // --- VORZEICHEN FIX ENDE ---

            const div = document.createElement('div');
            div.className = `grid ${gridClass} gap-2 px-4 py-3 items-center hover:bg-[#1a2f55] transition border-b border-border text-sm text-gray-300 group`;

            let html = isAdmin ? `<div class="font-mono text-xs text-gray-500">${b.userId}</div><div class="font-bold text-white truncate text-xs">${getUserName(b.userId)}</div>` : ``;

            const displayStart = isFullDay ? '-' : b.start;
            const displayEnd = isFullDay ? '-' : (b.end || '--:--');
            const displayPause = isFullDay ? '-' : decToTime(pause);

            // ÄNDERUNG: Anzeige Soll richtet sich jetzt nach 'isFreeDay' statt 'isWeekend'
            const displayTarget = isFreeDay ? '-' : decToTime(target);

            const displayNet = isFullDay ? decToTime(target) : (b.end ? decToTime(net) : '...');

            let typeIcon = '';
            let typeText = b.type;

            if (b.type === 'Urlaub') { typeIcon = '<i class="fas fa-umbrella-beach text-purple-400"></i>'; }
            else if (b.type === 'Krank') { typeIcon = '<i class="fas fa-first-aid text-red-400"></i>'; }
            else if (b.type === 'Web-Terminal') { typeIcon = '<i class="fas fa-laptop text-blue-300"></i>'; typeText = 'Web Buchung'; }
            else if (b.type === 'valid') { typeIcon = '<i class="fas fa-id-card text-green-400"></i>'; typeText = 'Terminal Buchung'; }
            else if (b.type === 'Korrektur') { typeIcon = '<i class="fas fa-edit text-yellow-400"></i>'; }

            let displayText = b.remarks || typeText;

            html += `
            <div class="text-gray-400 font-mono text-xs">${b.date.split('-').reverse().join('.')}</div>
            <div class="text-center font-mono bg-[#0a192f] rounded py-0.5 text-xs">${displayStart}</div>
            <div class="text-center font-mono bg-[#0a192f] rounded py-0.5 text-xs">${displayEnd}</div>
            <div class="text-center text-gray-500 text-xs font-mono">${displayPause}</div>
            <div class="text-center text-gray-500 text-xs font-mono">${displayTarget}</div>
            <div class="text-center text-gray-500 text-xs font-mono">${b.end ? (isFullDay ? decToTime(target) : decToTime(rawDiff)) : '-'}</div>
            <div class="text-center font-bold text-brand font-mono text-sm">${displayNet}</div>
            
            ${isAdmin ? `<div class="text-center font-mono font-bold ${saldoColor}">${saldoStr}</div>` : ''}
            
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
        if (!confirm('Status wirklich ändern?')) return;
        const res = await apiFetch(`/requests/${id}`, 'PUT', { status });
        if (res && res.status === 'success') refreshData('requests');
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
        // FILTER LOGIK
        if (isAdmin) {
            const fUserId = document.getElementById('req-filter-user').value;
            const fStatus = document.getElementById('req-filter-status').value;

            // 1. User Filter ("" heißt Alle)
            if (fUserId) {
                data = data.filter(r => r.userId == fUserId);
            }

            // 2. Status Filter
            if (fStatus) {
                if (fStatus === 'done') {
                    data = data.filter(r => r.status === 'approved' || r.status === 'rejected');
                } else {
                    data = data.filter(r => r.status === fStatus);
                }
            }
        }

        data.sort((a, b) => b.id - a.id);
        listContainer.innerHTML = '';

        if (data.length === 0) { listContainer.innerHTML = '<p class="text-gray-500 italic p-4 text-center">Keine Anträge gefunden.</p>'; return; }

        data.forEach(req => {
            const item = document.createElement('div');
            item.className = "bg-[#0a192f] p-4 rounded border border-border mb-3 hover:border-brand/50 transition shadow-sm relative overflow-hidden";

            let statusBadge = '';
            if (req.status === 'pending') statusBadge = '<span class="text-yellow-500 bg-yellow-900/20 px-2 py-0.5 rounded text-[10px] font-bold border border-yellow-900/50">OFFEN</span>';
            else if (req.status === 'approved') statusBadge = '<span class="text-green-500 bg-green-900/20 px-2 py-0.5 rounded text-[10px] font-bold border border-green-900/50">GENEHMIGT</span>';
            else statusBadge = '<span class="text-red-500 bg-red-900/20 px-2 py-0.5 rounded text-[10px] font-bold border border-red-900/50">ABGELEHNT</span>';

            // --- LÖSCH BUTTON LOGIK ---
            // Admin: Immer sichtbar
            // User: Nur sichtbar, wenn Status 'pending'
            let showDelete = false;
            if (isAdmin) showDelete = true;
            else if (req.status === 'pending') showDelete = true;

            const deleteBtn = showDelete
                ? `<button onclick="window.deleteRequest(${req.id})" class="ml-2 text-gray-500 hover:text-red-500 transition" title="Antrag löschen/stornieren"><i class="fas fa-trash"></i></button>`
                : '';
            // --------------------------

            let buttons = (isAdmin && req.status === 'pending') ?
                `<div class="mt-3 flex gap-2 justify-end border-t border-border pt-2">
                <button onclick="window.handleRequest(${req.id}, 'approved')" class="text-xs bg-green-600 hover:bg-green-500 text-white px-3 py-1 rounded font-bold shadow">OK</button>
                <button onclick="window.handleRequest(${req.id}, 'rejected')" class="text-xs bg-red-600 hover:bg-red-500 text-white px-3 py-1 rounded font-bold shadow">ABLEHNEN</button>
             </div>` : '';

            item.innerHTML = `
            <div class="flex justify-between items-start mb-2">
                <div class="flex items-center gap-2"><div class="text-sm font-bold text-white font-brand">${getUserName(req.userId)}</div></div>
                <div class="flex items-center">
                    ${statusBadge}
                    ${deleteBtn}
                </div>
            </div>
            <div class="text-xs text-brand font-bold mb-1 uppercase tracking-wide">${req.type} <span class="text-gray-500 font-normal ml-2 font-mono">${req.date} ${req.endDate ? '-> ' + req.endDate : ''}</span></div>
            <div class="bg-[#112240] p-2 rounded text-xs text-gray-300 italic mb-1 border border-border/50">"${req.reason}"</div>
            ${buttons}
        `;
            listContainer.appendChild(item);
        });
    }

    window.deleteRequest = async function (id) {
        if (!confirm("Möchtest du diesen Antrag wirklich zurückziehen/löschen? \n(Genehmigte Tage werden aus dem Kalender entfernt)")) return;

        try {
            const res = await apiFetch(`/requests/${id}`, 'DELETE');

            if (res && res.status === 'success') {
                // HIER IST DER FIX: Erst Nachricht anzeigen, DANN neu laden
                alert(`✅ ${res.message}`);

                // Seite neu laden, um Kalender und Liste zu aktualisieren
                location.reload();
            } else {
                alert("❌ Fehler: " + (res.message || "Konnte nicht gelöscht werden."));
            }
        } catch (e) {
            console.error(e);
            alert("❌ Verbindungsfehler zum Server.");
        }
    };

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
        if (res && res.status === 'success') {
            alert('Antrag gesendet.');
            e.target.reset();
            refreshData('requests');
        }
    });

    // 4. BENACHRICHTIGUNGEN
    // 4. BENACHRICHTIGUNGEN (Status Farben & Deutsch)
    async function checkNotifications() {
        if (!currentUser) return;
        const data = await apiFetch('/notifications');
        if (!data) return;
        const badge = document.getElementById('notification-badge');
        const list = document.getElementById('notification-list');

        if (data.count > 0) {
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

            if (currentUser.role === 'admin') {
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
    if (pwForm) {
        pwForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const old = document.getElementById('pw-old').value;
            const n = document.getElementById('pw-new').value;
            const c = document.getElementById('pw-confirm').value;

            if (n !== c) { alert("Passwörter stimmen nicht überein"); return; }

            const res = await apiFetch('/password', 'PUT', { oldPassword: old, newPassword: n });
            if (res.status === 'success') {
                alert("Passwort geändert!");
                // Falls Zwang, jetzt aufheben im UI
                currentUser.mustChangePassword = false;
                sessionStorage.setItem('zes_user', JSON.stringify(currentUser));
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
        if (hoursEl) { hoursEl.textContent = decToTime(data.hoursWeek || 0); }

        // Warnungen (Alerts)
        const alertContainer = document.getElementById('dashboard-alerts-container');
        if (alertContainer) {
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
    // --- ERSETZE DIE GANZE loadMonthly FUNKTION HIERMIT ---

    window.loadMonthly = async function () {
        console.log(">> loadMonthly gestartet");

        // 1. Elemente holen
        const mElem = document.getElementById('cal-filter-month');
        const yElem = document.getElementById('cal-filter-year');
        const uElem = document.getElementById('cal-filter-user'); // Admin Dropdown
        const grid = document.getElementById('calendar-grid');

        if (!mElem || !yElem) {
            console.error("Kalender Dropdowns nicht gefunden!");
            return;
        }

        if (currentUser.role === 'admin' && uElem) {
            // Wir versuchen, den Container (das Eltern-Element) einzublenden
            // Meistens ist das Select in einem div mit class="hidden" verpackt.
            if (uElem.parentElement.classList.contains('hidden')) {
                uElem.parentElement.classList.remove('hidden');
            }
            // Sicherheitshalber auch das Element selbst (falls kein Container da ist)
            uElem.classList.remove('hidden');
        }

        // 2. Werte auslesen
        const monthIndex = parseInt(mElem.value); // 0 = Januar
        const year = parseInt(yElem.value);

        // WICHTIG: Backend erwartet Monat 1-12, JS hat 0-11
        const apiMonth = monthIndex + 1;

        // Welcher User?
        let targetId = currentUser.id;

        // Falls Admin: Prüfen ob User gewählt wurde
        if (currentUser.role === 'admin') {
            if (uElem && uElem.value) {
                targetId = parseInt(uElem.value);
            } else {
                // Kein User gewählt -> Leere Ansicht
                if (grid) grid.innerHTML = '<div class="col-span-7 text-center py-10 text-gray-500">Bitte Mitarbeiter wählen</div>';
                document.getElementById('cal-stat-target').textContent = "-";
                document.getElementById('cal-stat-actual').textContent = "-";
                document.getElementById('cal-stat-balance').textContent = "-";
                return;
            }
        }

        console.log(`>> Frage API ab: Month=${apiMonth}, Year=${year}, User=${targetId}`);

        // 3. STATS VOM BACKEND LADEN
        try {
            const stats = await apiFetch(`/month-stats?month=${apiMonth}&year=${year}&targetUserId=${targetId}`);
            console.log(">> Stats API Antwort:", stats);

            if (stats) {
                // Hilfsfunktion formatTimeDecimal muss existieren (siehe unten)
                document.getElementById('cal-stat-target').textContent = formatTimeDecimal(stats.soll);
                document.getElementById('cal-stat-actual').textContent = formatTimeDecimal(stats.ist);

                const balEl = document.getElementById('cal-stat-balance');
                if (balEl) {
                    balEl.textContent = formatTimeDecimal(stats.saldo);
                    // Farbe setzen
                    balEl.className = stats.saldo < 0
                        ? "text-xl font-mono font-bold text-red-500"
                        : "text-xl font-mono font-bold text-green-500";
                }
            }
        } catch (e) {
            console.error("Fehler beim Laden der Stats:", e);
        }

        // 4. KALENDER GRID RENDERN (Hier nutzen wir deine existierende Logik oder bauen sie simpel nach)
        if (!grid) return;
        grid.innerHTML = ''; // Reset

        // Wochentage Header
        const days = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];
        days.forEach(d => grid.innerHTML += `<div class="text-center text-[10px] uppercase font-bold bg-[#0d1b33] py-2 text-textMuted">${d}</div>`);

        // Leere Felder am Anfang
        const firstDay = new Date(year, monthIndex, 1);
        let startDay = firstDay.getDay() - 1; // Mo=0, So=6
        if (startDay === -1) startDay = 6; // Sonntag fixen

        for (let i = 0; i < startDay; i++) {
            grid.innerHTML += '<div class="h-24 bg-[#112240]/50 border border-[#233554]/50"></div>';
        }

        // Tage rendern
        const daysInMonth = new Date(year, monthIndex + 1, 0).getDate();

        // Buchungen filtern für den gewählten User & Monat
        // Wir nutzen die globale 'bookingsList', die beim Tab-Wechsel geladen wurde
        const userBookings = bookingsList.filter(b => {
            const bDate = new Date(b.date);
            return b.userId === targetId && bDate.getMonth() === monthIndex && bDate.getFullYear() === year;
        });

        for (let d = 1; d <= daysInMonth; d++) {
            // Datumssuche (Match)
            const match = userBookings.find(b => parseInt(b.date.split('-')[2]) === d);

            let content = '';
            let borderClass = 'border-[#233554]'; // Standard Rand
            let bgClass = 'bg-[#112240] hover:bg-[#1a2f55]'; // Standard Hintergrund

            if (match) {
                if (match.type === 'Urlaub') {
                    // DESIGN: Urlaub mit Icon
                    bgClass = 'bg-blue-900/20 hover:bg-blue-900/30';
                    borderClass = 'border-blue-800/50';
                    content = `
                    <div class="flex flex-col items-center justify-center h-full text-blue-400">
                        <i class="fas fa-umbrella-beach text-xl mb-1"></i>
                        <span class="text-[9px] uppercase font-bold tracking-wider">Urlaub</span>
                    </div>
                `;
                } else if (match.type === 'Krank') {
                    // DESIGN: Krank mit Icon
                    bgClass = 'bg-red-900/20 hover:bg-red-900/30';
                    borderClass = 'border-red-800/50';
                    content = `
                    <div class="flex flex-col items-center justify-center h-full text-red-400">
                        <i class="fas fa-notes-medical text-xl mb-1"></i>
                        <span class="text-[9px] uppercase font-bold tracking-wider">Krank</span>
                    </div>
                `;
                } else {
                    // DESIGN: Normale Arbeitszeit (Grün/Orange)
                    const start = match.start ? match.start.substring(0, 5) : '--:--';
                    const end = match.end ? match.end.substring(0, 5) : null;

                    // Startzeit
                    let times = `
                    <div class="flex items-center gap-1 text-xs text-green-400 font-mono">
                        <i class="fas fa-sign-in-alt text-[9px] opacity-70"></i> ${start}
                    </div>
                `;

                    // Endzeit (oder "Aktiv" Animation)
                    if (end) {
                        times += `
                        <div class="flex items-center gap-1 text-xs text-orange-400 font-mono mt-1">
                            <i class="fas fa-sign-out-alt text-[9px] opacity-70"></i> ${end}
                        </div>
                    `;
                    } else {
                        times += `
                        <div class="flex items-center gap-1 text-[10px] text-yellow-500 font-bold mt-1 animate-pulse">
                            <i class="fas fa-clock"></i> AKTIV
                        </div>
                    `;
                    }

                    content = `
                    <div class="flex flex-col justify-center items-center h-full pt-3">
                        ${times}
                    </div>
                `;
                }
            }

            // HTML zusammenbauen
            grid.innerHTML += `
            <div class="h-24 border ${borderClass} p-1 flex flex-col items-center ${bgClass} transition relative group">
                <span class="absolute top-1 left-2 text-xs text-gray-600 font-bold group-hover:text-gray-400">${d}</span>
                <div class="w-full h-full">
                    ${content}
                </div>
            </div>`;
        }



    };

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
            if (filterEl.value) targetId = parseInt(filterEl.value);

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
            if (b.end && b.type !== 'Urlaub' && b.type !== 'Krank') {
                const dateObj = new Date(b.date);
                if (dateObj.getDay() !== 0 && dateObj.getDay() !== 6) {
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
        myBookings.sort((a, b) => new Date(b.date) - new Date(a.date)).slice(0, 10).forEach(b => {
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
        const isAdmin = currentUser.role === 'admin';

        // Filter Elemente holen
        const filterUser = document.getElementById('history-filter-user');
        const startInp = document.getElementById('history-date-start');
        const endInp = document.getElementById('history-date-end');
        const filterContainer = document.getElementById('admin-history-filters');

        // Filter nur für Admin sichtbar machen (oder User darf nur Datum?)
        // Hier: Admin darf alles, User sieht keine User-Auswahl
        if (!isAdmin) {
            if (filterUser) filterUser.classList.add('hidden');
        } else {
            if (filterUser) filterUser.classList.remove('hidden');
        }

        // URL bauen
        let url = '/history?';
        if (startInp && startInp.value) url += `startDate=${startInp.value}&`;
        if (endInp && endInp.value) url += `endDate=${endInp.value}&`;
        if (isAdmin && filterUser && filterUser.value) url += `targetUserId=${filterUser.value}`;

        const data = await apiFetch(url);
        const body = document.getElementById('audit-log-body');
        body.innerHTML = '';

        if (!Array.isArray(data) || data.length === 0) {
            body.innerHTML = '<tr><td colspan="5" class="p-4 text-center italic">Keine Aktivitäten gefunden.</td></tr>';
            return;
        }

        data.forEach(row => {
            // ... (Render Logik bleibt exakt wie vorher )
            const tr = document.createElement('tr');
            tr.className = "hover:bg-[#1a2f55] transition border-b border-border last:border-0";
            const ts = new Date(row.timestamp).toLocaleString('de-DE');
            let actionDisplay = row.action;
            let valDisplay = row.newValue || row.oldValue || '-';
            let colorClass = 'text-gray-400';

            if (actionDisplay.includes('approved')) actionDisplay = 'Genehmigt';
            if (actionDisplay.includes('rejected')) actionDisplay = 'Abgelehnt';

            // Farben Logik
            if (actionDisplay.includes('Genehmigt') || (typeof valDisplay === 'string' && valDisplay.includes('approved'))) {
                colorClass = 'text-green-400 font-bold';
                if (valDisplay === 'approved') valDisplay = '<i class="fas fa-check-circle mr-1"></i> Genehmigt';
            }
            if (actionDisplay.includes('Abgelehnt') || (typeof valDisplay === 'string' && valDisplay.includes('rejected'))) {
                colorClass = 'text-red-500 font-bold';
                if (valDisplay === 'rejected') valDisplay = '<i class="fas fa-times-circle mr-1"></i> Abgelehnt';
            }
            if (valDisplay === 'Kommen') { valDisplay = '<i class="fas fa-sign-in-alt mr-1"></i> Kommen'; colorClass = 'text-green-400'; }
            if (valDisplay === 'Gehen') { valDisplay = '<i class="fas fa-sign-out-alt mr-1"></i> Gehen'; colorClass = 'text-orange-400'; }

            tr.innerHTML = `
            <td class="px-6 py-3 text-gray-500 text-xs font-mono">${ts}</td>
            <td class="px-6 py-3 text-white font-bold text-xs">${row.actor || '-'}</td>
            <td class="px-6 py-3 text-brand text-xs uppercase tracking-wide font-bold">${actionDisplay}</td>
            <td class="px-6 py-3 ${colorClass} text-xs" colspan="2">${valDisplay}</td>
        `;
            body.appendChild(tr);
        });
    }
    window.loadHistory = loadHistory;

    // --- EXPORT ---
    //  window.exportToCSV = function () {
    //    let csvContent = "data:text/csv;charset=utf-8,Datum,Mitarbeiter,Start,Ende,Typ,Bemerkung\n";
    //  bookingsList.forEach(b => {
    //  csvContent += `${b.date},${getUserName(b.userId)},${b.start},${b.end || ''},${b.type},${b.remarks || ''}\n`;
    //});
    //const encodedUri = encodeURI(csvContent);
    //const link = document.createElement("a");
    //link.setAttribute("href", encodedUri);
    //link.setAttribute("download", "zes_export.csv");
    //document.body.appendChild(link);
    //link.click();
    // };




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
    window.toggleEndDateInput = function () {
        const typeSelect = document.getElementById('req-type-select');
        const type = typeSelect ? typeSelect.value : '';

        const endContainer = document.getElementById('container-end-date');
        const timeContainer = document.getElementById('container-time-inputs');
        const startLabel = document.getElementById('label-date-start');

        // Sicherheitscheck, falls Elemente nicht gefunden werden
        if (!endContainer || !timeContainer || !startLabel) return;

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
// --- EVENT LISTENER FIX ---
// Das hier ganz ans Ende der Datei packen
document.addEventListener('DOMContentLoaded', () => {
    // Falls HTML onchange fehlt, setzen wir es hier manuell
    const ids = ['cal-filter-month', 'cal-filter-year', 'cal-filter-user'];
    ids.forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            el.addEventListener('change', () => {
                console.log(`Dropdown ${id} geändert -> Lade Monthly neu`);
                window.loadMonthly();
            });
        }
    });

    // Beim ersten Laden einmal ausführen (falls wir schon im Kalender Tab sind)
    if (window.location.hash === '#monthly') {
        setTimeout(window.loadMonthly, 500); // Kleiner Timeout zur Sicherheit
    }
});


// --- EXCEL EXPORT FUNKTIONEN ---

// 1. Die Funktion, die der Button ruft
window.downloadExcel = function () {
    // Versuchen, die Filter-Werte zu finden (IDs müssen stimmen!)
    // Falls deine Inputs anders heißen, bitte hier anpassen (z.B. 'month-select')
    const monthInput = document.getElementById('filter-month') || document.getElementById('month');
    const yearInput = document.getElementById('filter-year') || document.getElementById('year');
    const userInput = document.getElementById('filter-user'); // Optionaler User-Filter

    // Fallback: Aktuelles Datum, falls Inputs nicht gefunden werden
    const month = monthInput ? monthInput.value : new Date().getMonth() + 1;
    const year = yearInput ? yearInput.value : new Date().getFullYear();

    let url = `/export-excel?month=${month}&year=${year}`;

    // Falls ein User ausgewählt ist (für Admins)
    if (userInput && userInput.value) {
        url += `&targetUserId=${userInput.value}`;
    }

    console.log("Starte Export für:", url); // Debugging im F12 Menü

    const btn = document.getElementById('excel-export-btn');
    const originalText = btn ? btn.innerHTML : '';

    if (btn) {
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>'; // Lade-Icon
        btn.disabled = true;
    }

    // WICHTIG: Wir nutzen apiFetchRaw statt apiFetch!
    apiFetchRaw(url)
        .then(blob => {
            // Virtuellen Link erstellen um Download zu erzwingen
            const downloadUrl = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = downloadUrl;
            a.download = `Export_${year}_${month}.xlsx`;
            document.body.appendChild(a);
            a.click();
            a.remove();

            // Aufräumen
            if (btn) {
                btn.innerHTML = originalText;
                btn.disabled = false;
            }
        })
        .catch(err => {
            console.error("Export Fehler:", err);
            alert("Fehler beim Exportieren. Hast du 'npm install exceljs' gemacht?");
            if (btn) {
                btn.innerHTML = originalText;
                btn.disabled = false;
            }
        });
};

async function apiFetchRaw(url) {
    // 1. Wir suchen überall nach dem Token
    let token = sessionStorage.getItem('token');

    // Falls leer, versuche andere typische Namen (Falls du dich beim Login vertippt hast)
    if (!token) token = sessionStorage.getItem('authToken');
    if (!token) token = sessionStorage.getItem('jwt');

    // console.log(">>> TOKEN STATUS:", token ? "GEFUNDEN" : "NICHT GEFUNDEN");

    if (!token) {
        alert("FEHLER: Der Browser findet den Token nicht.\nBitte drücke F12 -> Konsole -> und tippe: sessionStorage.getItem('token')");
        throw new Error("No token found");
    }

    // WICHTIG: /api/v1 nutzen!
    const res = await fetch('/api/v1' + url, {
        headers: {
            'Authorization': 'Bearer ' + token
        }
    });

    if (!res.ok) {
        const text = await res.text();
        // Falls Token abgelaufen (401/403)
        if (res.status === 401 || res.status === 403) {
            alert("Sitzung abgelaufen. Bitte neu einloggen!");
            window.location.href = 'index.html'; // Logout erzwingen
        }
        throw new Error(text || "Server Error " + res.status);
    }

    return res.blob();
}