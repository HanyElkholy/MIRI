const db = require('../config/db');

const bcrypt = require('bcrypt');

const { logAudit } = require('../utils/logger'); // <--- WICHTIG: Logger importieren



// User Liste laden

exports.getUsers = async (req, res) => {
    const customerId = req.user.customerId;
    try {
        const result = await db.query(
            `SELECT id, username, display_name as "displayName", role, card_id as "cardId", is_active as "isActive", 
                    daily_target as "dailyTarget", vacation_days as "vacationDays"
             FROM users 
             WHERE customer_id = $1 
             ORDER BY is_active DESC, display_name ASC`,
            [customerId]
        );
        res.json(result.rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "DB Error" });
    }
};

exports.createUser = async (req, res) => {
    if (req.user.role !== 'admin') return res.status(403).json({ message: "Nicht erlaubt" });

    const { username, displayName, cardId, vacationDays, dailyTarget } = req.body;
    const customerId = req.user.customerId;

    try {
        const initialPwHash = await bcrypt.hash("Start123!", 10);

        await db.query(
            `INSERT INTO users (username, password, display_name, role, card_id, vacation_days, daily_target, is_initial_password, customer_id, is_active)
             VALUES ($1, $2, $3, 'user', $4, $5, $6, TRUE, $7, TRUE)`,
            [username, initialPwHash, displayName, cardId, vacationDays || 30, dailyTarget || 8.0, customerId]
        );

        await logAudit(customerId, req.user.displayName, 'Mitarbeiter angelegt', '', username, displayName);
        res.json({ status: "success", message: "Mitarbeiter angelegt." });

    } catch (err) {
        console.error(err);
        if (err.code === '23505') {
            return res.status(400).json({ message: "Benutzername existiert bereits." });
        }
        res.status(500).json({ error: "DB Fehler" });
    }
};

// NEU: User deaktivieren (Chip freigeben)
exports.deactivateUser = async (req, res) => {
    if (req.user.role !== 'admin') return res.status(403).json({ message: "Nicht erlaubt" });

    const { id } = req.params;
    const customerId = req.user.customerId;

    try {
        // 1. User prüfen
        const check = await db.query('SELECT display_name FROM users WHERE id = $1 AND customer_id = $2', [id, customerId]);
        if (check.rows.length === 0) return res.status(404).json({ message: "User nicht gefunden" });

        const targetName = check.rows[0].display_name;

        // 2. Deaktivieren & Chip ID nullen (damit Chip wieder frei ist)
        await db.query(
            `UPDATE users SET is_active = FALSE, card_id = NULL WHERE id = $1`,
            [id]
        );

        await logAudit(customerId, req.user.displayName, 'Mitarbeiter entfernt', 'Aktiv', 'Inaktiv', targetName);
        res.json({ status: "success", message: "Mitarbeiter entfernt (deaktiviert) und Chip freigegeben." });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: "Server Fehler" });
    }
};
