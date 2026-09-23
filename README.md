# Supabase BDR Demo

A Next.js app demonstrating **bidirectional logical replication** across two Supabase projects with **round-robin writes** and a live sync-status dashboard.

```
Node A ──[bdr_pub + node_a_sub_b]──⇄──[bdr_pub + node_b_sub_a]── Node B
         origin=none                        origin=none
```

- Writes alternate between Node A and Node B automatically.
- Each write replicates to the other node via PostgreSQL logical replication at the WAL level.
- `origin = none` on both subscriptions prevents replication loops — each node only publishes rows it wrote directly.
- The UI shows each row's sync status in real time using Supabase Realtime.

---

## Projects

| | Node A | Node B |
|---|---|---|
| Ref | `zylvetpyoiyqnqbderru` | `kxikohrxyhntuqcqdqwe` |
| REST URL | `https://zylvetpyoiyqnqbderru.supabase.co` | `https://kxikohrxyhntuqcqdqwe.supabase.co` |
| Publication | `bdr_pub` | `bdr_pub` |
| Subscription | `node_a_sub_b` (← Node B) | `node_b_sub_a` (← Node A) |

---

## Running locally

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

Credentials are in `.env.local` (already populated). The dev server hot-reloads on file changes.

---

## API

The app exposes a single HTTP API used by both the UI and any external scripts.

### `GET /api/write`

Returns which node will receive the next write.

```bash
curl http://localhost:3000/api/write
```

```json
{ "nextNode": "node-a" }
```

### `POST /api/write`

Writes a row to the next node in the round-robin sequence, then toggles for the next call.

**Request body**

| Field | Type | Description |
|---|---|---|
| `content` | `string` | The text content to store |

**Response**

| Field | Type | Description |
|---|---|---|
| `item` | `object` | The inserted row (`id`, `content`, `source_node`, `created_at`) |
| `writtenTo` | `string` | Which node received the write (`"node-a"` or `"node-b"`) |

```bash
curl -X POST http://localhost:3000/api/write \
  -H "Content-Type: application/json" \
  -d '{"content": "hello world"}'
```

```json
{
  "item": {
    "id": "6baffd48-aee1-4e42-bb8a-22c8363ae125",
    "content": "hello world",
    "source_node": "node-a",
    "created_at": "2026-09-23T15:55:54.532037+00:00"
  },
  "writtenTo": "node-a"
}
```

You can also write directly to a node via the Supabase REST API, bypassing the round-robin:

```bash
# Direct write to Node A
curl -X POST "https://zylvetpyoiyqnqbderru.supabase.co/rest/v1/items" \
  -H "apikey: $(grep NODE_A_ANON .env.local | cut -d= -f2)" \
  -H "Content-Type: application/json" \
  -d '{"content": "direct to A", "source_node": "node-a"}'

# Direct write to Node B
curl -X POST "https://kxikohrxyhntuqcqdqwe.supabase.co/rest/v1/items" \
  -H "apikey: $(grep NODE_B_ANON .env.local | cut -d= -f2)" \
  -H "Content-Type: application/json" \
  -d '{"content": "direct to B", "source_node": "node-b"}'
```

---

## Examples

### Single write

```bash
curl -s -X POST http://localhost:3000/api/write \
  -H "Content-Type: application/json" \
  -d '{"content": "test message"}' | jq '.'
```

### Burst of 20 writes (sequential, watching round-robin alternate)

```bash
for i in $(seq 1 20); do
  curl -s -X POST http://localhost:3000/api/write \
    -H "Content-Type: application/json" \
    -d "{\"content\": \"write $i\"}" \
  | jq -r '"[\(.writtenTo)] \(.item.content)"'
done
```

Expected output — writes alternate between nodes:

```
[node-a] write 1
[node-b] write 2
[node-a] write 3
[node-b] write 4
...
```

### Two concurrent inserters

Simulates two independent services writing simultaneously to different nodes:

```bash
inserter() {
  local name=$1
  local n=0
  while true; do
    curl -s -X POST http://localhost:3000/api/write \
      -H "Content-Type: application/json" \
      -d "{\"content\": \"$name #$((++n))\"}" \
    | jq -r '"[\(.writtenTo)] \(.item.content)"'
    sleep 0.5
  done
}

inserter "alice" &
inserter "bob" &
wait   # Ctrl-C to stop
```

### Verify replication convergence

After writing some rows, confirm both databases have identical data:

```bash
NODE_A_KEY=$(grep NODE_A_ANON_KEY .env.local | cut -d= -f2)
NODE_B_KEY=$(grep NODE_B_ANON_KEY .env.local | cut -d= -f2)

count_a=$(curl -s "https://zylvetpyoiyqnqbderru.supabase.co/rest/v1/items?select=id" \
  -H "apikey: $NODE_A_KEY" | jq 'length')

count_b=$(curl -s "https://kxikohrxyhntuqcqdqwe.supabase.co/rest/v1/items?select=id" \
  -H "apikey: $NODE_B_KEY" | jq 'length')

echo "Node A: $count_a rows"
echo "Node B: $count_b rows"
[ "$count_a" = "$count_b" ] && echo "CONVERGED" || echo "DIVERGED (replication may still be in flight)"
```

### Check replication subscription status (via psql or Supabase SQL editor)

```sql
-- Run on either node to confirm subscriptions are active
SELECT subname, subenabled, subslotname
FROM pg_subscription;

-- Check replication lag on each node
SELECT
  slot_name,
  confirmed_flush_lsn,
  pg_wal_lsn_diff(pg_current_wal_lsn(), confirmed_flush_lsn) AS lag_bytes
FROM pg_replication_slots;
```

---

## Reprovisioning

To recreate the database schema and replication on a fresh pair of Supabase projects, run the SQL files in `sql/` in order:

```
sql/
  01_schema.sql            -- both nodes: table, RLS, Realtime
  02_replication_user.sql  -- both nodes: replicator role
  03_publications.sql      -- both nodes: bdr_pub publication
  04_subscriptions.sql     -- node-specific: cross-subscribe
```

Update the connection strings in `04_subscriptions.sql` and the credentials in `.env.local` to match your new project refs.

---

## HAProxy for live failover

Because both nodes are always writable and always in sync via BDR, adding HAProxy in front gives you **zero-downtime failover with no promotion step** — unlike traditional primary/replica setups where the replica must be promoted before it can accept writes.

### Why BDR makes this different

| | Traditional primary/replica | BDR (this setup) |
|---|---|---|
| Both nodes writable? | No — replica is read-only | Yes |
| Failover requires promotion? | Yes — takes seconds to minutes | No — failover target is already writable |
| Data loss on failover? | Possible (replication lag) | Minimal (lag is typically sub-second) |
| Can HAProxy do instant switchover? | No — must wait for promotion | Yes |

### Architecture with HAProxy

```
                  ┌─────────────┐
   app / curl ───▶│   HAProxy   │
                  │  :5432 (pg) │
                  │  :443 (api) │
                  └──────┬──────┘
                         │  health checks every 2s
              ┌──────────┴──────────┐
              ▼                     ▼
        ┌──────────┐         ┌──────────┐
        │  Node A  │◀──BDR──▶│  Node B  │
        │ (active) │         │ (standby)│
        └──────────┘         └──────────┘
```

HAProxy sends all traffic to Node A. If Node A's health check fails, HAProxy instantly routes to Node B — which is already fully writable and caught up via replication.

### HAProxy config (active/passive over the Supabase REST API)

```haproxy
# /etc/haproxy/haproxy.cfg

global
    log stdout format raw local0
    maxconn 4096

defaults
    mode    http
    timeout connect 3s
    timeout client  30s
    timeout server  30s
    option  httplog
    option  redispatch
    retries 3

frontend supabase_api
    bind *:8080
    default_backend supabase_nodes

backend supabase_nodes
    balance    first           # always use the first healthy node
    option     httpchk GET /rest/v1/items?limit=1
    http-check expect status 200

    # Node A is the preferred target (higher weight)
    server node-a zylvetpyoiyqnqbderru.supabase.co:443 ssl verify none \
           check inter 2s fall 3 rise 2 weight 100 \
           http-request set-header apikey <ANON_KEY_A>

    # Node B is the hot standby — takes over if node-a fails all checks
    server node-b kxikohrxyhntuqcqdqwe.supabase.co:443 ssl verify none \
           check inter 2s fall 3 rise 2 weight 1 backup \
           http-request set-header apikey <ANON_KEY_B>
```

With `balance first`, HAProxy sends everything to `node-a` as long as it is healthy. After 3 consecutive failed health checks (~6 seconds), it fails over to `node-b` instantly. When `node-a` recovers and passes 2 consecutive checks (~4 seconds), traffic returns.

### Active-active (round-robin) variant

To use both nodes simultaneously and treat any failure as a reduction in capacity rather than a failover event, swap `balance first` for `balance roundrobin` and remove the `backup` flag from `node-b`. This matches exactly what the Next.js app already does at the application layer.

```haproxy
backend supabase_nodes
    balance roundrobin
    option  httpchk GET /rest/v1/items?limit=1
    http-check expect status 200

    server node-a zylvetpyoiyqnqbderru.supabase.co:443 ssl verify none \
           check inter 2s fall 3 rise 2
    server node-b kxikohrxyhntuqcqdqwe.supabase.co:443 ssl verify none \
           check inter 2s fall 3 rise 2
```

### Scripting writes through HAProxy

Once HAProxy is running on port 8080, replace the Supabase URL with `localhost:8080` — HAProxy handles node selection and failover transparently:

```bash
# Single write through HAProxy (HAProxy chooses the node)
curl -s -X POST http://localhost:8080/rest/v1/items \
  -H "Content-Type: application/json" \
  -H "Prefer: return=representation" \
  -d '{"content": "written via haproxy", "source_node": "haproxy"}'

# Concurrent inserters through HAProxy
inserter() {
  local name=$1
  local n=0
  while true; do
    curl -s -X POST http://localhost:8080/rest/v1/items \
      -H "Content-Type: application/json" \
      -H "Prefer: return=representation" \
      -d "{\"content\": \"$name #$((++n))\", \"source_node\": \"$name\"}" \
    | jq -r '"[\(.source_node)] \(.content)"'
    sleep 0.3
  done
}

inserter "alice" &
inserter "bob" &
wait
```

### Testing failover

To simulate a node outage, pause the health check target and watch HAProxy switch:

```bash
# Watch HAProxy stats (enable stats socket in config first)
watch -n1 'echo "show stat" | socat stdio /run/haproxy/admin.sock | cut -d, -f1,2,18,19'

# In another terminal: keep writing and observe no errors during "failover"
for i in $(seq 1 100); do
  curl -s -X POST http://localhost:8080/rest/v1/items \
    -H "Content-Type: application/json" \
    -H "Prefer: return=representation" \
    -d "{\"content\": \"failover test $i\", \"source_node\": \"test\"}" \
  | jq -r '.content' && sleep 0.2
done
```

Because BDR keeps both nodes current, writes that land on Node B during the outage will automatically replicate back to Node A once it recovers — no manual sync or data reconciliation needed.

### Limitations to be aware of

- **Replication lag window** — there is a brief period (typically <100ms on same-region nodes) where Node B may be slightly behind Node A. Writes that hit Node B during this window are safe; they just won't include rows written to Node A in the last few milliseconds before the outage.
- **Conflict resolution** — if the same row is updated on both nodes simultaneously (rare with round-robin writes, impossible with active/passive), PostgreSQL's default is last-write-wins by commit timestamp. For production use, consider application-level conflict handling or a dedicated BDR solution like EDB Postgres Distributed.
- **Supabase connection pooler** — Supabase exposes databases behind Supavisor (connection pooler). Use port 5432 (direct) for replication connections, and port 6543 (pooler) or the REST API for application traffic. HAProxy should target the REST API (`*.supabase.co:443`) or direct Postgres (`db.*.supabase.co:5432`), not the pooler port, for health checks.

---

## Pros and cons of this architecture

### Pros

**Both nodes stay writable at all times**
No promotion step on failover. When a node goes down, HAProxy re-routes and the peer accepts writes immediately — it's a routing decision, not a database operation.

**Native PostgreSQL, no extra software**
`origin = none` subscriptions are built into Postgres 16+. No Galera, no EDB BDR license, no Patroni. The replication stream is the same WAL machinery Supabase already uses internally.

**Regional writes with low latency**
Route users to their nearest node — us-east-1 user writes to Node A, eu-west-1 user writes to Node B. Each write commits locally with full ACID guarantees before replicating, so write latency is determined by the local datacenter, not the cross-region RTT.

**Simple horizontal write distribution**
Round-robin or HAProxy splits write load across two nodes. Each handles ~50% of writes under normal operation.

---

### Cons

**Conflict resolution is silent and blunt**
Last-write-wins by commit timestamp. If two users update the same row on different nodes within the replication lag window, one write is silently discarded — no merge, no notification, no error. For most workloads with disjoint keys (each user writes their own rows) this is fine. For shared state (inventory counts, account balances, counters) it is a serious problem.

**Replication lag = consistency gap**
There is always a window — milliseconds same-region, 50–200ms+ cross-region — where the nodes diverge. A user who writes to Node A and immediately reads from Node B may not see their write. Read-your-own-writes across nodes requires either routing reads to the write node or accepting stale reads.

**DDL does not replicate**
Schema changes (adding a column, changing a type, dropping an index) must be applied manually to both nodes in the correct order. The safe sequence is: add a nullable column to the subscriber first, then the publisher. Miss this and replication stops with a constraint error.

**Replication slot disk risk**
If a subscriber goes offline or falls behind, the publisher keeps accumulating WAL in the replication slot indefinitely — potentially filling the disk. Set `max_slot_wal_keep_size` and monitor slot lag actively.

**Split-brain on network partition**
If Node A and Node B lose connectivity, both continue accepting writes independently. When the partition heals, both sides apply what the other wrote — and any row updated on both sides resolves to last-write-wins silently. There is no way to detect or surface conflicts after the fact without application-level versioning.

**This is DIY BDR, not enterprise BDR**
Products like EDB Postgres Distributed add conflict detection, CRDT data types, DDL replication, and global sequences. What is built here is the subset that standard Postgres supports natively — powerful but limited.

---

### When this pattern fits well

- **Same-region HA** — two nodes in the same region for redundancy. Replication lag is <10ms, conflict risk is low, failover is instant. This is the sweet spot.
- **Read-heavy workloads** — route reads to either node, writes round-robin. Lag is tolerable if reads do not need strict consistency.
- **Disjoint key spaces** — multi-tenant apps where each tenant's data only ever lives on one node. Conflicts are structurally impossible.

### When it does not fit

- **High-contention shared rows** — counters, inventory, balances. One correct write will be silently overwritten. Use a single authoritative node, optimistic locking, or a distributed transaction layer instead.
- **Strict read-after-write consistency** — every read must reflect every write immediately. Use a single primary with replicas for reads.
- **Frequent cross-region writes to overlapping keys** — the wider the replication lag, the higher the conflict probability. Cross-region BDR is viable only when writes to the same rows from different regions are rare by design.

---

## How the replication loop is prevented

PostgreSQL logical replication tracks the *origin* of each WAL record. When Node B applies a row replicated from Node A, that row is stamped with the replication origin `node_b_sub_a`. Node B's publication (`bdr_pub`) only broadcasts rows with *no* origin — i.e., rows written directly by an application. So the replicated row is never re-sent back to Node A, breaking the loop.

This is controlled by the `origin = none` option on each `CREATE SUBSCRIPTION` statement.
