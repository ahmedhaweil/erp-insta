-- Enable required PostgreSQL extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Create the RLS helper function
CREATE OR REPLACE FUNCTION current_tenant_id() RETURNS uuid AS $$
  SELECT COALESCE(
    NULLIF(current_setting('app.current_tenant', true), '')::uuid,
    '00000000-0000-0000-0000-000000000000'::uuid
  );
$$ LANGUAGE sql STABLE;
