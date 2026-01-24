-- Migration script: Convert customers.id to UUID
-- WARNING: BACKUP YOUR DATABASE BEFORE RUNNING THIS!

BEGIN;

-- 1. Create a new UUID column for customers
ALTER TABLE customers ADD COLUMN uuid_id UUID DEFAULT gen_random_uuid();

-- 2. Create a new UUID column for references in users table
ALTER TABLE users ADD COLUMN customer_uuid UUID;

-- 3. Create a new UUID column for references in audit_logs table
-- (Note: audit_logs also references customers)
ALTER TABLE audit_logs ADD COLUMN customer_uuid UUID;

-- 4. Fill the new columns based on existing relationships
UPDATE users u
SET customer_uuid = c.uuid_id
FROM customers c
WHERE u.customer_id = c.id;

UPDATE audit_logs a
SET customer_uuid = c.uuid_id
FROM customers c
WHERE a.customer_id = c.id;

-- 5. Drop constraints
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_customer_id_fkey;
ALTER TABLE audit_logs DROP CONSTRAINT IF EXISTS audit_logs_customer_id_fkey;

-- 6. Switch Primary Key on customers
ALTER TABLE customers DROP CONSTRAINT customers_pkey CASCADE; -- Drops dependent foreign keys if any remain
ALTER TABLE customers DROP COLUMN id;
ALTER TABLE customers RENAME COLUMN uuid_id TO id;
ALTER TABLE customers ADD PRIMARY KEY (id);

-- 7. Switch Foreign Key on users
ALTER TABLE users DROP COLUMN customer_id;
ALTER TABLE users RENAME COLUMN customer_uuid TO customer_id;
ALTER TABLE users ADD CONSTRAINT users_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES customers(id);

-- 8. Switch Foreign Key on audit_logs
ALTER TABLE audit_logs DROP COLUMN customer_id;
ALTER TABLE audit_logs RENAME COLUMN customer_uuid TO customer_id;
ALTER TABLE audit_logs ADD CONSTRAINT audit_logs_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES customers(id);

COMMIT;
