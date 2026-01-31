import { apiFetch, apiFetchRaw } from '../core/api.js';
import { getCurrentUser } from '../core/auth.js';
import { formatTimeDecimal } from '../core/utils.js';

export async function loadMonthly() {
    console.log(">> loadMonthly gestartet");

    const mElem = document.getElementById('cal-filter-month');
    const yElem = document.getElementById('cal-filter-year');
    const uElem = document.getElementById('cal-filter-user');
    const grid = document.getElementById('calendar-grid');
    const currentUser = getCurrentUser();

    if (!mElem || !yElem) {
        console.error("Kalender Dropdowns nicht gefunden!");
        return;
    }

    if (currentUser.role === 'admin' && uElem) {
        if (uElem.parentElement.classList.contains('hidden')) {
            uElem.parentElement.classList.remove('hidden');
        }
        uElem.classList.remove('hidden');
    }

    const monthIndex = parseInt(mElem.value);
    const year = parseInt(yElem.value);
    const apiMonth = monthIndex + 1;

    let targetId = currentUser.id;

    if (currentUser.role === 'admin') {
        if (uElem && uElem.value) {
            targetId = parseInt(uElem.value);
        } else {
            if (grid) grid.innerHTML = '<div class="col-span-7 text-center py-10 text-gray-500">Bitte Mitarbeiter wählen</div>';
            document.getElementById('cal-stat-target').textContent = "-";
            document.getElementById('cal-stat-actual').textContent = "-";
            document.getElementById('cal-stat-balance').textContent = "-";
            return;
        }
    }

    try {
        const stats = await apiFetch(`/month-stats?month=${apiMonth}&year=${year}&targetUserId=${targetId}`);

        if (stats) {
            document.getElementById('cal-stat-target').textContent = formatTimeDecimal(stats.soll);
            document.getElementById('cal-stat-actual').textContent = formatTimeDecimal(stats.ist);

            const balEl = document.getElementById('cal-stat-balance');
            if (balEl) {
                balEl.textContent = formatTimeDecimal(stats.saldo);
                balEl.className = stats.saldo < 0
                    ? "text-xl font-mono font-bold text-red-500"
                    : "text-xl font-mono font-bold text-green-500";
            }
        }
    } catch (e) {
        console.error("Fehler beim Laden der Stats:", e);
    }

    if (!grid) return;
    grid.innerHTML = '';

    const days = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];
    days.forEach(d => grid.innerHTML += `<div class="text-center text-[10px] uppercase font-bold bg-[#0d1b33] py-2 text-textMuted">${d}</div>`);

    const firstDay = new Date(year, monthIndex, 1);
    let startDay = firstDay.getDay() - 1;
    if (startDay === -1) startDay = 6;

    for (let i = 0; i < startDay; i++) {
        grid.innerHTML += '<div class="h-24 bg-[#112240]/50 border border-[#233554]/50"></div>';
    }

    const daysInMonth = new Date(year, monthIndex + 1, 0).getDate();

    // Wir laden die Bookings für den Monat neu oder nutzen Cache?
    // Der Einfachheit halber: Wir holen sie neu, um sicherzugehen
    // Oder wir filtern aus einer globalen list. Besser: Neu holen oder apiFetch nutzen.
    // Original Code used `bookingsList`, aber das könnte veraltet sein.
    // Wir holen sie frisch.
    const freshBookings = await apiFetch(`/bookings?userId=${targetId}`);
    const userBookings = Array.isArray(freshBookings) ? freshBookings.filter(b => {
        const bDate = new Date(b.date);
        return bDate.getMonth() === monthIndex && bDate.getFullYear() === year;
    }) : [];

    for (let d = 1; d <= daysInMonth; d++) {
        const match = userBookings.find(b => parseInt(b.date.split('-')[2]) === d);

        let content = '';
        let borderClass = 'border-[#233554]';
        let bgClass = 'bg-[#112240] hover:bg-[#1a2f55]';

        if (match) {
            if (match.type === 'Urlaub') {
                bgClass = 'bg-blue-900/20 hover:bg-blue-900/30';
                borderClass = 'border-blue-800/50';
                content = `
                <div class="flex flex-col items-center justify-center h-full text-blue-400">
                    <i class="fas fa-umbrella-beach text-xl mb-1"></i>
                    <span class="text-[9px] uppercase font-bold tracking-wider">Urlaub</span>
                </div>
            `;
            } else if (match.type === 'Krank') {
                bgClass = 'bg-red-900/20 hover:bg-red-900/30';
                borderClass = 'border-red-800/50';
                content = `
                <div class="flex flex-col items-center justify-center h-full text-red-400">
                    <i class="fas fa-notes-medical text-xl mb-1"></i>
                    <span class="text-[9px] uppercase font-bold tracking-wider">Krank</span>
                </div>
            `;
            } else {
                const start = match.start ? match.start.substring(0, 5) : '--:--';
                const end = match.end ? match.end.substring(0, 5) : null;

                let times = `
                <div class="flex items-center gap-1 text-xs text-green-400 font-mono">
                    <i class="fas fa-sign-in-alt text-[9px] opacity-70"></i> ${start}
                </div>
            `;

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

        grid.innerHTML += `
        <div class="h-24 border ${borderClass} p-1 flex flex-col items-center ${bgClass} transition relative group">
            <span class="absolute top-1 left-2 text-xs text-gray-600 font-bold group-hover:text-gray-400">${d}</span>
            <div class="w-full h-full">
                ${content}
            </div>
        </div>`;
    }
}

// Export Funktion
export function downloadExcel() {
    const monthInput = document.getElementById('cal-filter-month');
    const yearInput = document.getElementById('cal-filter-year');
    const userInput = document.getElementById('cal-filter-user');

    const month = monthInput ? parseInt(monthInput.value) + 1 : new Date().getMonth() + 1;
    const year = yearInput ? yearInput.value : new Date().getFullYear();

    let url = `/export-excel?month=${month}&year=${year}`;

    if (userInput && userInput.value) {
        url += `&targetUserId=${userInput.value}`;
    }

    const btn = document.getElementById('excel-export-btn');
    const originalText = btn ? btn.innerHTML : '';

    if (btn) {
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
        btn.disabled = true;
    }

    apiFetchRaw(url)
        .then(blob => {
            const downloadUrl = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = downloadUrl;
            a.download = `Export_${year}_${month}.xlsx`;
            document.body.appendChild(a);
            a.click();
            a.remove();

            if (btn) {
                btn.innerHTML = originalText;
                btn.disabled = false;
            }
        })
        .catch(err => {
            console.error("Export Fehler:", err);
            alert("Fehler beim Exportieren.");
            if (btn) {
                btn.innerHTML = originalText;
                btn.disabled = false;
            }
        });
};
