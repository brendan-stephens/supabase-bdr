-- Run on BOTH nodes
-- Each node publishes its local writes via bdr_pub.
-- The subscription on the other node uses origin=none so only
-- directly-written rows are published (not rows that arrived via replication),
-- which prevents infinite replication loops.

CREATE PUBLICATION bdr_pub FOR TABLE items;
