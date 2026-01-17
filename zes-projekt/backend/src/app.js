const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
require('dotenv').config();

// Importiere deine Routen
const apiRoutes = require('./routes/apiRoutes');
const errorHandler = require('./middleware/errorMiddleware');
const db = require('./config/db');
const rateLimiter = require('./middleware/rateLimiter');

const app = express();

// --- WICHTIG: MIDDLEWARE (Die Reihenfolge ist entscheidend!) ---

// 1. Sicherheit Header setzen
app.use(helmet());

// 2. Cross-Origin erlauben (damit Frontend und Backend reden dürfen)
app.use(cors());

// 3. JSON Parser aktivieren
// Ohne das hier ist req.body immer undefined!
app.use(express.json());

// 4. Rate-Limiting (nach JSON Parser, vor Routen)
app.use('/api/v1', rateLimiter.general); 

// --- HEALTH CHECKS (vor den API-Routen) ---
app.get('/health', async (req, res) => {
  try {
    // Teste Datenbankverbindung
    await db.query('SELECT 1');
    res.json({ 
      status: 'healthy', 
      timestamp: new Date().toISOString(),
      service: 'MIRI API'
    });
  } catch (err) {
    res.status(503).json({ 
      status: 'unhealthy', 
      error: 'Database connection failed',
      timestamp: new Date().toISOString()
    });
  }
});

app.get('/ready', async (req, res) => {
  try {
    await db.query('SELECT 1');
    res.json({ status: 'ready' });
  } catch (err) {
    res.status(503).json({ status: 'not ready', error: err.message });
  }
});

// --- ROUTEN ---
app.use('/api/v1', apiRoutes);

// Einfacher Test für die Hauptseite
app.get('/', (req, res) => {
  res.send('MIRI API läuft sicher!');
});

// --- ERROR HANDLING (MUSS ALS LETZTES KOMMEN!) ---
app.use(errorHandler);

// Server Starten
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Server läuft auf Port ${PORT}`);
});