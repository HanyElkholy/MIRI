// Zentrale Error-Handling-Middleware
const errorHandler = (err, req, res, next) => {
    // Log den Fehler für Debugging (nur in Development)
    if (process.env.NODE_ENV !== 'production') {
        console.error('Error:', err);
    }

    // Standard Error Response
    let statusCode = err.statusCode || 500;
    let message = err.message || 'Interner Serverfehler';

    // Datenbank-Fehler behandeln
    if (err.code === '23505') {
        statusCode = 400;
        message = 'Eintrag existiert bereits (Duplikat)';
    } else if (err.code === '23503') {
        statusCode = 400;
        message = 'Referenzfehler: Verknüpfter Eintrag existiert nicht';
    } else if (err.code === '23502') {
        statusCode = 400;
        message = 'Pflichtfeld fehlt';
    }

    // Validation Errors
    if (err.name === 'ValidationError') {
        statusCode = 400;
        message = 'Validierungsfehler: ' + err.message;
    }

    // JWT Errors
    if (err.name === 'JsonWebTokenError') {
        statusCode = 401;
        message = 'Ungültiges Token';
    } else if (err.name === 'TokenExpiredError') {
        statusCode = 401;
        message = 'Token abgelaufen';
    }

    // Response senden
    // Response senden: Stack nur im Development Mode mitschicken!
    const response = {
        status: 'error',
        message: message
    };

    if (process.env.NODE_ENV !== 'production') {
        response.stack = err.stack;
    }

    res.status(statusCode).json(response);
};

module.exports = errorHandler;