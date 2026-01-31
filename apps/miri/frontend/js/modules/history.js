import { apiFetch } from '../core/api.js';
import { getCurrentUser } from '../core/auth.js';

export async function loadHistory() {
    const currentUser = getCurrentUser();
    const isAdmin = currentUser.role === 'admin';

    const filterUser = document.getElementById('history-filter-user');
    const startInp = document.getElementById('history-date-start');
    const endInp = document.getElementById('history-date-end');

    if (!isAdmin) {
        if (filterUser) filterUser.classList.add('hidden');
    } else {
        if (filterUser) filterUser.classList.remove('hidden');
    }

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
        const tr = document.createElement('tr');
        tr.className = "hover:bg-[#1a2f55] transition border-b border-border last:border-0";
        const ts = new Date(row.timestamp).toLocaleString('de-DE');
        let actionDisplay = row.action;
        let valDisplay = row.newValue || row.oldValue || '-';
        let colorClass = 'text-gray-400';

        if (actionDisplay.includes('approved')) actionDisplay = 'Genehmigt';
        if (actionDisplay.includes('rejected')) actionDisplay = 'Abgelehnt';

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
