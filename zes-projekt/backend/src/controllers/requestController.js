const db = require('../config/db');
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
                        reason, status, type 
                 FROM requests 
                 WHERE user_id IN (SELECT id FROM users WHERE customer_id = $1)`;
        let p = [customerId];

        if (role !== 'admin') {
            q += ` AND user_id = $2`;
            p.push(id);
        }
        q += ` ORDER BY id DESC`;

        const result = await db.query(q, p);
        res.json(result.rows);
    } catch (e) { console.error(e); res.status(500).json({}); }
};

// 2. Antrag erstellen (Mit korrektem Namens-Log)
exports.createRequest = async (req, res) => {
    let { targetUserId, date, endDate, newStart, newEnd, reason, type } = req.body;
    
    // Daten putzen
    const clean = (val) => (val && val.trim() !== "") ? val : null;
    date = clean(date); endDate = clean(endDate); newStart = clean(newStart); newEnd = clean(newEnd); reason = clean(reason);
    
    if (type === 'Urlaub' || type === 'Krank') { newStart = null; newEnd = null; }

    let userIdToBook = req.user.id;
    let affectedUserName = req.user.displayName; // Standard: Eigener Name

    // Wenn Admin für jemand anderen bucht
    if (req.user.role === 'admin' && targetUserId) {
        userIdToBook = parseInt(targetUserId);
        // Namen des Ziels holen für das Log
        const uRes = await db.query('SELECT display_name FROM users WHERE id = $1', [userIdToBook]);
        if(uRes.rows.length > 0) affectedUserName = uRes.rows[0].display_name;
    }

    try {
        await db.query(
            `INSERT INTO requests (user_id, date, end_date, new_start, new_end, reason, status, type) 
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
            [userIdToBook, date, endDate, newStart, newEnd, reason, 'pending', type || 'Sonstiges']
        );
        
        // Loggen mit echtem Namen!
        await logAudit(req.user.customerId, req.user.displayName, 'Antrag erstellt', '', type, affectedUserName);

        res.json({ status: "success", message: "Antrag erfolgreich erstellt." });
    } catch (err) {
        console.error("Fehler Antrag:", err);
        res.status(500).json({ error: "DB Fehler" });
    }
};

// 3. Antrag bearbeiten (Genehmigen)
exports.updateRequestStatus = async (req, res) => {
    const { status } = req.body;
    const reqId = req.params.id;
    const actor = req.user.displayName;

    try {
        const reqRes = await db.query(
            `SELECT r.*, TO_CHAR(r.date, 'YYYY-MM-DD') as date_str, 
                    TO_CHAR(r.end_date, 'YYYY-MM-DD') as end_date_str,
                    u.display_name as username 
             FROM requests r 
             JOIN users u ON r.user_id = u.id
             WHERE r.id = $1`, 
            [reqId]
        );
        if (reqRes.rows.length === 0) return res.status(404).json({ message: "Nicht gefunden" });
        const reqData = reqRes.rows[0];

        await db.query('UPDATE requests SET status = $1 WHERE id = $2', [status, reqId]);

        // LOG: Hier nutzen wir reqData.username, das ist der DisplayName aus dem Join oben!
        await logAudit(req.user.customerId, actor, `Antrag ${status}`, reqData.status, status, reqData.username);

        if (status === 'approved') {
            const startDate = new Date(reqData.date_str);
            const endDate = reqData.end_date_str ? new Date(reqData.end_date_str) : new Date(reqData.date_str);

            for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
                const isoDate = d.toISOString().split('T')[0];
                const bRes = await db.query(`SELECT * FROM bookings WHERE user_id = $1 AND date = $2::date`, [reqData.user_id, isoDate]);
                const histEntry = { changedAt: new Date(), changedBy: actor, type: `Genehmigung: ${reqData.type}` };

                if (bRes.rows.length > 0) {
                    const b = bRes.rows[0];
                    let hArr = b.history || []; hArr.push(histEntry);
                    await db.query(
                        `UPDATE bookings SET start_time=COALESCE($1, start_time), end_time=COALESCE($2, end_time), 
                         type=$3, remarks=$4, history=$5, is_edited=TRUE WHERE id=$6`,
                        [reqData.new_start, reqData.new_end, reqData.type, `Genehmigt: ${reqData.reason}`, JSON.stringify(hArr), b.id]
                    );
                } else {
                    await db.query(
                        `INSERT INTO bookings (user_id, date, start_time, end_time, type, remarks, history, is_edited)
                         VALUES ($1, $2, $3, $4, $5, $6, $7, TRUE)`,
                        [reqData.user_id, isoDate, reqData.new_start, reqData.new_end, reqData.type, `Genehmigt: ${reqData.reason}`, JSON.stringify([histEntry])]
                    );
                }
            }
        }
        res.json({ status: "success" });
    } catch (e) { console.error(e); res.status(500).json({}); }
};