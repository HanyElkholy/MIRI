-- REPAIR & MIGRATE SCRIPT
-- RUN THIS TO FIX THE DATABASE STATE
-- This script assumes there is ONLY ONE Customer (Company) in the database, as you mentioned.

BEGIN;

-- 1. Ensure we have the function to generate UUIDs
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- 2. CUSTOMERS Table: Ensure the new UUID column exists and has a value
-- We add the column 'uuid_new' if it doesn't exist yet.
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='customers' AND column_name='uuid_new') THEN
        ALTER TABLE customers ADD COLUMN uuid_new UUID DEFAULT gen_random_uuid();
    END IF;
END
$$;

-- Force a UUID for any customer that has NULL (just to be safe)
UPDATE customers SET uuid_new = gen_random_uuid() WHERE uuid_new IS NULL;

-- 3. USERS Table: Update all users to belong to the single customer
-- We add the column 'customer_uuid_new' if it doesn't exist.
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='customer_uuid_new') THEN
        ALTER TABLE users ADD COLUMN customer_uuid_new UUID;
    END IF;
END
$$;

-- MAGiC STEP: Since there is only 1 Customer, we assign that Customer's UUID to ALL Users.
-- This fixes the issue even if the old IDs were broken.
UPDATE users 
SET customer_uuid_new = (SELECT uuid_new FROM customers LIMIT 1);

-- 4. AUDIT_LOGS Table: Same fix
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='audit_logs' AND column_name='customer_uuid_new') THEN
        ALTER TABLE audit_logs ADD COLUMN customer_uuid_new UUID;
    END IF;
END
$$;

UPDATE audit_logs 
SET customer_uuid_new = (SELECT uuid_new FROM customers LIMIT 1);

-- 5. APPLY SCHEMA CHANGES (Drop old, Rename new)

-- Clean up foreign keys first
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_customer_id_fkey;
ALTER TABLE audit_logs DROP CONSTRAINT IF EXISTS audit_logs_customer_id_fkey;

-- Fix CUSTOMERS Primary Key
ALTER TABLE customers DROP CONSTRAINT IF EXISTS customers_pkey CASCADE;
-- If the old 'id' column still exists, drop it
ALTER TABLE customers DROP COLUMN IF EXISTS id;
-- Rename 'uuid_new' to 'id' if it exists (it might have been named something else in previous attempts, but here we used uuid_new)
ALTER TABLE customers RENAME COLUMN uuid_new TO id;
-- Make it the Primary Key
ALTER TABLE customers ADD PRIMARY KEY (id);

-- Fix USERS Foreign Key
ALTER TABLE users DROP COLUMN IF EXISTS customer_id;
ALTER TABLE users RENAME COLUMN customer_uuid_new TO customer_id;
ALTER TABLE users ADD CONSTRAINT users_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES customers(id);

-- Fix AUDIT_LOGS Foreign Key
ALTER TABLE audit_logs DROP COLUMN IF EXISTS customer_id;
ALTER TABLE audit_logs RENAME COLUMN customer_uuid_new TO customer_id;
ALTER TABLE audit_logs ADD CONSTRAINT audit_logs_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES customers(id);

COMMIT;
