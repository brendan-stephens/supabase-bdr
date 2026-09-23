import { createClient } from '@supabase/supabase-js'

export const nodeA = createClient(
  process.env.NEXT_PUBLIC_NODE_A_URL!,
  process.env.NEXT_PUBLIC_NODE_A_ANON_KEY!
)

export const nodeB = createClient(
  process.env.NEXT_PUBLIC_NODE_B_URL!,
  process.env.NEXT_PUBLIC_NODE_B_ANON_KEY!
)

export type Item = {
  id: string
  content: string
  source_node: string
  created_at: string
}
