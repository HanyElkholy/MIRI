const jwt = require('jsonwebtoken');

module.exports = (req, res, next) => {
    // 1. Token aus Header holen ("Bearer <token>")
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) return res.status(401).json({ message: "Kein Token" });

    // 2. Prüfen
    jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
        if (err) return res.status(403).json({ message: "Token ungültig" });
        
        // 3. User-Daten an Request anhängen
        req.user = user;
        next();
    });
};