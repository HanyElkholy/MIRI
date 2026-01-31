import { apiFetch } from '../core/api.js';
import { getCurrentUser, getUsersList } from '../core/auth.js';
import { timeToDec, decToTime, calcPause } from '../core/utils.js';

export async function loadTimeAccount() {
    const currentUser = getCurrentUser();
    const isAdmin = currentUser.role === 'admin';
    const filterEl = document.getElementById('account-user-select');
    const filterArea = document.getElementById('account-filter-area');

    let targetId = currentUser.id;

    if (isAdmin) {
        filterArea.classList.remove('hidden');
        filterArea.classList.add('flex');
        if (filterEl.value) targetId = parseInt(filterEl.value);
        filterEl.onchange = loadTimeAccount;
    }

    // Wir laden die Buchungen für den User
    const bookings = await apiFetch(`/bookings?userId=${targetId}`);
    const myBookings = Array.isArray(bookings) ? bookings : [];

    const usersList = getUsersList();
    const targetUser = usersList.find(u => u.id === targetId) || currentUser;
    const totalVacation = parseInt(targetUser.vacationDays || 30);

    const currentYear = new Date().getFullYear();
    const vacTaken = myBookings.filter(b => b.type === 'Urlaub' && b.date.startsWith(currentYear)).length;

    let balance = 0;
    const dailyTarget = Number(targetUser.dailyTarget) || 8.0;

    myBookings.forEach(b => {
        if (b.end && b.type !== 'Urlaub' && b.type !== 'Krank') {
            const dateObj = new Date(b.date);
            const day = dateObj.getDay();

            // Check based on allowedDays if possible, for now hardcoded weekend check
            // Wir nutzen die globalen workingDays wenn vorhanden oder Standard
            const allowedDays = targetUser.workingDays || [1, 2, 3, 4, 5];

            if (allowedDays.includes(day)) {
                const diff = timeToDec(b.end) - timeToDec(b.start);
                const pause = calcPause(diff);
                const net = Math.max(0, diff - pause);
                balance += (net - dailyTarget);
            } else {
                // Arbeit an freien Tagen ist komplett Plus
                const diff = timeToDec(b.end) - timeToDec(b.start);
                const pause = calcPause(diff);
                const net = Math.max(0, diff - pause);
                balance += net;
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

    const histContainer = document.getElementById('account-history-list');
    histContainer.innerHTML = '';
    myBookings.sort((a, b) => new Date(b.date) - new Date(a.date)).slice(0, 10).forEach(b => {
        histContainer.innerHTML += `
            <div class="py-2 flex justify-between items-center text-xs">
                <span class="text-gray-400 font-mono">${b.date}</span>
                <span class="text-white font-bold">${b.type}</span>
            </div>
        `;
    });
}
