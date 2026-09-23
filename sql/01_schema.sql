-- Run on BOTH nodes
-- Creates the items table, enables RLS, and adds anon read/write policies.

CREATE TABLE IF NOT EXISTS items (
  id          UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  content     TEXT        NOT NULL,
  source_node TEXT        NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anon_select" ON items FOR SELECT TO anon USING (true);
CREATE POLICY "anon_insert" ON items FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "anon_update" ON items FOR UPDATE TO anon USING (true) WITH CHECK (true);
CREATE POLICY "anon_delete" ON items FOR DELETE TO anon USING (true);

-- Enable Supabase Realtime for this table
ALTER PUBLICATION supabase_realtime ADD TABLE items;
