import { getToken, logout } from './auth.js';

const API_URL = '/api/v1';

export async function apiFetch(endpoint, method = 'GET', body = null, isFormData = false) {
    const headers = {};
    const token = getToken();

    if (token) headers['Authorization'] = `Bearer ${token}`;
    if (!isFormData) headers['Content-Type'] = 'application/json';

    const config = { method, headers };
    if (body) config.body = isFormData ? body : JSON.stringify(body);

    try {
        const res = await fetch(`${API_URL}${endpoint}`, config);
        if (!res.ok) {
            if (res.status === 401 && endpoint !== '/login') {
                console.warn("Token expired -> Logout");
                logout();
                return null;
            }

            const errData = await res.json().catch(() => ({}));
            throw new Error(errData.message || `API Error ${res.status}`);
        }
        return await res.json();
    } catch (err) {
        console.error("API Fetch Error:", err);
        return { status: "error", message: err.message };
    }
}

export async function apiFetchRaw(url) {
    let token = getToken();

    // Fallback search
    if (!token) token = sessionStorage.getItem('authToken');
    if (!token) token = sessionStorage.getItem('jwt');

    if (!token) {
        alert("FEHLER: Kein Token gefunden.");
        throw new Error("No token found");
    }

    const res = await fetch('/api/v1' + url, {
        headers: {
            'Authorization': 'Bearer ' + token
        }
    });

    if (!res.ok) {
        const text = await res.text();
        if (res.status === 401 || res.status === 403) {
            alert("Sitzung abgelaufen.");
            logout();
        }
        throw new Error(text || "Server Error " + res.status);
    }

    return res.blob();
}
