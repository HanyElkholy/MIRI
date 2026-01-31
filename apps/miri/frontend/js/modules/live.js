import { apiFetch } from '../core/api.js';
import { getCurrentUser, getUserName } from '../core/auth.js';

export async function manualStamp(action) {
    const res = await apiFetch('/stamp-manual', 'POST', { action });
    if (res && res.status === 'success') { loadLiveMonitor(); }
}

export async function loadLiveMonitor() {
    const currentUser = getCurrentUser();
    const today = new Date().toLocaleDateString('en-CA');
    const container = document.getElementById('live-users-grid');

    try {
        // NEU: Wir holen uns exakt HIER die aktuellen Daten vom Server
        const freshData = await apiFetch(`/bookings?date=${today}&_t=${Date.now()}`);

        // Falls API Fehler, brechen wir ab (oder nutzen leeres Array)
        const currentBookings = Array.isArray(freshData) ? freshData : [];

        // Admin View
        if (currentUser.role === 'admin') {
            container.innerHTML = '';
            const active = currentBookings.filter(b => b.date === today && b.start && !b.end);

            if (active.length === 0) {
                container.innerHTML = '<div class="col-span-full text-center text-gray-500 italic p-10">Keine Mitarbeiter aktiv.</div>';
                return;
            }
            active.forEach(b => {
                const div = document.createElement('div');
                div.className = "bg-[#112240] border-l-4 border-green-500 p-4 rounded shadow-lg flex items-center justify-between animate-fade";

                const leftDiv = document.createElement('div');
                const nameDiv = document.createElement('div');
                nameDiv.className = "font-bold text-white text-lg font-brand";
                nameDiv.textContent = getUserName(b.userId); // SAFE

                const timeDiv = document.createElement('div');
                timeDiv.className = "text-green-400 font-mono text-sm mt-1";
                timeDiv.innerHTML = `<i class="fas fa-clock mr-1"></i> Seit ${b.start} Uhr`;

                leftDiv.appendChild(nameDiv);
                leftDiv.appendChild(timeDiv);

                const rightDiv = document.createElement('div');
                rightDiv.className = "relative";
                rightDiv.innerHTML = '<div class="h-3 w-3 bg-green-500 rounded-full animate-ping"></div>';

                div.appendChild(leftDiv);
                div.appendChild(rightDiv);
                container.appendChild(div);
            });
        }
        // User View
        else {
            const myLast = currentBookings.filter(b => b.userId === currentUser.id && b.date === today).pop();
            const statEl = document.getElementById('status-display');
            const lastStamp = document.getElementById('last-stamp-time');

            // Sicherheitscheck, falls Elemente nicht im DOM sind
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
