// Rate-Limiting-Middleware für API-Schutz
// Für Produktion: Verwendet express-rate-limit falls installiert, sonst einfache Fallback-Logik

let rateLimitMiddleware;

try {
    // Versuche express-rate-limit zu laden
    const rateLimit = require('express-rate-limit');

    // Allgemeines Rate-Limit für alle API-Routen
    const generalLimiter = rateLimit({
        windowMs: 15 * 60 * 1000, // 15 Minuten
        max: 200, // 200 Requests pro 15min pro IP
        message: { status: "error", message: 'Zu viele Anfragen von dieser IP, bitte versuche es später erneut.' },
        standardHeaders: true,
        legacyHeaders: false,
    });

    // Strengeres Rate-Limit für Login-Endpunkt
    const loginLimiter = rateLimit({
        windowMs: 15 * 60 * 1000, // 15 Minuten
        max: 10, // 10 Versuche pro 15min
        message: { status: "error", message: 'Zu viele Login-Versuche, bitte warten Sie 15 Minuten.' },
        standardHeaders: true,
        legacyHeaders: false,
        skipSuccessfulRequests: true, // Erfolgreiche Logins zählen nicht
    });

    rateLimitMiddleware = {
        general: generalLimiter,
        login: loginLimiter
    };
} catch (err) {
    // Fallback: Einfache Middleware ohne express-rate-limit
    console.warn('express-rate-limit nicht gefunden. Rate-Limiting ist deaktiviert.');
    console.warn('Installiere es mit: npm install express-rate-limit');

    rateLimitMiddleware = {
        general: (req, res, next) => next(),
        login: (req, res, next) => next()
    };
}

module.exports = rateLimitMiddleware;
