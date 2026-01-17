const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.DB_NAME,
  password: process.env.DB_PASSWORD,
  port: process.env.DB_PORT || 5432,
  // Connection Pool Optimierungen
  max: parseInt(process.env.DB_POOL_MAX) || 20, // Maximale Anzahl Connections
  idleTimeoutMillis: 30000, // Connection wird nach 30s Inaktivität geschlossen
  connectionTimeoutMillis: 5000, // Timeout beim Verbindungsaufbau
  // Statement Timeout (optional, verhindert hängende Queries)
  statement_timeout: 30000, // 30 Sekunden
});

// Event Handler für Pool-Events
pool.on('connect', () => {
  if (process.env.NODE_ENV !== 'production') {
    console.log('Verbindung zur Datenbank hergestellt');
  }
});

pool.on('error', (err) => {
  console.error('Unerwarteter Fehler auf inaktiver DB-Connection:', err);
  process.exit(-1);
});

// Graceful Shutdown
process.on('SIGINT', async () => {
  await pool.end();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  await pool.end();
  process.exit(0);
});

module.exports = {
  query: (text, params) => pool.query(text, params),
  pool,
};