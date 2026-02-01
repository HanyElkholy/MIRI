import { initSession, logout, getCurrentUser, setUsersList } from './core/auth.js';
import { apiFetch } from './core/api.js';
import { loadDashboard } from './modules/dashboard.js';
import { loadLiveMonitor, manualStamp } from './modules/live.js';
import { loadOverview } from './modules/journal.js';
import { loadRequests, initRequests, handleRequest, deleteRequest } from './modules/requests.js';
import { loadMonthly, downloadExcel } from './modules/calendar.js';
import { loadTimeAccount } from './modules/account.js';
import { loadHistory } from './modules/history.js';

// --- GLOBALS FOR HTML ACCESS ---
window.logout = logout;
window.manualStamp = manualStamp;
window.handleRequest = handleRequest;
window.deleteRequest = deleteRequest;
window.downloadExcel = downloadExcel;
window.loadMonthly = loadMonthly; // For dropdown onchanges
window.loadTimeAccount = loadTimeAccount; // For dropdown onchanges
window.loadRequests = loadRequests; // For filter button

// --- ROUTING ---
window.switchSection = function (sectionId) {
    // 1. Hide all sections
    document.querySelectorAll('.section-content').forEach(el => el.classList.add('hidden'));

    // 2. Remove active class from nav
    document.querySelectorAll('.nav-link').forEach(el => {
        el.classList.remove('text-brand', 'border-b-2', 'border-brand');
        el.classList.add('text-gray-400');
    });

    // 3. Show target section
    const target = document.getElementById(sectionId);
    if (target) {
        target.classList.remove('hidden');
        target.classList.add('animate-fade');
    }

    // 4. Highlight Nav
    const navBtn = document.getElementById(`nav-${sectionId}`);
    if (navBtn) {
        navBtn.classList.remove('text-gray-400');
        navBtn.classList.add('text-brand', 'border-b-2', 'border-brand');
    }

    // 5. Load Data
    switch (sectionId) {
        case 'dashboard': loadDashboard(); break;
        case 'live': loadLiveMonitor(); break;
        case 'journal': loadOverview(); break;
        case 'requests': loadRequests(); break;
        case 'calendar': loadMonthly(); break;
        case 'account': loadTimeAccount(); break;
        case 'history': loadHistory(); break;
    }
};

// --- INITIALIZATION ---
document.addEventListener('DOMContentLoaded', async () => {
    // 1. Session Check
    if (!initSession()) {
        showLogin();
        return;
    }

    // 2. Token Validation (optional strict check)
    // await validateToken(); 

    // 3. Load Users (Global Cache)
    try {
        const users = await apiFetch('/users');
        if (users) setUsersList(users);
    } catch (e) {
        console.error("Failed to load users list", e);
    }

    // 4. Show App
    showApp();
});

function showLogin() {
    document.getElementById('login-section').classList.remove('hidden');
    document.getElementById('app-layout').classList.add('hidden');
}

function showApp() {
    document.getElementById('login-section').classList.add('hidden');
    document.getElementById('app-layout').classList.remove('hidden');

    const user = getCurrentUser();
    document.getElementById('user-name-display').textContent = user.displayName;

    // Role based UI
    if (user.role === 'admin') {
        document.querySelectorAll('.admin-only').forEach(el => el.classList.remove('hidden'));
    }

    // Init Logic
    loadLiveMonitor(); // Always load live monitor for header stats
    initRequests(); // Setup request form listeners

    // Initial Section
    // If hash exists, use it? For now default to dashboard
    loadDashboard();
}

// --- LOGIN HANDLER ---
const loginForm = document.getElementById('login-form');
if (loginForm) {
    loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const username = document.getElementById('username').value;
        const password = document.getElementById('password').value;

        try {
            // Using the top-level apiFetch (which uses /api/v1 prefix)
            // But wait, the original code used raw fetch to /api/v1/login.
            // Let's use apiFetch for consistency, or keep raw if we want to avoid token headers (though apiFetch handles no token fine)

            // Raw fetch is safer here to control the body exactly as expected by backend
            const res = await fetch('/api/v1/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, password })
            });

            const data = await res.json();

            if (res.ok) {
                // Use the function imported at the top of the file
                // We need to make sure setCurrentUser is imported.
                // It is NOT currently imported in line 1.
                // We will add it to the import list in a separate edit if needed, or just use sessionStorage directly here as fallback.

                // Let's rely on the dynamic import for now to avoid changing line 1 which might be risky if I miss something
                // Actually, let's just do it manually here to be 100% safe and simple.
                sessionStorage.setItem('authToken', data.token);
                sessionStorage.setItem('user', JSON.stringify(data.user));

                location.reload();
            } else {
                alert('Anmeldung fehlgeschlagen: ' + (data.message || 'Unbekannter Fehler'));
            }
        } catch (err) {
            console.error(err);
            alert('Server Fehler: Bitte später erneut versuchen.');
        }
    });
}

// --- PASSWORD CHANGE ---
// (Simplified, checks ID existence)
const pwForm = document.getElementById('password-form');
if (pwForm) {
    pwForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        // ... (Logic extracted to a module or kept here if simple)
        // Keeping it simple here or move to auth.js?
        // Let's keep it here for now as it interacts with DOM modals
        const old = document.getElementById('pw-old').value;
        const n = document.getElementById('pw-new').value;
        const c = document.getElementById('pw-confirm').value;

        if (n !== c) { alert("Passwörter stimmen nicht überein"); return; }

        const res = await apiFetch('/password', 'PUT', { oldPassword: old, newPassword: n });
        if (res.status === 'success') {
            alert("Passwort geändert!");
            document.getElementById('password-modal').classList.add('hidden');
        } else {
            alert(res.message);
        }
    });
}
document.getElementById('nav-password-button').onclick = () => document.getElementById('password-modal').classList.remove('hidden');
document.getElementById('close-pw-modal').onclick = () => document.getElementById('password-modal').classList.add('hidden');

// --- MOBILE MENU ---
const mobMenuBtn = document.getElementById('mobile-menu-btn');
const mobMenuOverlay = document.getElementById('mobile-menu-overlay');
const mobCloseBtn = document.getElementById('close-mobile-menu');

if (mobMenuBtn) mobMenuBtn.addEventListener('click', () => mobMenuOverlay.classList.remove('hidden'));
if (mobCloseBtn) mobCloseBtn.addEventListener('click', () => mobMenuOverlay.classList.add('hidden'));

document.querySelectorAll('#mobile-menu-overlay button[id^="mob-nav-"]').forEach(btn => {
    btn.addEventListener('click', () => {
        const target = btn.id.replace('mob-nav-', '');
        window.switchSection(target);
        mobMenuOverlay.classList.add('hidden');
    });
});
document.getElementById('mob-logout').addEventListener('click', logout);
