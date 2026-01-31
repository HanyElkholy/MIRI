import { apiFetch } from '../core/api.js';
import { decToTime } from '../core/utils.js';
import { getCurrentUser } from '../core/auth.js';

export async function loadDashboard() {
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
