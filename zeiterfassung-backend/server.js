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

// --- SECURITY ---
// Erlaubt das Laden von Skripten/Bildern von externen Quellen (wichtig für Tailwind CDN)
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors());
app.use(express.json());

// Rate Limiting: Schutz vor Brute Force (200 Anfragen pro 15 Min)
const limiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 200 });
app.use('/zes/api', limiter);

// --- FRONTEND ---
// Wir stellen das Frontend unter /zes bereit
app.use('/zes', express.static(path.join(__dirname, 'public')));
app.use('/zes', express.static(__dirname));

// --- DB VERBINDUNG ---
const pool = new Pool({
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.DB_NAME,
  password: process.env.DB_PASSWORD,
  port: process.env.DB_PORT,
});

// --- SESSION STORE (Im Arbeitsspeicher) ---
let sessionStore = {};

function getSession(req, res) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (!token || !sessionStore[token]) {
        if(res) res.status(401).json({ message: "Sitzung abgelaufen oder ungültig" });
        return null;
    }
    return sessionStore[token];
}

// --- HELPER: SYSTEMPROTOKOLL SCHREIBEN ---
async function logAudit(customerId, actor, module, action, oldVal, newVal) {
    try {
        await pool.query(
            `INSERT INTO audit_logs (customer_id, actor, module, action, old_value, new_value) 
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [customerId, actor, module, action, oldVal, newVal]
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
        // User + Firmennamen abrufen
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
                // Session speichern
                sessionStore[token] = { 
                    id: user.id, username: user.username, role: user.role, 
                    displayName: user.display_name, customerId: user.customer_id 
                };
                
                // Login protokollieren
                logAudit(user.customer_id, user.display_name, 'AUTH', 'Login', '', 'Erfolgreich');

                // Antwort ans Frontend (Alle Daten für 'currentUser' Objekt)
                res.json({ 
                    status: "success", token, 
                    user: { 
                        id: user.id, 
                        role: user.role, 
                        displayName: user.display_name, 
                        clientName: user.client_name, 
                        vacationDays: user.vacation_days, // Wichtig für Zeitkonto
                        dailyTarget: user.daily_target 
                    } 
                });
            } else { res.status(401).json({ message: "Passwort falsch" }); }
        } else { res.status(401).json({ message: "Benutzer nicht gefunden" }); }
    } catch (err) { console.error(err); res.status(500).json({ error: "DB Error" }); }
});

// 2. DASHBOARD (Stats & Alerts)
app.get('/zes/api/v1/dashboard', async (req, res) => {
    const session = getSession(req, res); if (!session) return;
    try {
        // Warnungen: Offene Buchungen, die älter als HEUTE sind
        const alerts = await pool.query(
            `SELECT id, TO_CHAR(date, 'DD.MM.YYYY') as date, TO_CHAR(start_time, 'HH24:MI') as start 
             FROM bookings 
             WHERE user_id = $1 AND end_time IS NULL AND date < CURRENT_DATE`, 
            [session.id]
        );

        // Stunden diese Woche (Montag bis Heute)
        const stats = await pool.query(
            `SELECT SUM(EXTRACT(EPOCH FROM (end_time - start_time))/3600) as hours 
             FROM bookings 
             WHERE user_id = $1 AND date >= date_trunc('week', CURRENT_DATE) AND end_time IS NOT NULL`, 
            [session.id]
        );

        // Nächster genehmigter Urlaub
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

// 3. MANUELLES STEMPELN (Web Button)
app.post('/zes/api/v1/stamp-manual', async (req, res) => {
    const session = getSession(req, res); if (!session) return;
    const { action } = req.body; // 'start' oder 'end'
    
    // Zeitstempel generieren (Deutsche Zeit)
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
            // Offene Buchung suchen und schließen
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

// 4. HISTORY LADEN (Systemprotokoll)
app.get('/zes/api/v1/history', async (req, res) => {
    const session = getSession(req, res); 
    if(!session || session.role !== 'admin') return res.status(403).json({});
    
    try {
        const r = await pool.query(
            `SELECT timestamp, actor, module, action, old_value as "oldValue", new_value as "newValue" 
             FROM audit_logs 
             WHERE customer_id = $1 
             ORDER BY timestamp DESC LIMIT 100`, 
            [session.customerId]
        );
        res.json(r.rows);
    } catch(e) { res.status(500).json({}); }
});

// 5. BUCHUNGEN LADEN (Journal & Live Monitor)
app.get('/zes/api/v1/bookings', async (req, res) => {
    const session = getSession(req, res); if (!session) return;
    try {
        // Basis-Query für die Firma
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
        
        // Wenn kein Admin, filtere nur eigene Daten
        if (session.role !== 'admin') { 
            q += ' AND user_id = $2'; 
            p.push(session.id); 
        }
        q += ' ORDER BY date DESC, start_time DESC LIMIT 500';
        
        const r = await pool.query(q, p); 
        res.json(r.rows);
    } catch (err) { res.status(500).json({}); }
});

// 6. ANTRÄGE LADEN
app.get('/zes/api/v1/requests', async (req, res) => {
    const s = getSession(req, res); if(!s) return;
    try {
        let q = `
            SELECT id, user_id as "userId", 
            TO_CHAR(date, 'YYYY-MM-DD') as date, 
            TO_CHAR(new_start, 'HH24:MI') as "newStart", 
            TO_CHAR(new_end, 'HH24:MI') as "newEnd", 
            reason, status, type 
            FROM requests 
            WHERE user_id IN (SELECT id FROM users WHERE customer_id = $1)
        `;
        let p = [s.customerId];
        if(s.role!=='admin'){ q+=' AND user_id = $2'; p.push(s.id); }
        q += ' ORDER BY id DESC'; // Neueste zuerst
        const r = await pool.query(q, p); 
        res.json(r.rows);
    } catch(e){ res.status(500).json({}); }
});

// 7. ANTRAG ERSTELLEN
app.post('/zes/api/v1/requests', async (req, res) => {
    const s = getSession(req, res); if(!s) return;
    const { date, newStart, newEnd, reason, type } = req.body;
    try {
        await pool.query(
            `INSERT INTO requests (user_id, date, new_start, new_end, reason, status, type) 
             VALUES ($1, $2, $3, $4, $5, $6, $7)`, 
            [s.id, date, newStart, newEnd, reason, 'pending', type || 'Sonstiges']
        );
        res.json({status:"success"}); 
    } catch(e){ res.status(500).json({}); }
});

// 8. BUCHUNG BEARBEITEN (Admin)
app.put('/zes/api/v1/bookings/:id', async (req, res) => {
    const s = getSession(req, res); if(!s || s.role !== 'admin') return res.status(403).json({});
    const { start, end, remarks } = req.body;
    try {
        const old = await pool.query('SELECT * FROM bookings WHERE id=$1', [req.params.id]);
        const oldB = old.rows[0];
        
        // Loggen im Systemprotokoll
        logAudit(s.customerId, s.displayName, 'BOOKING', 'Edit', `${oldB.start_time}-${oldB.end_time}`, `${start}-${end}`);
        
        // JSON History im Eintrag
        let hArr = oldB.history || [];
        hArr.push({ changedAt: new Date(), changedBy: s.displayName, type: "Korrektur", oldStart: oldB.start_time, oldEnd: oldB.end_time });
        
        await pool.query(
            `UPDATE bookings SET start_time=$1, end_time=$2, remarks=$3, history=$4, is_edited=TRUE WHERE id=$5`, 
            [start, end, remarks, JSON.stringify(hArr), req.params.id]
        );
        res.json({status:"success"});
    } catch(e){ res.status(500).json({}); }
});

// 9. ANTRAG GENEHMIGEN (Mit intelligenter Suche)
app.put('/zes/api/v1/requests/:id', async (req, res) => {
    const s = getSession(req, res); if(!s || s.role !== 'admin') return res.status(403).json({});
    const { status } = req.body; 
    const reqId = req.params.id;

    try {
        await pool.query('UPDATE requests SET status=$1 WHERE id=$2', [status, reqId]);
        logAudit(s.customerId, s.displayName, 'REQUEST', status, `Req #${reqId}`, '');
        
        if (status === 'approved') {
            const reqData = (await pool.query('SELECT * FROM requests WHERE id=$1', [reqId])).rows[0];
            
            // Suche offene oder passende Buchung am selben Tag
            const bRes = await pool.query(
                `SELECT * FROM bookings WHERE user_id=$1 AND date=$2::date ORDER BY end_time ASC NULLS FIRST LIMIT 1`, 
                [reqData.user_id, reqData.date]
            );
            
            const hist = { changedAt: new Date(), changedBy: s.displayName, type: "Antragsgenehmigung" };

            if(bRes.rows.length > 0) {
                // Update
                const b = bRes.rows[0];
                let hArr = b.history || []; hArr.push(hist);
                await pool.query(
                    `UPDATE bookings SET start_time=$1, end_time=$2, remarks=$3, history=$4, is_edited=TRUE WHERE id=$5`, 
                    [reqData.new_start, reqData.new_end, `Korrektur: ${reqData.reason}`, JSON.stringify(hArr), b.id]
                );
            } else {
                // Insert
                await pool.query(
                    `INSERT INTO bookings (user_id, date, start_time, end_time, type, remarks, history, is_edited) 
                     VALUES ($1, $2, $3, $4, $5, $6, $7, TRUE)`, 
                    [reqData.user_id, reqData.date, reqData.new_start, reqData.new_end, reqData.type || 'Korrektur', `Nachtrag: ${reqData.reason}`, JSON.stringify([hist])]
                );
            }
        }
        res.json({status:"success"});
    } catch(e) { res.status(500).json({}); }
});

// 10. USER LISTE LADEN
app.get('/zes/api/v1/users', async (req, res) => {
    const s = getSession(req, res); if(!s) return;
    try {
        const r = await pool.query(
            `SELECT id, display_name as "displayName", role, daily_target as "dailyTarget", vacation_days as "vacationDays" 
             FROM users WHERE customer_id = $1`, 
            [s.customerId]
        );
        res.json(r.rows);
    } catch (e) { res.status(500).json({}); }
});

// 11. ESP32 STEMPELUNG (Der Herzschlag)
app.post('/zes/api/v1/stamp', async (req, res) => {
    const { cardId } = req.body;
    if(!cardId) return res.status(400).json({});
    try {
        const uRes = await pool.query('SELECT * FROM users WHERE card_id = $1', [cardId]);
        if(uRes.rows.length===0) return res.status(404).json({message:"Unknown"});
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

// --- FALLBACK ROUTE ---
// Wichtig für Single Page Apps (damit Refresh auf Unterseiten funktionieren würde, falls wir Routing hätten)
app.get(/\/zes\/.*/, (req, res) => {
    const pI = path.join(__dirname, 'public', 'index.html');
    if (require('fs').existsSync(pI)) res.sendFile(pI); 
    else res.sendFile(path.join(__dirname, 'index.html'));
});
app.get('/zes', (req, res) => res.redirect('/zes/'));

app.listen(port, '0.0.0.0', () => console.log(`Server running on ${port}`));