const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.DB_NAME,
  password: process.env.DB_PASSWORD,
  port: 5432,
});

// Testen ob Verbindung klappt
pool.on('connect', () => {
  console.log('Verbindung zur Datenbank hergestellt');
});

module.exports = {
  query: (text, params) => pool.query(text, params),
  pool,
};