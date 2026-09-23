import { createClient } from '@supabase/supabase-js'

// Module-level counter persists for the lifetime of the server process
let nextNode = 0

export async function POST(request: Request) {
  const { content } = await request.json()
  if (!content?.trim()) {
    return Response.json({ error: 'content required' }, { status: 400 })
  }

  const node = nextNode === 0 ? 'node-a' : 'node-b'
  nextNode = 1 - nextNode

  const url =
    node === 'node-a'
      ? process.env.NEXT_PUBLIC_NODE_A_URL!
      : process.env.NEXT_PUBLIC_NODE_B_URL!
  const key =
    node === 'node-a'
      ? process.env.NEXT_PUBLIC_NODE_A_ANON_KEY!
      : process.env.NEXT_PUBLIC_NODE_B_ANON_KEY!

  const db = createClient(url, key)
  const { data, error } = await db
    .from('items')
    .insert({ content: content.trim(), source_node: node })
    .select()
    .single()

  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ item: data, writtenTo: node })
}

export async function GET() {
  return Response.json({ nextNode: nextNode === 0 ? 'node-a' : 'node-b' })
}
