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
app.use(helmet({ contentSecurityPolicy: false })); // CSP entspannt für Tailwind CDN
app.use(cors());
app.use(express.json()); // WICHTIG für JSON Body

const limiter = rateLimit({ windowMs: 15*60*1000, max: 200 });
app.use('/zes/api', limiter);

// --- FRONTEND ---
app.use('/zes', express.static(path.join(__dirname, 'public')));
app.use('/zes', express.static(__dirname));

// --- DB ---
const pool = new Pool({
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.DB_NAME,
  password: process.env.DB_PASSWORD,
  port: process.env.DB_PORT,
});

// --- SESSION ---
let sessionStore = {};
function getSession(req, res) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (!token || !sessionStore[token]) {
        if(res) res.status(401).json({ message: "Auth Error" });
        return null;
    }
    return sessionStore[token];
}

// --- HELPER: LOGBUCH SCHREIBEN ---
async function logAudit(customerId, actor, module, action, oldVal, newVal) {
    try {
        await pool.query(
            `INSERT INTO audit_logs (customer_id, actor, module, action, old_value, new_value) 
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [customerId, actor, module, action, oldVal, newVal]
        );
    } catch(e) { console.error("Audit Error", e); }
}

// ==================================================================
// API ENDPUNKTE
// ==================================================================

// 1. LOGIN (Erweitert um ClientName und VacationDays)
app.post('/zes/api/v1/login', async (req, res) => {
    const { username, password } = req.body;
    try {
        // Wir holen auch den Firmennamen (c.name)
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
                sessionStore[token] = { 
                    id: user.id, username: user.username, role: user.role, 
                    displayName: user.display_name, customerId: user.customer_id 
                };
                
                // Login loggen
                logAudit(user.customer_id, user.display_name, 'AUTH', 'Login', '', 'Success');

                res.json({ 
                    status: "success", token, 
                    user: { 
                        id: user.id, 
                        role: user.role, 
                        displayName: user.display_name, 
                        clientName: user.client_name, // Fürs Frontend
                        vacationDays: user.vacation_days, // Fürs Frontend
                        dailyTarget: user.daily_target 
                    } 
                });
            } else { res.status(401).json({ message: "Passwort falsch" }); }
        } else { res.status(401).json({ message: "User unbekannt" }); }
    } catch (err) { console.error(err); res.status(500).json({ error: "DB Error" }); }
});

// 2. MANUELLES STEMPELN (Web-Terminal) - NEU!
app.post('/zes/api/v1/stamp-manual', async (req, res) => {
    const session = getSession(req, res);
    if (!session) return;
    
    const { action } = req.body; // 'start' oder 'end'
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
            // Finde offene Buchung
            const open = await pool.query(
                `SELECT id FROM bookings WHERE user_id=$1 AND date=$2 AND end_time IS NULL`,
                [session.id, dateStr]
            );
            if(open.rows.length > 0) {
                await pool.query(`UPDATE bookings SET end_time=$1 WHERE id=$2`, [timeStr, open.rows[0].id]);
            } else {
                // Fehler: Gehen ohne Kommen -> ignorieren oder Fehler senden
                return res.json({ status: "error", message: "Nicht eingestempelt" });
            }
        }
        res.json({ status: "success" });
    } catch(e) { res.status(500).json({ error: "DB Error" }); }
});

// 3. SYSTEMPROTOKOLL LADEN - NEU!
app.get('/zes/api/v1/history', async (req, res) => {
    const session = getSession(req, res);
    if (!session || session.role !== 'admin') return res.status(403).json({});
    
    try {
        const r = await pool.query(
            `SELECT timestamp, actor, module, action, old_value as "oldValue", new_value as "newValue" 
             FROM audit_logs WHERE customer_id = $1 ORDER BY timestamp DESC LIMIT 100`,
            [session.customerId]
        );
        res.json(r.rows);
    } catch(e) { res.status(500).json({}); }
});

// 4. BUCHUNGEN LADEN
app.get('/zes/api/v1/bookings', async (req, res) => {
    const session = getSession(req, res); if (!session) return;
    try {
        let q = `SELECT id, user_id as "userId", TO_CHAR(date, 'YYYY-MM-DD') as date, TO_CHAR(start_time, 'HH24:MI') as start, TO_CHAR(end_time, 'HH24:MI') as end, type, remarks, history, is_edited as "isEdited" FROM bookings WHERE user_id IN (SELECT id FROM users WHERE customer_id = $1)`;
        let p = [session.customerId];
        if (session.role !== 'admin') { q += ' AND user_id = $2'; p.push(session.id); }
        q += ' ORDER BY date DESC, start_time DESC LIMIT 500';
        const r = await pool.query(q, p); res.json(r.rows);
    } catch (err) { res.status(500).json({}); }
});

// 5. ANTRÄGE & EDITIEREN
app.get('/zes/api/v1/requests', async (req, res) => {
    const s = getSession(req, res); if(!s) return;
    try {
        let q = `SELECT id, user_id as "userId", TO_CHAR(date, 'YYYY-MM-DD') as date, TO_CHAR(new_start, 'HH24:MI') as "newStart", TO_CHAR(new_end, 'HH24:MI') as "newEnd", reason, status, type as reqType FROM requests WHERE user_id IN (SELECT id FROM users WHERE customer_id = $1)`;
        let p = [s.customerId];
        if(s.role!=='admin'){ q+=' AND user_id = $2'; p.push(s.id); }
        const r = await pool.query(q, p); res.json(r.rows);
    } catch(e){ res.status(500).json({}); }
});

app.post('/zes/api/v1/requests', async (req, res) => {
    const s = getSession(req, res); if(!s) return;
    const { date, newStart, newEnd, reason, type } = req.body;
    try { 
        await pool.query('INSERT INTO requests (user_id, date, new_start, new_end, reason, status) VALUES ($1,$2,$3,$4,$5,$6)', [s.id, date, newStart, newEnd, reason || type, 'pending']);
        res.json({status:"success"}); 
    } catch(e){ res.status(500).json({}); }
});

app.put('/zes/api/v1/bookings/:id', async (req, res) => {
    const s = getSession(req, res); if(!s || s.role !== 'admin') return res.status(403).json({});
    const { start, end, remarks } = req.body;
    try {
        const old = await pool.query('SELECT * FROM bookings WHERE id=$1', [req.params.id]);
        const oldB = old.rows[0];
        logAudit(s.customerId, s.displayName, 'BOOKING', 'Edit', `${oldB.start_time}-${oldB.end_time}`, `${start}-${end}`);
        
        let hArr = oldB.history || [];
        hArr.push({ changedAt: new Date(), changedBy: s.displayName, type: "Korrektur", oldStart: oldB.start_time, oldEnd: oldB.end_time });
        
        await pool.query('UPDATE bookings SET start_time=$1, end_time=$2, remarks=$3, history=$4, is_edited=TRUE WHERE id=$5', [start, end, remarks, JSON.stringify(hArr), req.params.id]);
        res.json({status:"success"});
    } catch(e){ res.status(500).json({}); }
});

app.put('/zes/api/v1/requests/:id', async (req, res) => {
    const s = getSession(req, res); if(!s || s.role !== 'admin') return res.status(403).json({});
    const { status } = req.body;
    try {
        await pool.query('UPDATE requests SET status=$1 WHERE id=$2', [status, req.params.id]);
        logAudit(s.customerId, s.displayName, 'REQUEST', status, req.params.id, '');
        
        if (status === 'approved') {
            const reqData = (await pool.query('SELECT * FROM requests WHERE id=$1', [req.params.id])).rows[0];
            // Logik: Antrag übernehmen (Insert oder Update) -> Hier vereinfacht:
            // Check ob Buchung existiert... (Dein alter Code war hier gut, ich füge ihn verkürzt ein)
            const bRes = await pool.query('SELECT * FROM bookings WHERE user_id=$1 AND date=$2', [reqData.user_id, reqData.date]);
            if(bRes.rows.length>0) {
                await pool.query('UPDATE bookings SET start_time=$1, end_time=$2, remarks=$3 WHERE id=$4', [reqData.new_start, reqData.new_end, 'Antrag', bRes.rows[0].id]);
            } else {
                await pool.query('INSERT INTO bookings (user_id, date, start_time, end_time, type) VALUES ($1,$2,$3,$4,$5)', [reqData.user_id, reqData.date, reqData.new_start, reqData.new_end, 'Korrektur']);
            }
        }
        res.json({status:"success"});
    } catch(e) { res.status(500).json({}); }
});

app.get('/zes/api/v1/users', async (req, res) => {
    const s = getSession(req, res); if (!s) return;
    try {
        const r = await pool.query(`SELECT id, display_name as "displayName", role, daily_target as "dailyTarget" FROM users WHERE customer_id = $1`, [s.customerId]);
        res.json(r.rows);
    } catch (e) { res.status(500).json({}); }
});

// 6. ESP32 STEMPELN
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

// Fallback
app.get(/\/zes\/.*/, (req, res) => {
    const pI = path.join(__dirname, 'public', 'index.html');
    if (require('fs').existsSync(pI)) res.sendFile(pI); else res.sendFile(path.join(__dirname, 'index.html'));
});
app.get('/zes', (req, res) => res.redirect('/zes/'));

app.listen(port, '0.0.0.0', () => console.log(`Server on ${port}`));