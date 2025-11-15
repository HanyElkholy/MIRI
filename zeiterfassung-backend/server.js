const express = require('express');
const cors = require('cors');
const app = express();
const port = 3001;

app.use(cors());
app.use(express.json());

// --- UNSERE (TEMPORÄRE) DATENBANK ---

// 1. Simuliert unsere Benutzer-Tabelle
// (Ersetze diese IDs später durch die IDs deiner echten Test-Karten)
const userDatabase = {
  "6375B20B": "Max Mustermann",
  "73A96611": "Erika Mustermann",
  "FE4DC5BA": "Peter Schmidt"
};

// 2. Hier speichern wir alle "echten" Stempelungen, die reinkommen
// WICHTIG: Es ist jetzt ein 'let', kein 'const' mehr!
let liveStampData = [
  { id: 1, user: "Test-Eintrag", time: new Date().toISOString(), type: "Kommen" }
];
let nextId = 2; // Zähler für die nächste ID

// --- API-Endpunkte ---

// 1. Endpunkt für das Frontend (HOLT die LIVE-Daten)
app.get('/api/v1/times', (req, res) => {
  console.log("GET /api/v1/times: Sende Live-Daten an Frontend.");
  // Sende das *aktuelle* Array zurück
  res.json(liveStampData);
});

// 2. Endpunkt für den ESP32 (SENDET eine neue Stempelung)
app.post('/api/v1/stamp', (req, res) => {
  const { cardId } = req.body; // Holt die cardId aus dem JSON-Body
  
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

  // Alles gut! Erstelle einen neuen Datensatz
  console.log(`✅ Stempelung erhalten von: ${userName} (ID: ${cardId})`);

  const newStamp = {
    id: nextId++,
    user: userName,
    time: new Date().toISOString(), // Aktuelle Server-Zeit
    type: "Kommen" // (Logik für Kommen/Gehen fehlt noch, das ist OK)
  };

  // Füge den neuen Datensatz *vorne* in unser Live-Array ein
  liveStampData.unshift(newStamp); 

  // Sende Erfolgsantwort an den ESP32
  res.status(200).json({ status: "success", user: userName });
});


// --- Server starten ---
app.listen(port, '0.0.0.0', () => {
  // '0.0.0.0' ist WICHTIG, damit der Server auf deiner lokalen IP
  // (z.B. 192.168.1.101) lauscht und nicht nur auf 'localhost'
  console.log(`✅ Backend-Server läuft auf http://192.168.2.201:${port}`);
});