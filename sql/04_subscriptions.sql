-- Run on NODE B (kxikohrxyhntuqcqdqwe)
-- Subscribes to Node A's publication.
CREATE SUBSCRIPTION node_b_sub_a
  CONNECTION 'host=db.zylvetpyoiyqnqbderru.supabase.co port=5432 dbname=postgres user=replicator password=ReplPass#2026 sslmode=require'
  PUBLICATION bdr_pub
  WITH (origin = none, copy_data = false);

-- ─────────────────────────────────────────────────────────────────────────────

-- Run on NODE A (zylvetpyoiyqnqbderru)
-- Subscribes to Node B's publication.
CREATE SUBSCRIPTION node_a_sub_b
  CONNECTION 'host=db.kxikohrxyhntuqcqdqwe.supabase.co port=5432 dbname=postgres user=replicator password=ReplPass#2026 sslmode=require'
  PUBLICATION bdr_pub
  WITH (origin = none, copy_data = false);

-- ─────────────────────────────────────────────────────────────────────────────
-- Verify subscriptions are active (run on either node):
--   SELECT subname, subenabled, subslotname FROM pg_subscription;
