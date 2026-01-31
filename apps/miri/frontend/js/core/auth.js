// Global State
let currentUser = null;
let usersList = [];

// API URL (used in auth flows if needed, but mostly api.js handles it)
// We might need to import apiFetch here if login uses it? 
// Circular dependency risk: api.js needs auth.js (token), auth.js needs api.js (login request).
// Solution: Login logic stays here or we pass dependencies. 
// Ideally, api.js is low level. Auth logic (business) uses api.js.
// Token getter is what api.js needs.

export function getCurrentUser() {
    return currentUser;
}

export function getUsersList() {
    return usersList;
}

export function setUsersList(list) {
    usersList = list || [];
}

export function getToken() {
    return currentUser ? currentUser.token : sessionStorage.getItem('token');
}

export function logout() {
    currentUser = null;
    sessionStorage.removeItem('zes_user');
    sessionStorage.removeItem('token');
    location.reload();
}

export function getUserName(id) {
    // Falls id ein Objekt ist (fehlerhafter Aufruf), fixen
    if (typeof id === 'object') return "Unknown";
    const u = usersList.find(u => u.id === id);
    return u ? u.displayName : `ID ${id}`;
}

export function getUserTarget(uid) {
    const u = usersList.find(x => x.id === uid);
    return u ? (Number(u.dailyTarget) || 8.0) : 8.0;
}

export function initSession() {
    const storedUser = sessionStorage.getItem('zes_user');
    if (storedUser) {
        try {
            const parsed = JSON.parse(storedUser);
            if (parsed && parsed.token) {
                currentUser = parsed;
                // Important: Update standalone token storage for external libs if needed
                if (!sessionStorage.getItem('token')) {
                    sessionStorage.setItem('token', currentUser.token);
                }
                return true;
            }
        } catch (e) {
            console.error("Session corrupted:", e);
            sessionStorage.removeItem('zes_user');
        }
    }
    return false;
}

export function setCurrentUser(user) {
    currentUser = user;
    if (user.token) {
        sessionStorage.setItem('token', user.token);
    }
    sessionStorage.setItem('zes_user', JSON.stringify(user));
}
