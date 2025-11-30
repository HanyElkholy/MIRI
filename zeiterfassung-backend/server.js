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

// --- HELPER: LOGBUCH SCHREIBEN (Mit betroffenem User) ---
async function logAudit(customerId, actor, action, oldVal, newVal, affectedUser) {
    try {
        await pool.query(
            `INSERT INTO audit_logs (customer_id, actor, action, old_value, new_value, affected_user) 
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [customerId, actor, action, oldVal, newVal, affectedUser || actor] // Fallback: Betrifft sich selbst
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

// NEUER ENDPUNKT: PASSWORT ÄNDERN (Ohne Logout bei Fehler)
app.put('/zes/api/v1/password', async (req, res) => {
    const session = getSession(req, res);
    if (!session) return; 

    const { oldPassword, newPassword } = req.body;

    try {
        const result = await pool.query('SELECT password FROM users WHERE id = $1', [session.id]);
        if (result.rows.length === 0) return res.status(404).json({ message: "User weg" });
        
        const currentHash = result.rows[0].password;

        const match = await bcrypt.compare(oldPassword, currentHash);
        
        // --- HIER IST DIE ÄNDERUNG ---
        if (!match) {
            // Sende 200 OK, aber mit Fehlermeldung im Text
            return res.json({ status: "error", message: "Das alte Passwort ist falsch." });
        }
        // -----------------------------

        const newHash = await bcrypt.hash(newPassword, 10);
        await pool.query('UPDATE users SET password = $1 WHERE id = $2', [newHash, session.id]);

        logAudit(session.customerId, session.displayName, 'AUTH', 'Passwort geändert', '', '');

        res.json({ status: "success", message: "Passwort geändert" });

    } catch (e) {
        console.error(e);
        res.status(500).json({ error: "Serverfehler" });
    }
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

// 4. HISTORY LADEN
app.get('/zes/api/v1/history', async (req, res) => {
    const session = getSession(req, res); 
    if(!session) return res.status(401).json({});
    
    try {
        let query = `
            SELECT 
                timestamp, 
                actor, 
                action, 
                old_value as "oldValue", 
                new_value as "newValue", 
                affected_user as "affectedUser"
            FROM audit_logs 
            WHERE customer_id = $1
        `;
        let params = [session.customerId];

        // Debugging
        console.log(`🔎 HISTORY CHECK:`);
        console.log(`   - Wer fragt an? "${session.displayName}"`);
        console.log(`   - Rolle: ${session.role}`);

        if (session.role !== 'admin') {
            query += ' AND (actor = $2 OR affected_user = $2)';
            params.push(session.displayName);
            console.log(`   - Filter aktiv für: '${session.displayName}'`);
        }

        query += ' ORDER BY timestamp DESC LIMIT 100';

        const r = await pool.query(query, params);
        console.log(`   - Gefundene Zeilen: ${r.rows.length}`);
        
        res.json(r.rows);
    } catch(e) { 
        console.error(e);
        res.status(500).json({}); 
    }
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


// 5. ANTRAG ERSTELLEN (Mit Logging)
app.post('/zes/api/v1/requests', async (req, res) => {
    const s = getSession(req, res); 
    if (!s) return;
    
    const { date, newStart, newEnd, reason, type } = req.body;

    try { 
        await pool.query(
            `INSERT INTO requests (user_id, date, new_start, new_end, reason, status, type) 
             VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [s.id, date, newStart, newEnd, reason, 'pending', type || 'Sonstiges']
        );

        // NEU: Wir protokollieren, dass Mehmet (s.displayName) etwas getan hat!
        // Akteur: Mehmet, Betroffener: Mehmet
        logAudit(s.customerId, s.displayName, 'Antrag', 'Erstellt', type || 'Sonstiges', 'Offen', s.displayName);

        res.json({ status: "success" }); 
    } catch (err) { 
        console.error(err);
        res.status(500).json({ error: "Fehler beim Speichern" }); 
    }
});

// 1. BENACHRICHTIGUNGEN (Status abrufen) - UPDATED
app.get('/zes/api/v1/notifications', async (req, res) => {
    const s = getSession(req, res); if (!s) return;
    
    try {
        let result = { items: [] };

        if (s.role === 'admin') {
            // ADMIN: Hole Details der offenen Anträge (Name, Typ, Datum)
            // Wir joinen mit 'users', um den Namen des Antragstellers zu bekommen
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
            // USER: Anträge, die fertig sind, aber noch nicht gesehen wurden
            // Wir holen auch das Datum dazu
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
        
        // Count berechnen wir einfach aus der Länge der Liste
        result.count = result.items.length;

        res.json(result);
    } catch (e) { res.status(500).json({ error: "DB Error" }); }
});

// 2. Als gelesen markieren (Nur für User relevant)
app.post('/zes/api/v1/notifications/read', async (req, res) => {
    const s = getSession(req, res); if (!s) return;
    try {
        // Setze alle fertigen Anträge dieses Users auf 'seen'
        await pool.query(
            `UPDATE requests SET user_seen = TRUE 
             WHERE user_id = $1 AND status != 'pending'`,
            [s.id]
        );
        res.json({ status: "success" });
    } catch (e) { res.status(500).json({}); }
});

app.put('/zes/api/v1/bookings/:id', async (req, res) => {
    const s = getSession(req, res); 
    if(!s || s.role !== 'admin') return res.status(403).json({});
    
    const { start, end, remarks } = req.body;
    try {
        // 1. Alte Daten UND den Namen des Besitzers holen (JOIN)
        const oldRes = await pool.query(
            `SELECT b.*, u.display_name as username 
             FROM bookings b 
             JOIN users u ON b.user_id = u.id 
             WHERE b.id = $1`, 
            [req.params.id]
        );
        
        if(oldRes.rows.length === 0) return res.status(404).json({message:"Not found"});
        const oldB = oldRes.rows[0];
        
        // 2. Loggen: Admin ändert Daten von 'oldB.username'
        logAudit(s.customerId, s.displayName, 'Bearbeitet', `${oldB.start_time}-${oldB.end_time}`, `${start}-${end}`, oldB.username);
        
        // 3. Update (wie vorher)
        let hArr = oldB.history || [];
        hArr.push({ changedAt: new Date(), changedBy: s.displayName, type: "Korrektur", oldStart: oldB.start_time, oldEnd: oldB.end_time });
        
        await pool.query('UPDATE bookings SET start_time=$1, end_time=$2, remarks=$3, history=$4, is_edited=TRUE WHERE id=$5', [start, end, remarks, JSON.stringify(hArr), req.params.id]);
        res.json({status:"success"});
    } catch(e){ console.error(e); res.status(500).json({}); }
});

// 9. ANTRAG GENEHMIGEN (Mit intelligenter Suche)
// 6. ANTRAG BEARBEITEN (Admin -> Mehmet)
app.put('/zes/api/v1/requests/:id', async (req, res) => {
    const s = getSession(req, res); 
    if(!s || s.role !== 'admin') return res.status(403).json({});
    
    const { status } = req.body; 
    const reqId = req.params.id;

    try {
        // 1. ZUERST: Wem gehört der Antrag? (Namen holen!)
        const reqRes = await pool.query(
            `SELECT r.*, u.display_name as username 
             FROM requests r 
             JOIN users u ON r.user_id = u.id 
             WHERE r.id = $1`, 
            [reqId]
        );
        
        if (reqRes.rows.length === 0) return res.status(404).json({ message: "Antrag weg" });
        const reqData = reqRes.rows[0];

        // 2. Status updaten
        await pool.query('UPDATE requests SET status = $1 WHERE id = $2', [status, reqId]);

        // 3. LOGGEN: Akteur = Luigi (Session), Betroffener = Mehmet (reqData.username)
        const actionText = status === 'approved' ? 'Genehmigt' : 'Abgelehnt';
        logAudit(s.customerId, s.displayName, `Antrag (${reqData.type})`, reqData.status, status, reqData.username);
        
        // 4. Buchung anpassen (nur bei Genehmigung)
        if (status === 'approved') {
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
                    [reqData.user_id, reqData.date, reqData.new_start, reqData.new_end, 'valid', `Nachtrag: ${reqData.reason}`, JSON.stringify([hist])]
                );
            }
        }
        res.json({status:"success"});
    } catch(e) { 
        console.error(e);
        res.status(500).json({}); 
    }
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