const express = require('express');
const cors = require('cors');
const app = express();
const port = 3001;

app.use(cors());
app.use(express.json());

// --- UNSERE (TEMPORÄRE) DATENBANK ---

// 1. Simuliert unsere Benutzer-Tabelle
const userDatabase = {
  "BA59E52A": "Max Mustermann",
  "A1B2C3D4": "Erika Mustermann",
  "FE4DC5BA": "Peter Schmidt",
  // Tragen Sie hier die UID Ihrer Testkarte ein:
  "6375B20B": "Ihr Name" 
};

// 2. Hier speichern wir alle "echten" Stempelungen, die reinkommen
let liveStampData = [
  { id: 1, user: "Test-Eintrag", time: new Date().toISOString(), type: "Gehen" }
];
let nextId = 2; 

// --- API-Endpunkte ---

// 1. Endpunkt für das Frontend (HOLT die LIVE-Daten)
app.get('/api/v1/times', (req, res) => {
  console.log("GET /api/v1/times: Sende Live-Daten an Frontend.");
  res.json(liveStampData);
});


// ==================================================================
// --- HIER IST DIE NEUE LOGIK ---
// 2. Endpunkt für den ESP32 (SENDET eine neue Stempelung)
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
  console.log(`✅ Backend-Server läuft auf http://<DEINE_LOKALE_IP>:${port}`);
});