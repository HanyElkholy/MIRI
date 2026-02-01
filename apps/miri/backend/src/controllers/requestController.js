// WICHTIG: Wir nennen es jetzt einheitlich 'pool'
const pool = require('../config/db');
const { logAudit } = require('../utils/logger');

// 1. Anträge laden
exports.getRequests = async (req, res) => {
    const { id, role, customerId } = req.user;
    try {
        let q = `SELECT id, user_id as "userId", 
                        TO_CHAR(date, 'YYYY-MM-DD') as date, 
                        TO_CHAR(end_date, 'YYYY-MM-DD') as "endDate",
                        TO_CHAR(new_start, 'HH24:MI') as "newStart", 
                        TO_CHAR(new_end, 'HH24:MI') as "newEnd", 
                        reason, status, type,
                        (SELECT display_name FROM users WHERE id = requests.user_id) as "displayName"
                 FROM requests 
                 WHERE user_id IN (SELECT id FROM users WHERE customer_id = $1)`;
        let p = [customerId];

        if (role !== 'admin') {
            q += ` AND user_id = $2`;
            p.push(id);
        }
        q += ` ORDER BY id DESC`;

        const result = await pool.query(q, p);

        const mapped = result.rows.map(r => ({
            id: r.id,
            userId: r.userId,
            displayName: r.displayName,
            type: r.type,
            date: r.date,
            endDate: r.endDate,
            reason: r.reason,
            status: r.status,
            newStart: r.newStart,
            newEnd: r.newEnd
        }));

        res.json(mapped);
    } catch (e) {
        // console.error(e); 
        res.status(500).json({ message: "Fehler beim Laden" });
    }
};

// 2. Antrag erstellen (FIX: customer_id aus INSERT entfernt)
exports.createRequest = async (req, res) => {
    const body = req.body;

    // Flexible Datenerkennung
    const startDateRaw = body.date || body.start_date || body.date_str;
    const endDateRaw = body.endDate || body.end_date || body.end_date_str || body.start_date;
    const type = body.type;
    const reason = body.reason;
    const targetUserId = body.targetUserId;
    const newStart = body.newStart || body.start_time;
    const newEnd = body.newEnd || body.end_time;

    if (!startDateRaw || !type) {
        return res.status(400).json({ message: "Datum und Art fehlen." });
    }

    let userIdToBook = req.user.id;
    let affectedUserName = req.user.displayName;

    if (req.user.role === 'admin' && targetUserId) {
        userIdToBook = parseInt(targetUserId);
        try {
            const uRes = await pool.query('SELECT display_name FROM users WHERE id = $1', [userIdToBook]);
            if (uRes.rows.length > 0) affectedUserName = uRes.rows[0].display_name;
        } catch (e) { /* ignore */ }
    }

    try {
        // HIER WAR DER FEHLER: customer_id wurde entfernt!
        await pool.query(
            `INSERT INTO requests (user_id, date, end_date, new_start, new_end, reason, status, type) 
             VALUES ($1, $2, $3, $4, $5, $6, 'pending', $7)`,
            [
                userIdToBook,
                startDateRaw,
                endDateRaw,
                (type === 'Urlaub' || type === 'Krank') ? null : newStart,
                (type === 'Urlaub' || type === 'Krank') ? null : newEnd,
                reason,
                type || 'Sonstiges'
            ]
        );

        if (typeof logAudit === 'function') {
            await logAudit(req.user.customerId, req.user.displayName, 'Antrag erstellt', '', type, affectedUserName);
        }

        res.json({ status: "success", message: "Antrag erfolgreich erstellt." });

    } catch (err) {
        // console.error(">> CREATE REQUEST ERROR:", err);
        res.status(500).json({ message: "DB Fehler: " + err.message });
    }
};

// 3. Status ändern (Genehmigen / Ablehnen)
exports.updateRequestStatus = async (req, res) => {
    // CRITICAL SECURITY FIX: Only Admins can approve/reject
    if (req.user.role !== 'admin') {
        return res.status(403).json({ message: "Nicht erlaubt. Nur Administratoren dürfen Anträge bearbeiten." });
    }

    const { id } = req.params;
    const { status } = req.body;
    const actor = req.user.displayName;

    try {
        const reqRes = await pool.query(
            `SELECT id, user_id, 
             TO_CHAR(date, 'YYYY-MM-DD') as date_str,
             TO_CHAR(end_date, 'YYYY-MM-DD') as end_date_str,
             new_start, new_end, 
             reason, type, status,
             (SELECT username FROM users WHERE id = requests.user_id) as username
             FROM requests WHERE id = $1`,
            [id]
        );

        if (reqRes.rows.length === 0) return res.status(404).json({ message: "Antrag nicht gefunden" });
        const reqData = reqRes.rows[0];

        await pool.query('UPDATE requests SET status = $1 WHERE id = $2', [status, id]);

        if (typeof logAudit === 'function') {
            await logAudit(req.user.customerId, actor, `Antrag ${status}`, reqData.status, status, reqData.username);
        }

        // --- WENN GENEHMIGT: BUCHUNGEN UPDATEN ---
        if (status === 'approved') {
            const startDate = new Date(reqData.date_str);
            const endDate = reqData.end_date_str ? new Date(reqData.end_date_str) : new Date(reqData.date_str);

            // Arbeitstage Config laden
            const custRes = await pool.query('SELECT working_days FROM customers WHERE id = $1', [req.user.customerId]);
            const workingDays = custRes.rows[0]?.working_days || [1, 2, 3, 4, 5];

            for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
                const isoDate = d.toISOString().split('T')[0];
                const currentDay = d.getDay();
                if (!workingDays.includes(currentDay)) {
                    if (reqData.type === 'Urlaub' || reqData.type === 'Krank') continue;
                }

                const bRes = await pool.query('SELECT * FROM bookings WHERE user_id = $1 AND date = $2::date', [reqData.user_id, isoDate]);
                let histEntry = { changedAt: new Date(), changedBy: actor, type: `Genehmigung: ${reqData.type}` };

                if (bRes.rows.length > 0) {
                    const b = bRes.rows[0];
                    let hArr = b.history || [];
                    hArr.push(histEntry);

                    if (reqData.type === 'Urlaub' || reqData.type === 'Krank') {
                        await pool.query(
                            `UPDATE bookings SET start_time = NULL, end_time = NULL, type = $1, remarks = $2, history = $3, is_edited = TRUE WHERE id = $4`,
                            [reqData.type, `Genehmigt: ${reqData.reason}`, JSON.stringify(hArr), b.id]
                        );
                    } else {
                        await pool.query(
                            `UPDATE bookings SET start_time = COALESCE($1, start_time), end_time = COALESCE($2, end_time), type = $3, remarks = $4, history = $5, is_edited = TRUE WHERE id = $6`,
                            [reqData.new_start, reqData.new_end, reqData.type, `Genehmigt: ${reqData.reason}`, JSON.stringify(hArr), b.id]
                        );
                    }

                } else {
                    // INSERT neue Buchung (AUCH HIER: customer_id entfernt, um Fehler zu vermeiden!)
                    if (reqData.type === 'Urlaub' || reqData.type === 'Krank') {
                        await pool.query(
                            `INSERT INTO bookings (user_id, date, type, remarks, history, is_edited) VALUES ($1, $2, $3, $4, $5, TRUE)`,
                            [reqData.user_id, isoDate, reqData.type, `Genehmigt: ${reqData.reason}`, JSON.stringify([histEntry])]
                        );
                    } else {
                        await pool.query(
                            `INSERT INTO bookings (user_id, date, start_time, end_time, type, remarks, history, is_edited) VALUES ($1, $2, $3, $4, $5, $6, $7, TRUE)`,
                            [reqData.user_id, isoDate, reqData.new_start, reqData.new_end, reqData.type, `Genehmigt: ${reqData.reason}`, JSON.stringify([histEntry])]
                        );
                    }
                }
            }
        }

        res.json({ status: "success", message: `Antrag ${status}` });

    } catch (e) {
        console.error(e);
        res.status(500).json({ message: "Serverfehler beim Status-Update" });
    }
};

// 4. Antrag löschen (Strings verwenden!)
exports.deleteRequest = async (req, res) => {
    const { id } = req.params;
    const userId = req.user.id;
    const userRole = req.user.role;

    try {
        const reqResult = await pool.query(
            `SELECT id, user_id, type, status, 
             TO_CHAR(date, 'YYYY-MM-DD') as date_str, 
             TO_CHAR(end_date, 'YYYY-MM-DD') as end_date_str
             FROM requests WHERE id = $1`,
            [id]
        );

        if (reqResult.rows.length === 0) {
            return res.status(404).json({ message: "Antrag nicht gefunden." });
        }
        const request = reqResult.rows[0];

        if (userRole !== 'admin') {
            if (request.user_id !== userId) return res.status(403).json({ message: "Nicht erlaubt." });
            if (request.status !== 'pending') return res.status(400).json({ message: "Nur offene Anträge können gelöscht werden." });
        }

        if (request.status === 'approved') {
            const sIso = request.date_str;
            const eIso = request.end_date_str || request.date_str;
            // console.log(`>> Lösche Buchungen von ${sIso} bis ${eIso}`);

            await pool.query(
                `DELETE FROM bookings 
                 WHERE user_id = $1 
                 AND date >= $2 AND date <= $3 
                 AND type = $4`,
                [request.user_id, sIso, eIso, request.type]
            );
        }

        await pool.query('DELETE FROM requests WHERE id = $1', [id]);
        res.json({ status: 'success', message: 'Antrag und Kalendereinträge erfolgreich gelöscht.' });

    } catch (err) {
        // console.error(">> DELETE ERROR:", err);
        res.status(500).json({ message: "Fehler beim Löschen: " + err.message });
    }
};