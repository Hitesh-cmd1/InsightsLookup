-- Run this only if you have an existing users table and need to add profile_id.
-- New installs: init_db() creates everything. This is for existing deployments.

-- Add profile_id to users (nullable; for Supabase resume URL when user uploads later)
ALTER TABLE users ADD COLUMN IF NOT EXISTS profile_id VARCHAR NULL;

-- true_* tables are created by init_db(). If you prefer manual SQL, uncomment below:
-- (init_db() will create them automatically on next app/pipeline run)
