const db = require('../config/db');

const bcrypt = require('bcrypt');

const { logAudit } = require('../utils/logger'); // <--- WICHTIG: Logger importieren

// Simple Sanitizer without external lib (npm failed)
function sanitize(str) {
    if (!str) return '';
    return str.replace(/[<>"'/]/g, ''); // Basic XSS protection
}



// User Liste laden

exports.getUsers = async (req, res) => {

    const customerId = req.user.customerId;

    try {

        const result = await db.query(

            `SELECT id, display_name as "displayName", role, daily_target as "dailyTarget", vacation_days as "vacationDays" 

             FROM users WHERE customer_id = $1 ORDER BY display_name`,

            [customerId]

        );

        res.json(result.rows);

    } catch (err) {

        console.error(err);

        res.status(500).json({ error: "DB Error" });

    }

};



// Mitarbeiter anlegen (Mit Logging!)

exports.createUser = async (req, res) => {

    if (req.user.role !== 'admin') return res.status(403).json({ message: "Nicht erlaubt" });



    const { username, displayName, cardId, vacationDays, dailyTarget } = req.body;

    // Sanitization
    const safeUsername = sanitize(username);
    const safeDisplayName = sanitize(displayName);
    const safeCardId = sanitize(cardId);

    const customerId = req.user.customerId;



    try {

        const initialPwHash = await bcrypt.hash("Start123!", 10);



        await db.query(

            `INSERT INTO users (username, password, display_name, role, card_id, vacation_days, daily_target, is_initial_password, customer_id)

             VALUES ($1, $2, $3, 'user', $4, $5, $6, TRUE, $7)`,

            [safeUsername, initialPwHash, safeDisplayName, safeCardId, vacationDays || 30, dailyTarget || 8.0, customerId]

        );



        // --- HIER IST DAS LOGGING ---

        // Wer (Admin) hat Was (Mitarbeiter angelegt) getan?

        // Wer (Admin) hat Was (Mitarbeiter angelegt) getan?

        await logAudit(customerId, req.user.displayName, 'Mitarbeiter angelegt', '', safeUsername, safeDisplayName);
        // ----------------------------



        res.json({ status: "success", message: "Mitarbeiter angelegt." });

    } catch (err) {

        console.error(err);

        if (err.code === '23505') {

            return res.status(400).json({ message: "Benutzername existiert bereits." });

        }

        res.status(500).json({ error: "DB Fehler" });

    }

};
