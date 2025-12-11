const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
require('dotenv').config();

// Importiere deine Routen
const apiRoutes = require('./routes/apiRoutes');

const app = express();

// --- WICHTIG: MIDDLEWARE (Die Reihenfolge ist entscheidend!) ---

// 1. Sicherheit Header setzen
app.use(helmet());

// 2. Cross-Origin erlauben (damit Frontend und Backend reden dürfen)
app.use(cors());

// 3. JSON Parser aktivieren <--- DAS HAT WAHRSCHEINLICH GEFEHLT ODER WAR FALSCH PLATZIERT
// Ohne das hier ist req.body immer undefined!
app.use(express.json()); 

// --- ROUTEN ---
app.use('/api/v1', apiRoutes);

// Einfacher Test für die Hauptseite
app.get('/', (req, res) => {
  res.send('ZES API läuft sicher!');
});

// Server Starten
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Server läuft auf Port ${PORT}`);
});