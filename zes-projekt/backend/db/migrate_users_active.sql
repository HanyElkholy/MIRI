-- Add is_active column to users table
BEGIN;

ALTER TABLE users ADD COLUMN is_active BOOLEAN DEFAULT TRUE;

COMMIT;
