-- 1. Kunden
CREATE TABLE IF NOT EXISTS customers (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    working_days INTEGER[] DEFAULT '{1,2,3,4,5}', -- Mo-Fr standard
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 2. Benutzer (MIT der Spalte is_initial_password!)
CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    username VARCHAR(50) UNIQUE NOT NULL,
    password VARCHAR(255) NOT NULL,
    role VARCHAR(20) DEFAULT 'user',
    display_name VARCHAR(100),
    customer_id INTEGER REFERENCES customers(id),
    daily_target NUMERIC(4,2) DEFAULT 8.0,
    vacation_days INTEGER DEFAULT 30,
    card_id VARCHAR(50),
    is_initial_password BOOLEAN DEFAULT TRUE, -- WICHTIG!
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 3. Tabellen für Buchungen, Anträge etc. (kurz gehalten für Reset)
CREATE TABLE IF NOT EXISTS bookings (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id),
    date DATE NOT NULL,
    start_time TIME,
    end_time TIME,
    type VARCHAR(50),
    remarks TEXT,
    history JSONB,
    is_edited BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS requests (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id),
    date DATE NOT NULL,
    end_date DATE,
    new_start TIME,
    new_end TIME,
    reason TEXT,
    status VARCHAR(20) DEFAULT 'pending',
    type VARCHAR(50),
    user_seen BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS audit_logs (
    id SERIAL PRIMARY KEY,
    customer_id INTEGER REFERENCES customers(id),
    actor VARCHAR(100),
    action VARCHAR(50),
    old_value TEXT,
    new_value TEXT,
    affected_user VARCHAR(100),
    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- INITIALE DATEN
INSERT INTO customers (name) VALUES ('McKensy') ON CONFLICT DO NOTHING;

-- Admin User erstellen
-- Passwort ist 'admin123' (als Hash)
-- is_initial_password steht auf TRUE, damit das Modal erscheint
INSERT INTO users (username, password, role, display_name, customer_id, is_initial_password) 
VALUES (
    'admin', 
    '$2a$10$xgGKgKRURVfZMJ2LdpiCguKDKMwrRjRdmWpKmWybIm8E4rwNaeU72', 
    'admin', 
    'Super Admin', 
    1,
    TRUE 
) ON CONFLICT (username) DO NOTHING;
