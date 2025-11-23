const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();
const port = 3001;
const DB_FILE = path.join(__dirname, 'database.json');

// API Key für Terminal-Sicherheit (Logik bleibt erhalten, Hardware wird ignoriert)
const TERMINAL_API_KEY = "ahmtimus_secret_key_2025"; 

app.use(cors());
app.use(express.json());

// --- DATENBANK INITIALISIERUNG ---
function initDB() {
    if (!fs.existsSync(DB_FILE)) {
        const initialData = {
            users: [
                // dailyTarget = Soll-Stunden pro Tag
                { id: 101, cardId: "B46D2D54", username: "admin", password: "123", role: "admin", displayName: "Herr Müller (Admin)", dailyTarget: 8.0 },
                { id: 102, cardId: "DEINE_UID_1", username: "nils", password: "123", role: "user", displayName: "Nils Müller", dailyTarget: 6.0 }, 
                { id: 103, cardId: "A1B2C3D4", username: "erika", password: "123", role: "user", displayName: "Erika Mustermann", dailyTarget: 8.0 }
            ],
            bookings: [], // Buchungen
            requests: []  // Anträge
        };
        fs.writeFileSync(DB_FILE, JSON.stringify(initialData, null, 2));
    }
}
initDB();

function readDB() {
    try { return JSON.parse(fs.readFileSync(DB_FILE, 'utf8')); } 
    catch (err) { return { users: [], bookings: [], requests: [] }; }
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

// --- API ENDPUNKTE ---

// Login
app.post('/api/v1/login', (req, res) => {
    const { username, password } = req.body;
    const db = readDB();
    const user = db.users.find(u => u.username === username && u.password === password);

    if (user) {
        const token = crypto.randomBytes(32).toString('hex');
        sessionStore[token] = { 
            id: user.id, username: user.username, role: user.role, displayName: user.displayName,
            dailyTarget: user.dailyTarget || 8.0 
        };
        res.json({ 
            status: "success", token, 
            user: { id: user.id, role: user.role, displayName: user.displayName, dailyTarget: user.dailyTarget || 8.0 } 
        });
    } else {
        res.status(401).json({ message: "Login fehlgeschlagen" });
    }
});

// Benutzerliste (für Admin & Filter)
app.get('/api/v1/users', (req, res) => {
    const session = getSession(req, res);
    if (!session) return;
    const db = readDB();
    const safeUsers = db.users.map(u => ({ 
        id: u.id, displayName: u.displayName, role: u.role, dailyTarget: u.dailyTarget || 8.0 
    }));
    res.json(safeUsers);
});

// Buchungen laden
app.get('/api/v1/bookings', (req, res) => {
    const session = getSession(req, res);
    if (!session) return;
    const db = readDB();
    let bookings = db.bookings;
    if (session.role !== 'admin') bookings = bookings.filter(b => b.userId === session.id);
    res.json(bookings);
});

// Anträge laden
app.get('/api/v1/requests', (req, res) => {
    const session = getSession(req, res);
    if (!session) return;
    const db = readDB();
    let requests = db.requests;
    if (session.role !== 'admin') requests = requests.filter(r => r.userId === session.id);
    res.json(requests);
});

// Antrag erstellen
app.post('/api/v1/requests', (req, res) => {
    const session = getSession(req, res);
    if (!session) return;
    const { date, newStart, newEnd, reason } = req.body;
    const db = readDB();
    const newRequest = { id: Date.now(), userId: session.id, date, newStart, newEnd, reason, status: 'pending' };
    db.requests.push(newRequest);
    writeDB(db);
    res.json({ status: "success" });
});

// Antrag bearbeiten (Genehmigen/Ablehnen) - MIT AUDIT TRAIL
app.put('/api/v1/requests/:id', (req, res) => {
    const session = getSession(req, res);
    if (!session || session.role !== 'admin') return res.status(403).json({ message: "Nur Admins" });
    
    const reqId = parseInt(req.params.id);
    const { status } = req.body;
    const db = readDB();
    const idx = db.requests.findIndex(r => r.id === reqId);
    
    if (idx === -1) return res.status(404).json({ message: "Nicht gefunden" });
    db.requests[idx].status = status;

    if (status === 'approved') {
        const r = db.requests[idx];
        let booking = db.bookings.find(b => b.userId === r.userId && b.date === r.date);
        
        // DSGVO Audit Eintrag erstellen
        const historyEntry = {
            changedAt: new Date().toISOString(),
            changedBy: session.username,
            type: "Antragsgenehmigung",
            oldStart: booking ? booking.start : null,
            oldEnd: booking ? booking.end : null
        };

        if (booking) {
            if(!booking.history) booking.history = [];
            booking.history.push(historyEntry);
            booking.start = r.newStart;
            booking.end = r.newEnd;
            booking.remarks = `Korrektur: ${r.reason}`;
            booking.isEdited = true;
        } else {
            db.bookings.push({
                id: Date.now(), userId: r.userId, date: r.date, start: r.newStart, end: r.newEnd, 
                remarks: `Nachtrag: ${r.reason}`, type: 'valid', history: [historyEntry], isEdited: true
            });
        }
    }
    writeDB(db);
    res.json({ status: "success" });
});

// Buchung direkt bearbeiten (Admin) - MIT AUDIT TRAIL
app.put('/api/v1/bookings/:id', (req, res) => {
    const session = getSession(req, res);
    if (!session || session.role !== 'admin') return res.status(403).json({ message: "Nur Admins" });

    const bId = parseInt(req.params.id);
    const { start, end, remarks } = req.body; // Pause könnte hier erweitert werden
    const db = readDB();
    const booking = db.bookings.find(b => b.id === bId);

    if (booking) {
        // DSGVO Audit Eintrag
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

        // Neue Werte
        booking.start = start;
        booking.end = end;
        booking.remarks = remarks;
        booking.isEdited = true;

        writeDB(db);
        res.json({ status: "success" });
    } else {
        res.status(404).json({ message: "Buchung nicht gefunden" });
    }
});

// Stempelung (Simulation Hardware-Eingang)
app.post('/api/v1/stamp', (req, res) => {
  const { cardId } = req.body; 
  
  if (!cardId) {
    console.log("FEHLER: /api/v1/stamp - Keine cardId gesendet.");
    return res.status(400).json({ status: "error", message: "Keine cardId gesendet" });
  }

  // Finde den Benutzer in unserer "Datenbank"
  const userName = userDatabase[cardId];
  if (!userName) {
    console.log(`WARNUNG: Unbekannte Karten-ID erhalten: ${cardId}`);
    return res.status(404).json({ status: "error", message: "Karte nicht bekannt" });
  }

  console.log(`✅ Stempelung erhalten von: ${userName} (ID: ${cardId})`);

  // --- NEUE KOMMEN/GEHEN LOGIK ---
  let newType = "Kommen"; // Standard-Aktion ist "Kommen"

  // 1. Finde den letzten Stempel-Eintrag für *diesen* Benutzer
  //    (Wir durchsuchen das Array von oben nach unten, da 'unshift' das Neueste vorne anfügt)
  const lastStamp = liveStampData.find(stamp => stamp.user === userName);

  if (lastStamp) {
    // 2. Wenn der letzte Eintrag "Kommen" war, muss der neue "Gehen" sein
    if (lastStamp.type === "Kommen") {
      newType = "Gehen";
    }
    // 3. Wenn der letzte Eintrag "Gehen" war, ist der neue "Kommen"
    //    (Das deckt auch "Pause Ende" etc. ab)
    else {
      newType = "Kommen";
    }
  } else {
    // 4. Wenn kein Eintrag gefunden wurde (erster Scan überhaupt), ist es "Kommen"
    newType = "Kommen";
  }
  // --- ENDE DER NEUEN LOGIK ---

  // Erstelle den neuen Datensatz mit dem ermittelten Typ
  const newStamp = {
    id: nextId++,
    user: userName,
    time: new Date().toISOString(), // Aktuelle Server-Zeit
    type: newType // Hier wird der neue Status ("Kommen" or "Gehen") eingetragen
  };

  // Füge den neuen Datensatz *vorne* in unser Live-Array ein
  liveStampData.unshift(newStamp); 

  // Sende Erfolgsantwort an den ESP32 (und den Namen für das Display)
  res.status(200).json({ status: "success", user: userName });
});
// ==================================================================


// --- Server starten ---
app.listen(port, '0.0.0.0', () => {
    console.log(`Ahmtimus Zeiterfassungssystem läuft auf Port ${port}`);
});