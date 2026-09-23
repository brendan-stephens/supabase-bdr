import { createClient } from '@supabase/supabase-js'

export async function POST() {
  const dbA = createClient(
    process.env.NEXT_PUBLIC_NODE_A_URL!,
    process.env.NEXT_PUBLIC_NODE_A_ANON_KEY!
  )
  const dbB = createClient(
    process.env.NEXT_PUBLIC_NODE_B_URL!,
    process.env.NEXT_PUBLIC_NODE_B_ANON_KEY!
  )

  // Delete all rows from both nodes in parallel.
  // The anon_delete RLS policy allows this.
  // Replication will propagate the deletes, but we clear both directly
  // to avoid a race where one node re-populates the other before the
  // second delete lands.
  const [resA, resB] = await Promise.all([
    dbA.from('items').delete().gte('created_at', '1970-01-01'),
    dbB.from('items').delete().gte('created_at', '1970-01-01'),
  ])

  if (resA.error || resB.error) {
    return Response.json(
      { error: resA.error?.message ?? resB.error?.message },
      { status: 500 }
    )
  }

  return Response.json({ ok: true })
}
