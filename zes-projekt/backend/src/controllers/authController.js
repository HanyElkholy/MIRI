const bcrypt = require('bcrypt'); // oder 'bcryptjs', je nachdem was installiert ist
const jwt = require('jsonwebtoken');
// WICHTIG: Wir nennen es hier 'pool', weil das der Standard für pg ist
const pool = require('../config/db');
// Logger Import (mit Fallback, falls die Datei fehlt)
let logAudit;
try {
    const logger = require('../utils/logger');
    logAudit = logger.logAudit;
} catch (e) {
    // Falls Logger fehlt, nutzen wir eine leere Funktion, damit nix abstürzt
    logAudit = () => { };
}

// 1. LOGIN
exports.login = async (req, res) => {
    const { username, password } = req.body;

    try {
        const result = await pool.query(
            `SELECT u.*, c.working_days 
             FROM users u 
             JOIN customers c ON u.customer_id = c.id 
             WHERE u.username = $1`,
            [username]
        );

        if (result.rows.length === 0) {
            return res.status(401).json({ message: 'Benutzer nicht gefunden' });
        }

        const user = result.rows[0];
        const match = await bcrypt.compare(password, user.password);

        if (!match) {
            return res.status(401).json({ message: 'Passwort falsch' });
        }

        const token = jwt.sign(
            {
                id: user.id,
                role: user.role,
                customerId: user.customer_id,
                displayName: user.display_name,
                workingDays: user.working_days
            },
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
                mustChangePassword: user.is_initial_password,
                workingDays: user.working_days || [1, 2, 3, 4, 5]
            }
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Serverfehler beim Login' });
    }
};

// 2. CHANGE PASSWORD (User ändert eigenes PW)
exports.changePassword = async (req, res) => {
    const { oldPassword, newPassword } = req.body;
    const userId = req.user.id;

    try {
        const userRes = await pool.query('SELECT password FROM users WHERE id = $1', [userId]);
        const currentHash = userRes.rows[0].password;

        const match = await bcrypt.compare(oldPassword, currentHash);
        if (!match) {
            return res.status(400).json({ message: "Das alte Passwort ist falsch." });
        }

        const saltRounds = 10;
        const newHash = await bcrypt.hash(newPassword, saltRounds);

        await pool.query('UPDATE users SET password = $1, is_initial_password = FALSE WHERE id = $2', [newHash, userId]);

        res.json({ status: "success", message: "Passwort erfolgreich geändert." });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: "Fehler beim Ändern des Passworts." });
    }
};

// 3. ADMIN: PASSWORT RESET (Die neue Funktion)
exports.resetPasswordByAdmin = async (req, res) => {
    // console.log(">> RESET START für User", req.user.username);

    // Check: Ist es ein Admin?
    if (req.user.role !== 'admin') {
        return res.status(403).json({ message: "Nur für Administratoren erlaubt." });
    }

    const { targetUserId, newPassword } = req.body;
    const adminName = req.user.displayName;
    const customerId = req.user.customerId;

    if (!targetUserId || !newPassword) {
        return res.status(400).json({ message: "User ID und neues Passwort fehlen." });
    }

    try {
        const saltRounds = 10;
        const hashedPassword = await bcrypt.hash(newPassword, saltRounds);

        // HIER NUTZEN WIR 'pool', NICHT 'db'
        const result = await pool.query(
            `UPDATE users 
             SET password = $1, is_initial_password = TRUE 
             WHERE id = $2 AND customer_id = $3
             RETURNING username`,
            [hashedPassword, targetUserId, customerId]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ message: "Benutzer nicht gefunden." });
        }

        const targetUsername = result.rows[0].username;
        // console.log(">> RESET ERFOLGREICH für:", targetUsername);

        // Audit Log (optional)
        if (logAudit) {
            logAudit(customerId, adminName, 'Passwort Reset durch Admin', '***', 'Reset', targetUsername);
        }

        res.json({ status: "success", message: `Passwort für ${targetUsername} zurückgesetzt.` });

    } catch (err) {
        // console.error(">> RESET CRASH:", err);
        // Wir senden den genauen Fehler ans Frontend, damit du ihn siehst!
        res.status(500).json({ message: "SERVER FEHLER: " + err.message });
    }
};