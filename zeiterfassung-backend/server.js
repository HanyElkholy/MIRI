require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const crypto = require('crypto');
const path = require('path');
const bcrypt = require('bcrypt');
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');

const app = express();
const port = 3001;

// --- SICHERHEIT & CONFIG ---
// Content Security Policy für Tailwind CDN erlauben
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors());
app.use(express.json());

// Rate Limiting: 200 Anfragen pro 15 Min
const limiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 200 });
app.use('/zes/api', limiter);

// --- FRONTEND BEREITSTELLUNG ---
app.use('/zes', express.static(path.join(__dirname, 'public')));
app.use('/zes', express.static(__dirname));

// --- DATENBANK VERBINDUNG ---
const pool = new Pool({
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.DB_NAME,
  password: process.env.DB_PASSWORD,
  port: process.env.DB_PORT,
});

// --- SESSION MANAGEMENT ---
async function getSession(req, res) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
        if(res) res.status(401).json({ message: "Authentifizierung erforderlich." });
        return null;
    }

    try {
        const result = await pool.query(
            `SELECT user_data FROM user_sessions 
             WHERE token = $1 AND expires_at > NOW()`, 
            [token]
        );

        if (result.rows.length > 0) {
            return result.rows[0].user_data;
        } else {
            if(res) res.status(401).json({ message: "Sitzung abgelaufen. Bitte neu anmelden." });
            return null;
        }
    } catch (e) {
        console.error("Session Error:", e);
        if(res) res.status(500).json({ message: "Interner Serverfehler (Session)." });
        return null;
    }
}

// --- AUDIT LOGGING (DEUTSCH) ---
async function logAudit(customerId, actor, action, oldVal, newVal, affectedUser) {
    try {
        await pool.query(
            `INSERT INTO audit_logs (customer_id, actor, action, old_value, new_value, affected_user) 
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [customerId, actor, action, oldVal, newVal, affectedUser || actor]
        );
    } catch(e) { console.error("Audit Log Fehler:", e); }
}

// ==================================================================
// API ENDPUNKTE
// ==================================================================

// 1. LOGIN
app.post('/zes/api/v1/login', async (req, res) => {
    const { username, password } = req.body;
    try {
        const result = await pool.query(
            `SELECT u.*, c.name as client_name 
             FROM users u 
             JOIN customers c ON u.customer_id = c.id 
             WHERE u.username = $1`, 
            [username]
        );

        if (result.rows.length > 0) {
            const user = result.rows[0];
            const match = await bcrypt.compare(password, user.password);
            
            if (match) {
                const token = crypto.randomBytes(32).toString('hex');
                const sessionUser = { 
                    id: user.id, username: user.username, role: user.role, 
                    displayName: user.display_name, customerId: user.customer_id 
                };

                await pool.query(
                    `INSERT INTO user_sessions (token, user_data, expires_at) 
                     VALUES ($1, $2, NOW() + INTERVAL '30 days')`,
                    [token, JSON.stringify(sessionUser)]
                );
                
                logAudit(user.customer_id, user.display_name, 'Login', '', 'Erfolgreich', user.display_name);

                res.json({ 
                    status: "success", token, 
                    user: { 
                        id: user.id, 
                        role: user.role, 
                        displayName: user.display_name, 
                        clientName: user.client_name, 
                        vacationDays: user.vacation_days, 
                        dailyTarget: user.daily_target 
                    } 
                });
            } else { res.status(401).json({ message: "Passwort ungültig." }); }
        } else { res.status(401).json({ message: "Benutzer nicht gefunden." }); }
    } catch (err) { console.error(err); res.status(500).json({ error: "Datenbankfehler." }); }
});

// 2. PASSWORT ÄNDERN
app.put('/zes/api/v1/password', async (req, res) => {
    const session = await getSession(req, res);
    if (!session) return; 

    const { oldPassword, newPassword } = req.body;

    try {
        const result = await pool.query('SELECT password FROM users WHERE id = $1', [session.id]);
        if (result.rows.length === 0) return res.status(404).json({ message: "Benutzer nicht gefunden." });
        
        const currentHash = result.rows[0].password;
        const match = await bcrypt.compare(oldPassword, currentHash);
        
        if (!match) {
            return res.json({ status: "error", message: "Das aktuelle Passwort ist falsch." });
        }

        const newHash = await bcrypt.hash(newPassword, 10);
        await pool.query('UPDATE users SET password = $1 WHERE id = $2', [newHash, session.id]);

        logAudit(session.customerId, session.displayName, 'Sicherheit', 'Passwort geändert', '', session.displayName);

        res.json({ status: "success", message: "Passwort erfolgreich aktualisiert." });

    } catch (e) {
        console.error(e);
        res.status(500).json({ error: "Serverfehler beim Speichern." });
    }
});

// 3. DASHBOARD (Statistiken & Warnungen)
app.get('/zes/api/v1/dashboard', async (req, res) => {
    const session = await getSession(req, res); if (!session) return;
    try {
        // Warnungen: Offene Buchungen vor heute
        const alerts = await pool.query(
            `SELECT id, TO_CHAR(date, 'DD.MM.YYYY') as date, TO_CHAR(start_time, 'HH24:MI') as start 
             FROM bookings 
             WHERE user_id = $1 AND end_time IS NULL AND date < CURRENT_DATE`, 
            [session.id]
        );

        // Stunden diese Woche
        const stats = await pool.query(
            `SELECT SUM(EXTRACT(EPOCH FROM (end_time - start_time))/3600) as hours 
             FROM bookings 
             WHERE user_id = $1 AND date >= date_trunc('week', CURRENT_DATE) AND end_time IS NOT NULL`, 
            [session.id]
        );

        // Nächster Urlaub
        const vac = await pool.query(
            `SELECT TO_CHAR(date, 'DD.MM.YYYY') as date 
             FROM requests 
             WHERE user_id = $1 AND status = 'approved' AND type = 'Urlaub' AND date >= CURRENT_DATE 
             ORDER BY date ASC LIMIT 1`, 
            [session.id]
        );
        
        res.json({
            alerts: alerts.rows,
            hoursWeek: Math.round((stats.rows[0].hours || 0) * 100) / 100,
            nextVacation: vac.rows.length > 0 ? vac.rows[0].date : '-'
        });
    } catch(e) { res.status(500).json({}); }
});

// 4. MANUELLES STEMPELN (Web Terminal)
app.post('/zes/api/v1/stamp-manual', async (req, res) => {
    const session =  await getSession(req, res); if (!session) return;
    const { action } = req.body; 
    
    const now = new Date();
    const dateStr = now.toLocaleDateString('en-CA', { timeZone: 'Europe/Berlin' });
    const timeStr = now.toLocaleTimeString('de-DE', { timeZone: 'Europe/Berlin', hour12: false });

    try {
        if (action === 'start') {
            await pool.query(
                `INSERT INTO bookings (user_id, date, start_time, type) VALUES ($1, $2, $3, 'Web-Terminal')`,
                [session.id, dateStr, timeStr]
            );
        } else {
            const open = await pool.query(
                `SELECT id FROM bookings WHERE user_id=$1 AND date=$2 AND end_time IS NULL`,
                [session.id, dateStr]
            );
            if(open.rows.length > 0) {
                await pool.query(`UPDATE bookings SET end_time=$1 WHERE id=$2`, [timeStr, open.rows[0].id]);
            }
        }
        res.json({ status: "success" });
    } catch(e) { res.status(500).json({}); }
});

// 5. HISTORY / AUDIT LOG
app.get('/zes/api/v1/history', async (req, res) => {
    const session = await getSession(req, res); 
    if(!session) return res.status(401).json({});
    
    try {
        let query = `
            SELECT 
                timestamp, actor, action, old_value as "oldValue", new_value as "newValue", affected_user as "affectedUser"
            FROM audit_logs 
            WHERE customer_id = $1
        `;
        let params = [session.customerId];

        if (session.role !== 'admin') {
            query += ' AND (actor = $2 OR affected_user = $2)';
            params.push(session.displayName);
        }

        query += ' ORDER BY timestamp DESC LIMIT 100';
        const r = await pool.query(query, params);
        res.json(r.rows);
    } catch(e) { console.error(e); res.status(500).json({}); }
});

// 6. JOURNAL (BUCHUNGEN) - Mit Datumsbereich
app.get('/zes/api/v1/bookings', async (req, res) => {
    const session = await getSession(req, res); if (!session) return;
    
    const { from, to } = req.query;

    try {
        let q = `
            SELECT id, user_id as "userId", 
            TO_CHAR(date, 'YYYY-MM-DD') as date, 
            TO_CHAR(start_time, 'HH24:MI') as start, 
            TO_CHAR(end_time, 'HH24:MI') as end, 
            type, remarks, history, is_edited as "isEdited" 
            FROM bookings 
            WHERE user_id IN (SELECT id FROM users WHERE customer_id = $1)
        `;
        let p = [session.customerId];
        let paramCount = 2;

        if (from && to) {
            q += ` AND date >= $${paramCount} AND date <= $${paramCount + 1}`;
            p.push(from, to);
            paramCount += 2;
        }

        if (session.role !== 'admin') { 
            q += ` AND user_id = $${paramCount}`; 
            p.push(session.id); 
        }
        
        q += ' ORDER BY date DESC, start_time DESC LIMIT 1000';
        const r = await pool.query(q, p); 
        res.json(r.rows);
    } catch (err) { console.error(err); res.status(500).json({}); }
});

// 7. ANTRÄGE LADEN
app.get('/zes/api/v1/requests', async (req, res) => {
    const s = await getSession(req, res); if(!s) return;
    try {
        let q = `
            SELECT id, user_id as "userId", 
            TO_CHAR(date, 'YYYY-MM-DD') as date, 
            TO_CHAR(end_date, 'YYYY-MM-DD') as "endDate",
            TO_CHAR(new_start, 'HH24:MI') as "newStart", 
            TO_CHAR(new_end, 'HH24:MI') as "newEnd", 
            reason, status, type 
            FROM requests 
            WHERE user_id IN (SELECT id FROM users WHERE customer_id = $1)
        `;
        let p = [s.customerId];
        if(s.role!=='admin'){ q+=' AND user_id = $2'; p.push(s.id); }
        q += ' ORDER BY id DESC';
        const r = await pool.query(q, p); 
        res.json(r.rows);
    } catch(e){ res.status(500).json({}); }
});

// 8. ANTRAG ERSTELLEN (Mit Datumsbereich)
app.post('/zes/api/v1/requests', async (req, res) => {
    const s = await getSession(req, res); if (!s) return;
    
    const { date, endDate, newStart, newEnd, reason, type } = req.body;

    if (endDate && new Date(endDate) < new Date(date)) {
        return res.status(400).json({ status: "error", message: "Das Enddatum darf nicht vor dem Startdatum liegen." });
    }

    try { 
        await pool.query(
            `INSERT INTO requests (user_id, date, end_date, new_start, new_end, reason, status, type) 
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
            [s.id, date, endDate || null, newStart, newEnd, reason, 'pending', type || 'Sonstiges']
        );

        let logDetail = type || 'Sonstiges';
        if(endDate) logDetail += ` (${date} bis ${endDate})`;

        logAudit(s.customerId, s.displayName, 'Antrag erstellt', '', logDetail, s.displayName);
        res.json({ status: "success" }); 
    } catch (err) { 
        console.error(err);
        res.status(500).json({ error: "Fehler beim Speichern." }); 
    }
});

// 9. BENACHRICHTIGUNGEN
app.get('/zes/api/v1/notifications', async (req, res) => {
    const s = await getSession(req, res); if (!s) return;
    try {
        let result = { items: [] };

        if (s.role === 'admin') {
            const r = await pool.query(
                `SELECT r.id, r.type, TO_CHAR(r.date, 'DD.MM.YYYY') as date, u.display_name as user 
                 FROM requests r
                 JOIN users u ON r.user_id = u.id
                 WHERE u.customer_id = $1 AND r.status = 'pending'
                 ORDER BY r.id DESC`,
                [s.customerId]
            );
            result.items = r.rows;
            result.type = 'admin_open_requests';
        } else {
            const r = await pool.query(
                `SELECT id, status, type, reason, TO_CHAR(date, 'DD.MM.YYYY') as date 
                 FROM requests 
                 WHERE user_id = $1 AND status != 'pending' AND user_seen = FALSE
                 ORDER BY id DESC`,
                [s.id]
            );
            result.items = r.rows;
            result.type = 'user_updates';
        }
        result.count = result.items.length;
        res.json(result);
    } catch (e) { res.status(500).json({ error: "DB Error" }); }
});

app.post('/zes/api/v1/notifications/read', async (req, res) => {
    const s = await getSession(req, res); if (!s) return;
    try {
        await pool.query(`UPDATE requests SET user_seen = TRUE WHERE user_id = $1 AND status != 'pending'`, [s.id]);
        res.json({ status: "success" });
    } catch (e) { res.status(500).json({}); }
});

// 10. BUCHUNG BEARBEITEN (Admin)
app.put('/zes/api/v1/bookings/:id', async (req, res) => {
    const s = await getSession(req, res); 
    if(!s || s.role !== 'admin') return res.status(403).json({});
    
    const { start, end, remarks } = req.body;
    try {
        const oldRes = await pool.query(
            `SELECT b.*, u.display_name as username 
             FROM bookings b 
             JOIN users u ON b.user_id = u.id 
             WHERE b.id = $1`, 
            [req.params.id]
        );
        
        if(oldRes.rows.length === 0) return res.status(404).json({message:"Eintrag nicht gefunden."});
        const oldB = oldRes.rows[0];
        
        logAudit(s.customerId, s.displayName, 'Buchung korrigiert', `${oldB.start_time}-${oldB.end_time}`, `${start}-${end}`, oldB.username);
        
        let hArr = oldB.history || [];
        hArr.push({ changedAt: new Date(), changedBy: s.displayName, type: "Manuelle Korrektur", oldStart: oldB.start_time, oldEnd: oldB.end_time });
        
        await pool.query('UPDATE bookings SET start_time=$1, end_time=$2, remarks=$3, history=$4, is_edited=TRUE WHERE id=$5', [start, end, remarks, JSON.stringify(hArr), req.params.id]);
        res.json({status:"success"});
    } catch(e){ console.error(e); res.status(500).json({}); }
});

// 11. ANTRAG GENEHMIGEN (Mit Loop für Zeiträume)
app.put('/zes/api/v1/requests/:id', async (req, res) => {
    const s = await getSession(req, res); 
    if(!s || s.role !== 'admin') return res.status(403).json({});
    
    const { status } = req.body; 
    const reqId = req.params.id;

    try {
        const reqRes = await pool.query(
            `SELECT r.*, TO_CHAR(r.date, 'YYYY-MM-DD') as date_str, TO_CHAR(r.end_date, 'YYYY-MM-DD') as end_date_str, u.display_name as username 
             FROM requests r 
             JOIN users u ON r.user_id = u.id 
             WHERE r.id = $1`, 
            [reqId]
        );
        
        if (reqRes.rows.length === 0) return res.status(404).json({ message: "Antrag nicht gefunden." });
        const reqData = reqRes.rows[0];

        await pool.query('UPDATE requests SET status = $1 WHERE id = $2', [status, reqId]);
        logAudit(s.customerId, s.displayName, `Antrag ${status === 'approved' ? 'Genehmigt' : 'Abgelehnt'}`, reqData.type, status, reqData.username);
        
        if (status === 'approved') {
            const startDate = new Date(reqData.date_str);
            const endDate = reqData.end_date_str ? new Date(reqData.end_date_str) : new Date(reqData.date_str);
            
            // Loop durch alle Tage im Zeitraum
            for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
                const currentIsoDate = d.toISOString().split('T')[0];
                
                const bRes = await pool.query(
                    `SELECT * FROM bookings WHERE user_id=$1 AND date=$2::date ORDER BY end_time ASC NULLS FIRST LIMIT 1`, 
                    [reqData.user_id, currentIsoDate]
                );
                
                const hist = { changedAt: new Date(), changedBy: s.displayName, type: `Genehmigung: ${reqData.type}` };

                if(bRes.rows.length > 0) {
                    const b = bRes.rows[0];
                    let hArr = b.history || []; hArr.push(hist);
                    await pool.query(
                        `UPDATE bookings SET start_time=COALESCE($1, start_time), end_time=COALESCE($2, end_time), type=$3, remarks=$4, history=$5, is_edited=TRUE WHERE id=$6`, 
                        [reqData.new_start, reqData.new_end, reqData.type, `Genehmigt: ${reqData.reason}`, JSON.stringify(hArr), b.id]
                    );
                } else {
                    await pool.query(
                        `INSERT INTO bookings (user_id, date, start_time, end_time, type, remarks, history, is_edited) 
                         VALUES ($1, $2, $3, $4, $5, $6, $7, TRUE)`, 
                        [reqData.user_id, currentIsoDate, reqData.new_start, reqData.new_end, reqData.type, `Genehmigt: ${reqData.reason}`, JSON.stringify([hist])]
                    );
                }
            }
        }
        res.json({status:"success"});
    } catch(e) { console.error(e); res.status(500).json({}); }
});

// 12. USER LISTE
app.get('/zes/api/v1/users', async (req, res) => {
    const s = await getSession(req, res); if(!s) return;
    try {
        const r = await pool.query(
            `SELECT id, display_name as "displayName", role, daily_target as "dailyTarget", vacation_days as "vacationDays" 
             FROM users WHERE customer_id = $1`, 
            [s.customerId]
        );
        res.json(r.rows);
    } catch (e) { res.status(500).json({}); }
});

// 13. ESP32 STEMPELUNG
app.post('/zes/api/v1/stamp', async (req, res) => {
    const { cardId } = req.body;
    if(!cardId) return res.status(400).json({});
    try {
        const uRes = await pool.query('SELECT * FROM users WHERE card_id = $1', [cardId]);
        if(uRes.rows.length===0) return res.status(404).json({message:"Unbekannte Karte"});
        const user = uRes.rows[0];
        
        const now = new Date();
        const dateStr = now.toLocaleDateString('en-CA', { timeZone: 'Europe/Berlin' });
        const timeStr = now.toLocaleTimeString('de-DE', { timeZone: 'Europe/Berlin', hour12: false });
        
        const openB = await pool.query('SELECT * FROM bookings WHERE user_id=$1 AND date=$2 AND end_time IS NULL', [user.id, dateStr]);
        let type = "Kommen";
        if(openB.rows.length > 0) {
            await pool.query('UPDATE bookings SET end_time=$1 WHERE id=$2', [timeStr, openB.rows[0].id]);
            type = "Gehen";
        } else {
            await pool.query('INSERT INTO bookings (user_id, date, start_time, type) VALUES ($1,$2,$3,$4)', [user.id, dateStr, timeStr, 'valid']);
        }
        res.status(200).json({ status: "success", user: user.display_name, type: type });
    } catch(e){ res.status(500).json({}); }
});

// --- FALLBACK ---
app.get(/\/zes\/.*/, (req, res) => {
    const pI = path.join(__dirname, 'public', 'index.html');
    if (require('fs').existsSync(pI)) res.sendFile(pI); 
    else res.sendFile(path.join(__dirname, 'index.html'));
});
app.get('/zes', (req, res) => res.redirect('/zes/'));

app.listen(port, '0.0.0.0', () => console.log(`Server läuft auf Port ${port}`));