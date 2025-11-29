const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const app = express();
const port = 3001;
const DB_FILE = path.join(__dirname, 'database.json');
const UPLOADS_DIR = path.join(__dirname, 'uploads');

if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR);

const storage = multer.diskStorage({
    destination: function (req, file, cb) { cb(null, UPLOADS_DIR) },
    filename: function (req, file, cb) { cb(null, Date.now() + '-' + file.originalname.replace(/\s+/g, '_')) }
});
const upload = multer({ storage: storage });

app.use(cors());
app.use(express.json());
app.use('/uploads', express.static(UPLOADS_DIR));

// Datenbank Initialisierung
function initDB() {
    if (!fs.existsSync(DB_FILE)) {
        const initialData = { 
            clients: [{id:1, name:"McKensy"}], 
            users: [
                { id: 101, clientId: 1, username: "admin", password: "123", role: "admin", displayName: "Administrator", dailyTarget: 8.0, vacationDays: 30 },
                { id: 102, clientId: 1, username: "ma", password: "123", role: "user", displayName: "Max Muster", dailyTarget: 8.0, vacationDays: 30 }
            ], 
            bookings: [], requests: [], auditLog: [] 
        };
        fs.writeFileSync(DB_FILE, JSON.stringify(initialData, null, 2));
    }
}
initDB();

function readDB() { try { return JSON.parse(fs.readFileSync(DB_FILE, 'utf8')); } catch (e) { return {}; } }
function writeDB(data) { fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2)); }

let sessionStore = {};

function getSession(req, res) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (!token || !sessionStore[token]) {
        if (res) res.status(401).json({ message: "Nicht authentifiziert" });
        return null;
    }
    return sessionStore[token];
}

// Audit Log Funktion (Systemprotokoll)
function createAuditEntry(db, userStr, action, module, oldValue, newValue) {
    const entry = { 
        id: Date.now(), 
        timestamp: new Date().toISOString(), 
        actor: userStr, 
        action: action, 
        module: module,
        oldValue: oldValue || '-',
        newValue: newValue || '-'
    };
    if (!db.auditLog) db.auditLog = [];
    db.auditLog.push(entry);
    // Behalte nur die letzten 5000 Einträge
    if(db.auditLog.length > 5000) db.auditLog.shift(); 
}

// --- ROUTES ---

// Login
app.post('/api/v1/login', (req, res) => {
    const { username, password } = req.body;
    const db = readDB();
    const user = db.users.find(u => u.username === username && u.password === password);
    if (user) {
        const client = db.clients ? db.clients.find(c => c.id === user.clientId) : { name: "Unbekannt" };
        const token = crypto.randomBytes(32).toString('hex');
        sessionStore[token] = { ...user, clientName: client ? client.name : "Firma" };
        createAuditEntry(db, user.displayName, "Login", "System", "-", "Erfolgreich");
        writeDB(db);
        const { password, ...userSafe } = user;
        res.json({ status: "success", token, user: { ...userSafe, clientName: client ? client.name : "Firma" } });
    } else { res.status(401).json({ message: "Login fehlgeschlagen" }); }
});

app.get('/api/v1/users', (req, res) => {
    const s = getSession(req, res); if(!s) return;
    const db = readDB();
    const safeUsers = db.users.filter(u => u.clientId === s.clientId).map(({password, ...u}) => u);
    res.json(safeUsers);
});

app.get('/api/v1/bookings', (req, res) => {
    const s = getSession(req, res); if(!s) return;
    const db = readDB();
    res.json(s.role === 'admin' ? db.bookings : db.bookings.filter(b => b.userId === s.id));
});

app.get('/api/v1/requests', (req, res) => {
    const s = getSession(req, res); if(!s) return;
    const db = readDB();
    res.json(s.role === 'admin' ? db.requests : db.requests.filter(r => r.userId === s.id));
});

// Stempeln (Live)
app.post('/api/v1/stamp-manual', (req, res) => {
    const s = getSession(req, res); if(!s) return;
    const { action } = req.body; 
    const db = readDB();
    const today = new Date().toISOString().split('T')[0];
    const nowTime = new Date().toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
    let booking = db.bookings.find(b => b.userId === s.id && b.date === today);
    
    if (action === 'start') {
        if (!booking) {
            db.bookings.push({ id: Date.now(), userId: s.id, date: today, start: nowTime, end: "", remarks: "", type: "work", history: [], isEdited: false });
            createAuditEntry(db, s.displayName, "Stempelung", "Terminal", "Abwesend", `KOMMEN ${nowTime}`);
        }
    } else if (action === 'end') {
        if (booking && !booking.end) {
            booking.end = nowTime;
            createAuditEntry(db, s.displayName, "Stempelung", "Terminal", "Anwesend", `GEHEN ${nowTime}`);
        }
    }
    writeDB(db);
    res.json({ status: "success", time: nowTime });
});

// Anträge erstellen
app.post('/api/v1/requests', upload.single('attachment'), (req, res) => {
    const s = getSession(req, res); if(!s) return;
    const { date, newStart, newEnd, reason, type, targetUserId } = req.body;
    
    if (type === 'Sonstiges' && (!reason || reason.trim() === '')) return res.status(400).json({ message: "Begründung fehlt." });

    const db = readDB();
    let userIdToBook = s.id;
    let status = 'pending';
    let autoApproved = false;

    if (s.role === 'admin' && targetUserId) {
        userIdToBook = parseInt(targetUserId);
        status = 'approved';
        autoApproved = true;
    }

    const newRequest = { 
        id: Date.now(), userId: userIdToBook, date, newStart, newEnd, reason, type: type || 'Korrektur', 
        attachment: req.file ? req.file.filename : null, status: status, requestedBy: s.displayName
    };
    
    db.requests.push(newRequest);
    createAuditEntry(db, s.displayName, "Antrag erstellt", "Workflow", "-", `Typ: ${type}, Ziel: ${userIdToBook}`);

    if (autoApproved) applyApprovedRequest(db, newRequest, s.displayName);

    writeDB(db);
    res.json({ status: "success" });
});

function applyApprovedRequest(db, r, actorName) {
    let booking = db.bookings.find(b => b.userId === r.userId && b.date === r.date);
    const hist = { changedAt: new Date().toISOString(), changedBy: actorName, type: `Antrag (${r.type})`, oldStart: booking?.start, oldEnd: booking?.end };
    
    let sTime = r.newStart;
    let eTime = r.newEnd;
    if((r.type === 'Urlaub' || r.type === 'Krank') && !sTime) { sTime = "08:00"; eTime = "16:00"; }

    if(booking) { 
        booking.start = sTime || booking.start; booking.end = eTime || booking.end; booking.type = r.type; booking.remarks = r.reason; 
        booking.history = [...(booking.history||[]), hist]; booking.isEdited = true;
    } else { 
        db.bookings.push({ id: Date.now(), userId: r.userId, date: r.date, start: sTime, end: eTime, type: r.type, remarks: r.reason, history: [hist], isEdited: true }); 
    }
}

app.put('/api/v1/requests/:id', (req, res) => {
    const s = getSession(req, res); if(!s || s.role !== 'admin') return res.status(403).json({ message: "Admin only" });
    const { status } = req.body;
    const db = readDB();
    const r = db.requests.find(r => r.id == req.params.id);
    if(!r) return res.status(404).json({message: "Nicht gefunden"});

    const oldStatus = r.status;
    r.status = status;
    createAuditEntry(db, s.displayName, "Antrag Status", "Workflow", oldStatus, status);
    if (status === 'approved') applyApprovedRequest(db, r, s.displayName);
    writeDB(db);
    res.json({ status: "success" });
});

// --- EDIT ROUTE (Journal Bearbeitung durch Admin) ---
app.put('/api/v1/bookings/:id', (req, res) => {
    const s = getSession(req, res); if(!s || s.role !== 'admin') return res.status(403).json({ message: "Admin only" });
    const { start, end, remarks } = req.body;
    if(!remarks) return res.status(400).json({ message: "Begründung für Änderung fehlt." });

    const db = readDB();
    const booking = db.bookings.find(b => b.id == req.params.id);
    
    if (booking) {
        // Logging alter Werte
        const oldVal = `Start: ${booking.start || '--'}, Ende: ${booking.end || '--'}`;
        const newVal = `Start: ${start}, Ende: ${end}`;
        
        // History im Datensatz
        booking.history = [...(booking.history||[]), { 
            changedAt: new Date().toISOString(), 
            changedBy: s.displayName, 
            type: "Admin Edit", 
            oldStart: booking.start, 
            oldEnd: booking.end, 
            reason: remarks 
        }];

        // Aktualisieren
        booking.start = start; 
        booking.end = end; 
        booking.remarks = remarks; 
        booking.isEdited = true; 
        
        // Systemprotokoll (GoBD)
        const affectedUser = db.users.find(u => u.id === booking.userId);
        const affectedName = affectedUser ? affectedUser.displayName : booking.userId;

        createAuditEntry(db, s.displayName, `Journal-Korrektur bei ${affectedName}`, "Journal", oldVal, newVal);
        
        writeDB(db);
        res.json({ status: "success" });
    } else { res.status(404).json({ message: "Eintrag nicht gefunden" }); }
});

app.get('/api/v1/history', (req, res) => {
    const s = getSession(req, res); if(!s) return;
    const db = readDB();
    res.json(s.role==='admin' ? db.auditLog.reverse() : []);
});

app.listen(port, '0.0.0.0', () => console.log(`Server läuft auf Port ${port}`));