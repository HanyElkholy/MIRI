const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer'); // Neu für Datei-Uploads

const app = express();
const port = 3001;
const DB_FILE = path.join(__dirname, 'database.json');
const UPLOADS_DIR = path.join(__dirname, 'uploads');

// Sicherstellen, dass der Upload-Ordner existiert
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR);

// Konfiguration für Dateispeicher
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, UPLOADS_DIR)
    },
    filename: function (req, file, cb) {
        // Sicherer Dateiname: Zeitstempel + Originalname
        cb(null, Date.now() + '-' + file.originalname.replace(/\s+/g, '_'))
    }
});
const upload = multer({ storage: storage });

const TERMINAL_API_KEY = "ahmtimus_secret_key_2025"; 

app.use(cors());
app.use(express.json());
// Um auf hochgeladene Dateien zuzugreifen (optional, falls Admin sie sehen will)
app.use('/uploads', express.static(UPLOADS_DIR)); 

// --- DATENBANK HELPER ---
function initDB() {
    if (!fs.existsSync(DB_FILE)) {
        const initialData = {
            users: [
                { id: 101, cardId: "B46D2D54", username: "admin", password: "123", role: "admin", displayName: "Herr Müller (Admin)", dailyTarget: 8.0 },
                { id: 102, cardId: "DEINE_UID_1", username: "nils", password: "123", role: "user", displayName: "Nils Müller", dailyTarget: 6.0 }, 
                { id: 103, cardId: "A1B2C3D4", username: "erika", password: "123", role: "user", displayName: "Erika Mustermann", dailyTarget: 8.0 }
            ],
            bookings: [],
            requests: [],
            auditLog: [] // NEU: Globale Historie
        };
        fs.writeFileSync(DB_FILE, JSON.stringify(initialData, null, 2));
    }
}
initDB();

function readDB() {
    try { return JSON.parse(fs.readFileSync(DB_FILE, 'utf8')); } 
    catch (err) { return { users: [], bookings: [], requests: [], auditLog: [] }; }
}

function writeDB(data) {
    fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
}

// --- SITZUNGSVERWALTUNG ---
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

function createAuditEntry(db, userStr, action, details) {
    const entry = {
        id: Date.now(),
        timestamp: new Date().toISOString(),
        actor: userStr,
        action: action,
        details: details
    };
    if (!db.auditLog) db.auditLog = [];
    db.auditLog.push(entry);
    // Behalte nur die letzten 1000 Einträge um Datei klein zu halten
    if(db.auditLog.length > 1000) db.auditLog.shift();
}

// --- API ENDPUNKTE ---

app.post('/api/v1/login', (req, res) => {
    const { username, password } = req.body;
    const db = readDB();
    const user = db.users.find(u => u.username === username && u.password === password);
    if (user) {
        const token = crypto.randomBytes(32).toString('hex');
        sessionStore[token] = { id: user.id, username: user.username, role: user.role, displayName: user.displayName, dailyTarget: user.dailyTarget || 8.0 };
        res.json({ status: "success", token, user: { id: user.id, role: user.role, displayName: user.displayName, dailyTarget: user.dailyTarget || 8.0 } });
    } else {
        res.status(401).json({ message: "Login fehlgeschlagen" });
    }
});

app.get('/api/v1/users', (req, res) => {
    const session = getSession(req, res);
    if (!session) return;
    const db = readDB();
    const safeUsers = db.users.map(u => ({ id: u.id, displayName: u.displayName, role: u.role, dailyTarget: u.dailyTarget || 8.0 }));
    res.json(safeUsers);
});

app.get('/api/v1/bookings', (req, res) => {
    const session = getSession(req, res);
    if (!session) return;
    const db = readDB();
    let bookings = db.bookings;
    if (session.role !== 'admin') bookings = bookings.filter(b => b.userId === session.id);
    res.json(bookings);
});

// Requests laden (mit Filter-Support könnte hier erweitert werden)
app.get('/api/v1/requests', (req, res) => {
    const session = getSession(req, res);
    if (!session) return;
    const db = readDB();
    let requests = db.requests;
    if (session.role !== 'admin') requests = requests.filter(r => r.userId === session.id);
    res.json(requests);
});

// NEU: Antrag erstellen (mit Datei-Upload)
app.post('/api/v1/requests', upload.single('attachment'), (req, res) => {
    const session = getSession(req, res);
    if (!session) return;
    
    // Daten kommen als Form-Data (Strings), müssen geparst werden
    const { date, newStart, newEnd, reason, type, targetUserId } = req.body;
    const file = req.file;

    const db = readDB();
    
    // Admin kann für andere beantragen
    let userIdToBook = session.id;
    let status = 'pending';
    
    if (session.role === 'admin' && targetUserId) {
        userIdToBook = parseInt(targetUserId);
        status = 'approved'; // Admin-Anträge sofort genehmigen
    }

    const newRequest = { 
        id: Date.now(), 
        userId: userIdToBook, 
        date, 
        newStart, 
        newEnd, 
        reason, 
        type: type || 'Korrektur', // Korrektur, Urlaub, Krank, Sonstiges
        attachment: file ? file.filename : null,
        status: status,
        requestedBy: session.displayName
    };
    
    db.requests.push(newRequest);

    // Audit Log
    createAuditEntry(db, session.displayName, "Antrag erstellt", `Typ: ${newRequest.type}, für UserID: ${userIdToBook}`);

    // Wenn Admin erstellt, Logik für sofortige Buchungsanpassung ausführen (ähnlich wie PUT)
    if (status === 'approved') {
        applyApprovedRequest(db, newRequest, session.displayName);
    }

    writeDB(db);
    res.json({ status: "success" });
});

// Helper Funktion um Code-Duplizierung zu vermeiden
function applyApprovedRequest(db, r, actorName) {
    let booking = db.bookings.find(b => b.userId === r.userId && b.date === r.date);
    
    const historyEntry = {
        changedAt: new Date().toISOString(),
        changedBy: actorName,
        type: `Antrag (${r.type})`,
        oldStart: booking ? booking.start : null,
        oldEnd: booking ? booking.end : null
    };

    let remarkText = `${r.type}: ${r.reason}`;
    
    if (booking) {
        if(!booking.history) booking.history = [];
        booking.history.push(historyEntry);
        booking.start = r.newStart;
        booking.end = r.newEnd;
        booking.remarks = remarkText;
        booking.isEdited = true;
        booking.type = r.type; // Speichern des Typs auch in der Buchung
    } else {
        db.bookings.push({
            id: Date.now(), userId: r.userId, date: r.date, start: r.newStart, end: r.newEnd, 
            remarks: remarkText, type: r.type, history: [historyEntry], isEdited: true
        });
    }
}

app.put('/api/v1/requests/:id', (req, res) => {
    const session = getSession(req, res);
    if (!session || session.role !== 'admin') return res.status(403).json({ message: "Nur Admins" });
    
    const reqId = parseInt(req.params.id);
    const { status } = req.body;
    const db = readDB();
    const idx = db.requests.findIndex(r => r.id === reqId);
    
    if (idx === -1) return res.status(404).json({ message: "Nicht gefunden" });
    
    const oldStatus = db.requests[idx].status;
    db.requests[idx].status = status;

    createAuditEntry(db, session.displayName, "Antragsstatus geändert", `ID: ${reqId}, Von ${oldStatus} zu ${status}`);

    if (status === 'approved') {
        applyApprovedRequest(db, db.requests[idx], session.username);
    }
    writeDB(db);
    res.json({ status: "success" });
});

// Buchung direkt bearbeiten
app.put('/api/v1/bookings/:id', (req, res) => {
    const session = getSession(req, res);
    if (!session || session.role !== 'admin') return res.status(403).json({ message: "Nur Admins" });

    const bId = parseInt(req.params.id);
    const { start, end, remarks } = req.body;
    
    if(!remarks || remarks.trim() === "") {
         return res.status(400).json({ message: "Ein Grund (Bemerkung) ist zwingend erforderlich." });
    }

    const db = readDB();
    const booking = db.bookings.find(b => b.id === bId);

    if (booking) {
        const historyEntry = {
            changedAt: new Date().toISOString(),
            changedBy: session.displayName,
            type: "Manuelle Korrektur",
            oldStart: booking.start,
            oldEnd: booking.end,
            oldRemarks: booking.remarks
        };
        
        if (!booking.history) booking.history = [];
        booking.history.push(historyEntry);

        booking.start = start;
        booking.end = end;
        booking.remarks = remarks;
        booking.isEdited = true;

        createAuditEntry(db, session.displayName, "Buchung bearbeitet", `ID: ${bId}, Neuer Grund: ${remarks}`);

        writeDB(db);
        res.json({ status: "success" });
    } else {
        res.status(404).json({ message: "Buchung nicht gefunden" });
    }
});

// NEU: Globale Historie abrufen
app.get('/api/v1/history', (req, res) => {
    const session = getSession(req, res);
    if (!session) return;
    const db = readDB();
    
    // Admin sieht alles, User sieht nur Aktionen die IHN betreffen (komplexer filter) oder nur eigene Anträge?
    // Einfachheitshalber: Admin sieht AuditLog, User sieht History in seinen Buchungen (bereits implementiert in /bookings).
    // Wir senden hier das AuditLog für Admins.
    
    if (session.role === 'admin') {
        res.json(db.auditLog.reverse()); // Neueste zuerst
    } else {
        res.status(403).json({ message: "Zugriff verweigert" });
    }
});

// Stempelung API
let liveStampData = []; 
app.post('/api/v1/stamp', (req, res) => {
  const { cardId } = req.body; 
  const db = readDB(); // Immer frisch lesen
  
  // User finden
  const user = db.users.find(u => u.cardId === cardId);
  
  if (!user) {
    console.log(`WARNUNG: Unbekannte Karte: ${cardId}`);
    return res.status(404).json({ status: "error", message: "Karte unbekannt" });
  }

  const today = new Date().toISOString().split('T')[0];
  const nowTime = new Date().toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });

  // Letzte Buchung finden
  let booking = db.bookings.find(b => b.userId === user.id && b.date === today);
  let type = "Kommen";

  if (booking) {
      if (!booking.end) {
          // Hat schon Kommen, also Gehen
          booking.end = nowTime;
          type = "Gehen";
      } else {
          // Hat schon Gehen, neues Kommen (sehr einfach gehalten, idealerweise neue Zeile oder Pause Logik)
          // Für diese Demo überschreiben wir nicht, sondern loggen nur, dass der Tag eigentlich fertig ist, 
          // oder erstellen eine zweite Buchung für den Tag (hier vereinfacht: Update Ende)
          booking.end = nowTime; // Update Endzeit
          type = "Gehen (Update)";
      }
  } else {
      // Neue Buchung
      db.bookings.push({
          id: Date.now(), userId: user.id, date: today, start: nowTime, end: "", 
          remarks: "", type: "valid", history: [], isEdited: false
      });
  }
  
  writeDB(db);
  console.log(`Stempelung: ${user.username} - ${type}`);
  res.status(200).json({ status: "success", user: user.displayName, type });
});

app.listen(port, '0.0.0.0', () => {
    console.log(`Ahmtimus Pro V2 läuft auf Port ${port}`);
});