const db = require('../config/db');
const { logAudit } = require('../utils/logger'); // Logger importieren!

// 1. Dashboard Stats laden
exports.getDashboard = async (req, res) => {
    const userId = req.user.id;
    const currentYear = new Date().getFullYear();

    try {
        // Warnungen (Alerts) - FIX: Nur wenn Startzeit existiert!
        const alerts = await db.query(
            `SELECT id, TO_CHAR(date, 'DD.MM.YYYY') as date, TO_CHAR(start_time, 'HH24:MI') as start
             FROM bookings 
             WHERE user_id = $1 
               AND date < CURRENT_DATE
               AND start_time IS NOT NULL 
               AND end_time IS NULL`, 
            [userId]
        );

        const stats = await db.query(
            `SELECT SUM(EXTRACT(EPOCH FROM (end_time - start_time))/3600) as hours 
             FROM bookings WHERE user_id = $1 AND date >= date_trunc('week', CURRENT_DATE) AND end_time IS NOT NULL`, [userId]
        );

        // Resturlaub Berechnung
        const userRes = await db.query('SELECT vacation_days FROM users WHERE id = $1', [userId]);
        const totalVacation = userRes.rows[0]?.vacation_days || 30;

        const vacTakenRes = await db.query(
            `SELECT COUNT(*) as count FROM bookings 
             WHERE user_id = $1 AND type = 'Urlaub' AND EXTRACT(YEAR FROM date) = $2`,
            [userId, currentYear]
        );
        const vacTaken = parseInt(vacTakenRes.rows[0].count || 0);
        const vacLeft = totalVacation - vacTaken;

        res.json({
            alerts: alerts.rows,
            hoursWeek: Math.round((stats.rows[0].hours || 0) * 100) / 100,
            vacationLeft: vacLeft
        });
    } catch (e) { console.error(e); res.status(500).json({}); }
};

// 2. Buchungen laden
exports.getBookings = async (req, res) => {
    const { id, role, customerId } = req.user;
    const { from, to } = req.query; 
    try {
        let q = `SELECT id, user_id as "userId", TO_CHAR(date, 'YYYY-MM-DD') as date, 
                        TO_CHAR(start_time, 'HH24:MI') as start, TO_CHAR(end_time, 'HH24:MI') as end, 
                        type, remarks, history 
                 FROM bookings WHERE user_id IN (SELECT id FROM users WHERE customer_id = $1)`;
        let p = [customerId];
        let c = 2;

        if (from && to) {
            q += ` AND date >= $${c} AND date <= $${c+1}`;
            p.push(from, to);
            c += 2;
        }

        if (role !== 'admin') {
            q += ` AND user_id = $${c}`;
            p.push(id);
        }

        q += ` ORDER BY date DESC, start_time DESC LIMIT 500`;
        const result = await db.query(q, p);
        res.json(result.rows);
    } catch (err) { console.error(err); res.status(500).json({}); }
};

// 3. Manuelles Stempeln
exports.manualStamp = async (req, res) => {
    const { action } = req.body;
    const userId = req.user.id;
    const now = new Date();
    const dateStr = now.toLocaleDateString('en-CA', { timeZone: 'Europe/Berlin' });
    const timeStr = now.toLocaleTimeString('de-DE', { timeZone: 'Europe/Berlin', hour12: false });

    try {
        if (action === 'start') {
            await db.query(`INSERT INTO bookings (user_id, date, start_time, type) VALUES ($1, $2, $3, 'Web-Terminal')`,
                [userId, dateStr, timeStr]);
            await logAudit(req.user.customerId, req.user.displayName, 'Stempeln', '', 'Kommen', req.user.displayName);
        } else {
            const open = await db.query(`SELECT id FROM bookings WHERE user_id = $1 AND date = $2 AND end_time IS NULL`,
                [userId, dateStr]);
            if (open.rows.length > 0) {
                await db.query(`UPDATE bookings SET end_time = $1 WHERE id = $2`, [timeStr, open.rows[0].id]);
                await logAudit(req.user.customerId, req.user.displayName, 'Stempeln', '', 'Gehen', req.user.displayName);
            }
        }
        res.json({ status: "success" });
    } catch (e) { console.error(e); res.status(500).json({}); }
};

// 4. Hardware Stempeln
exports.stamp = async (req, res) => {
    const { cardId } = req.body;
    if (!cardId) return res.status(400).json({ message: "Keine Karten-ID" });

    try {
        const uRes = await db.query('SELECT * FROM users WHERE card_id = $1', [cardId]);
        if (uRes.rows.length === 0) return res.status(404).json({ message: "Unbekannte Karte" });
        
        const user = uRes.rows[0];
        const now = new Date();
        const dateStr = now.toLocaleDateString('en-CA', { timeZone: 'Europe/Berlin' });
        const timeStr = now.toLocaleTimeString('de-DE', { timeZone: 'Europe/Berlin', hour12: false });

        const openB = await db.query(
            'SELECT * FROM bookings WHERE user_id = $1 AND date = $2 AND end_time IS NULL', 
            [user.id, dateStr]
        );

        let type = "Kommen";
        if (openB.rows.length > 0) {
            await db.query('UPDATE bookings SET end_time = $1 WHERE id = $2', [timeStr, openB.rows[0].id]);
            type = "Gehen";
        } else {
            await db.query('INSERT INTO bookings (user_id, date, start_time, type) VALUES ($1, $2, $3, $4)', 
                [user.id, dateStr, timeStr, 'valid']);
        }

        await logAudit(user.customer_id, 'Terminal', 'Chip Stempelung', '', type, user.display_name);

        res.status(200).json({ status: "success", user: user.display_name, type: type });
    } catch (e) { console.error(e); res.status(500).json({ message: "Server Fehler" }); }
};

// 5. Historie laden (DER FIX!)
exports.getHistory = async (req, res) => {
    const { customerId, role, displayName } = req.user;
    try {
        let q = `SELECT timestamp, actor, action, old_value as "oldValue", new_value as "newValue", affected_user as "affectedUser"
                 FROM audit_logs WHERE customer_id = $1`;
        let p = [customerId];

        if (role !== 'admin') {
            // FIX: Wir prüfen auf Actor (Ich habe es getan) ODER affected_user (Wurde AN mir getan)
            q += ` AND (actor = $2 OR affected_user = $2)`;
            p.push(displayName);
        }
        
        q += ` ORDER BY timestamp DESC LIMIT 100`;
        const r = await db.query(q, p);
        res.json(r.rows);
    } catch (e) { console.error(e); res.status(500).json({}); }
};