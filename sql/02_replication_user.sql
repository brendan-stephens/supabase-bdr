-- Run on BOTH nodes
-- Creates a dedicated replication role used in the subscription connection strings.
-- Using a dedicated role avoids exposing the postgres superuser password.

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'replicator') THEN
    CREATE ROLE replicator WITH REPLICATION LOGIN PASSWORD 'ReplPass#2026';
  END IF;
END $$;

GRANT USAGE ON SCHEMA public TO replicator;
GRANT SELECT ON TABLE items TO replicator;
