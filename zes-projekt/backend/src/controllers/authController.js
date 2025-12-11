const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const db = require('../config/db');

// 1. Login Funktion
exports.login = async (req, res) => {
    const { username, password } = req.body;

    try {
        // User suchen
        const result = await db.query('SELECT * FROM users WHERE username = $1', [username]);
        
        if (result.rows.length === 0) {
            return res.status(401).json({ message: 'Benutzer nicht gefunden' });
        }

        const user = result.rows[0];

        // Passwort prüfen
        const match = await bcrypt.compare(password, user.password);
        if (!match) {
            return res.status(401).json({ message: 'Passwort falsch' });
        }

        // Token generieren
        const token = jwt.sign(
            { id: user.id, role: user.role, customerId: user.customer_id, displayName: user.display_name },
            process.env.JWT_SECRET,
            { expiresIn: '8h' }
        );

        res.json({
            status: 'success',
            token,
            user: {
                id: user.id,
                displayName: user.display_name,
                role: user.role,
                clientName: "McKensy",
                mustChangePassword: user.is_initial_password
            }
        });

    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Serverfehler' });
    }
};

// 2. Passwort ändern Funktion 
exports.changePassword = async (req, res) => {
    const { oldPassword, newPassword } = req.body;
    const userId = req.user.id;

    try {
        const result = await db.query('SELECT password FROM users WHERE id = $1', [userId]);
        if (result.rows.length === 0) return res.status(404).json({ message: "User nicht gefunden" });

        const currentHash = result.rows[0].password;
        const match = await bcrypt.compare(oldPassword, currentHash);
        
        if (!match) return res.json({ status: "error", message: "Altes Passwort falsch" });

        const newHash = await bcrypt.hash(newPassword, 10);
        await db.query('UPDATE users SET password = $1, is_initial_password = FALSE WHERE id = $2', [newHash, userId]);
        
        res.json({ status: "success", message: "Passwort geändert" });
    } catch (e) { console.error(e); res.status(500).json({ error: "Serverfehler" }); }
};