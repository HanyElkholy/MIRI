const jwt = require('jsonwebtoken');

module.exports = function(req, res, next) {
    // 1. Header holen
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
        return res.status(401).json({ message: "Kein Token vorhanden" });
    }

    // 2. Token prüfen
    const secret = process.env.JWT_SECRET;
    
    if (!secret) {
        return res.status(500).json({ message: "Server-Konfigurationsfehler" });
    }
    
    jwt.verify(token, secret, (err, user) => {
        if (err) {
            // Token ungültig oder abgelaufen
            return res.status(403).json({ message: "Token ungültig oder abgelaufen" });
        }
        
        req.user = user;
        next();
    });
};