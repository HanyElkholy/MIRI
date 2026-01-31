import { apiFetch } from '../core/api.js';
import { getCurrentUser, getUserName, getUserTarget } from '../core/auth.js';
import { timeToDec, decToTime, calcPause } from '../core/utils.js';

export async function loadOverview() {
    const currentUser = getCurrentUser();
    const isAdmin = currentUser.role === 'admin';
    const filterUser = document.getElementById('overview-user-select');
    const startInp = document.getElementById('filter-date-start');
    const endInp = document.getElementById('filter-date-end');

    if (isAdmin) document.getElementById('admin-filters-overview').classList.remove('hidden');

    // Wir setzen den onclick nicht hier, das macht app.js zentral oder wir machen es idempotent
    // document.getElementById('apply-filter-btn').onclick = loadOverview;

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
        const dObj = new Date(b.date);
        const dayOfWeek = dObj.getDay();

        const allowedDays = currentUser.workingDays || [1, 2, 3, 4, 5];
        const isFreeDay = !allowedDays.includes(dayOfWeek);
        const standardTarget = getUserTarget(b.userId);
        const target = isFreeDay ? 0 : standardTarget;

        const isFullDay = (b.type === 'Urlaub' || b.type === 'Krank');
        const rawDiff = (!isFullDay && b.end && b.start) ? timeToDec(b.end) - timeToDec(b.start) : 0;
        const pause = (b.end && !isFullDay) ? calcPause(rawDiff) : 0;
        const net = Math.max(0, rawDiff - pause);
        const saldo = b.end ? (isFullDay ? 0 : (net - target)) : 0;

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

        const div = document.createElement('div');
        div.className = `grid ${gridClass} gap-2 px-4 py-3 items-center hover:bg-[#1a2f55] transition border-b border-border text-sm text-gray-300 group`;

        if (isAdmin) {
            const idDiv = document.createElement('div');
            idDiv.className = "font-mono text-xs text-gray-500";
            idDiv.textContent = b.userId;
            div.appendChild(idDiv);

            const nameDiv = document.createElement('div');
            nameDiv.className = "font-bold text-white truncate text-xs";
            nameDiv.textContent = getUserName(b.userId);
            div.appendChild(nameDiv);
        }

        let html = '';
        const displayStart = isFullDay ? '-' : b.start;
        const displayEnd = isFullDay ? '-' : (b.end || '--:--');
        const displayPause = isFullDay ? '-' : decToTime(pause);
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
        
        <div class="text-gray-400 text-xs flex items-center gap-2 truncate" title="${displayText.replace(/"/g, '&quot;')}">
            <span class="shrink-0 w-4 text-center">${typeIcon}</span>
            <span class="truncate">${displayText.replace(/</g, '&lt;')}</span> 
        </div>
    `;
        div.innerHTML = html;
        container.appendChild(div);
    });
}
