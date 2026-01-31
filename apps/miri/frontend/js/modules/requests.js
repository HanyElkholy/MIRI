import { apiFetch } from '../core/api.js';
import { getCurrentUser, getUserName } from '../core/auth.js';

export async function handleRequest(id, status) {
    if (!confirm('Status wirklich ändern?')) return;
    const res = await apiFetch(`/requests/${id}`, 'PUT', { status });
    if (res && res.status === 'success') loadRequests();
}

export async function deleteRequest(id) {
    if (!confirm("Möchtest du diesen Antrag wirklich zurückziehen/löschen? \n(Genehmigte Tage werden aus dem Kalender entfernt)")) return;

    try {
        const res = await apiFetch(`/requests/${id}`, 'DELETE');

        if (res && res.status === 'success') {
            alert(`✅ ${res.message}`);
            // Reload simple refresh 
            loadRequests();
        } else {
            alert("❌ Fehler: " + (res.message || "Konnte nicht gelöscht werden."));
        }
    } catch (e) {
        console.error(e);
        alert("❌ Verbindungsfehler zum Server.");
    }
}

export async function loadRequests() {
    const currentUser = getCurrentUser();
    const isAdmin = currentUser.role === 'admin';
    const listContainer = document.getElementById('request-list-container');
    const reqForm = document.getElementById('request-form');

    // Make functions globally available for inline onclicks 
    // (A bit hacky but needed for innerHTML onclicks unless we switch to event delegation)
    window.handleRequest = handleRequest;
    window.deleteRequest = deleteRequest;

    if (isAdmin) {
        document.getElementById('admin-request-filter-area').classList.remove('hidden');
        document.getElementById('admin-request-filter-area').classList.add('flex');
        document.getElementById('request-target-user-container').classList.remove('hidden');
        document.getElementById('req-filter-btn').onclick = loadRequests;
    }

    // Requests List holen (da wir sie hier lokal brauchen, oder wir rufen API neu)
    const requestsList = await apiFetch('/requests');
    let data = Array.isArray(requestsList) ? requestsList : [];

    // FILTER LOGIK
    if (isAdmin) {
        const fUserId = document.getElementById('req-filter-user').value;
        const fStatus = document.getElementById('req-filter-status').value;

        if (fUserId) {
            data = data.filter(r => r.userId == fUserId);
        }

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

        let showDelete = false;
        if (isAdmin) showDelete = true;
        else if (req.status === 'pending') showDelete = true;

        const deleteBtn = showDelete
            ? `<button onclick="window.deleteRequest(${req.id})" class="ml-2 text-gray-500 hover:text-red-500 transition" title="Antrag löschen/stornieren"><i class="fas fa-trash"></i></button>`
            : '';

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

    // Form Listener (prevent duplicate listeners by simple re-creation or just check)
    // Actually safer to let app.js handle form submit or put it in initRequests()
}

export function initRequests() {
    const listContainer = document.getElementById('request-list-container');
    const reqForm = document.getElementById('request-form');

    // UI Helpers exposed for HTML onchange
    window.toggleEndDateInput = function () {
        const typeSelect = document.getElementById('req-type-select');
        const type = typeSelect ? typeSelect.value : '';

        const endContainer = document.getElementById('container-end-date');
        const timeContainer = document.getElementById('container-time-inputs');
        const startLabel = document.getElementById('label-date-start');

        if (!endContainer || !timeContainer || !startLabel) return;

        if (type === 'Urlaub' || type === 'Krank') {
            endContainer.classList.remove('hidden');
            timeContainer.classList.add('hidden');
            startLabel.innerText = "Von";
            document.querySelector('input[name="endDate"]').required = true;
            document.querySelector('input[name="newStart"]').required = false;
        }
        else {
            endContainer.classList.add('hidden');
            timeContainer.classList.remove('hidden');
            startLabel.innerText = "Datum";
            document.querySelector('input[name="endDate"]').required = false;
        }
    };

    if (reqForm) {
        // Cloning to remove old listeners
        const newForm = reqForm.cloneNode(true);
        reqForm.parentNode.replaceChild(newForm, reqForm);

        newForm.addEventListener('submit', async (e) => {
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
                loadRequests();
            }
        });
    }
}
