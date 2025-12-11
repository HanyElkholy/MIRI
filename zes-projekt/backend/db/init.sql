-- backend/db/init.sql

-- 1. Kunden (Mandanten)
CREATE TABLE IF NOT EXISTS customers (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 2. Benutzer
CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    username VARCHAR(50) UNIQUE NOT NULL,
    password VARCHAR(255) NOT NULL, -- Hier kommt der Bcrypt Hash rein
    role VARCHAR(20) DEFAULT 'user', -- 'admin' oder 'user'
    display_name VARCHAR(100),
    customer_id INTEGER REFERENCES customers(id),
    daily_target NUMERIC(4,2) DEFAULT 8.0,
    vacation_days INTEGER DEFAULT 30,
    card_id VARCHAR(50), -- Für den ESP32 RFID Chip
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 3. Buchungen (Zeiterfassung)
CREATE TABLE IF NOT EXISTS bookings (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id),
    date DATE NOT NULL,
    start_time TIME,
    end_time TIME,
    type VARCHAR(50), -- 'Kommen', 'Gehen', 'Urlaub', 'Krank'
    remarks TEXT,
    history JSONB, -- Änderungshistorie als JSON
    is_edited BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 4. Anträge (Urlaub/Korrektur)
CREATE TABLE IF NOT EXISTS requests (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id),
    date DATE NOT NULL,
    new_start TIME,
    new_end TIME,
    reason TEXT,
    status VARCHAR(20) DEFAULT 'pending', -- 'pending', 'approved', 'rejected'
    type VARCHAR(50),
    user_seen BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 5. Audit Logs (Sicherheit)
CREATE TABLE IF NOT EXISTS audit_logs (
    id SERIAL PRIMARY KEY,
    customer_id INTEGER REFERENCES customers(id),
    actor VARCHAR(100), -- Wer hat es getan?
    action VARCHAR(50),
    old_value TEXT,
    new_value TEXT,
    affected_user VARCHAR(100),
    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- INITIALE DATEN (Damit du dich einloggen kannst)
-- Passwort für admin ist: 'admin123' (als Bcrypt Hash)
INSERT INTO customers (name) VALUES ('McKensy') ON CONFLICT DO NOTHING;

INSERT INTO users (username, password, role, display_name, customer_id) 
VALUES (
    'admin', 
    '$2a$10$xgGKgKRURVfZMJ2LdpiCguKDKMwrRjRdmWpKmWybIm8E4rwNaeU72', -- Beispiel Hash muss noch generiert werden, siehe unten!
    'admin', 
    'Super Admin', 
    1
) ON CONFLICT (username) DO NOTHING;