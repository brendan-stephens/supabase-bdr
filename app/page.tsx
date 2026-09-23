'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { nodeA, nodeB, type Item } from '@/lib/supabase'

type TrackedItem = Item & {
  receivedAt: number
  syncedAt?: number
}

const NODE_A_REF = 'zylvetpyoiyqnqbderru'
const NODE_B_REF = 'kxikohrxyhntuqcqdqwe'
const BATCH_INTERVAL_MS = 400

export default function Home() {
  const [itemsA, setItemsA] = useState<TrackedItem[]>([])
  const [itemsB, setItemsB] = useState<TrackedItem[]>([])
  const [nextNode, setNextNode] = useState<'node-a' | 'node-b'>('node-a')
  const [content, setContent] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [lastWritten, setLastWritten] = useState<string | null>(null)

  // Edit state
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editContent, setEditContent] = useState('')
  const [savingId, setSavingId] = useState<string | null>(null)

  // Batch mode
  const [batchActive, setBatchActive] = useState(false)
  const [batchCount, setBatchCount] = useState(0)

  // Reset / truncate
  const [resetState, setResetState] = useState<'idle' | 'confirm' | 'resetting'>('idle')
  const resetConfirmTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const batchCountRef = useRef(0)
  const batchTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Stable refs for Realtime callbacks
  const itemsARef = useRef<TrackedItem[]>([])
  const itemsBRef = useRef<TrackedItem[]>([])
  itemsARef.current = itemsA
  itemsBRef.current = itemsB

  // ── Initial load ──────────────────────────────────────────────────────────
  useEffect(() => {
    async function loadInitial() {
      const [resA, resB] = await Promise.all([
        nodeA.from('items').select('*').order('created_at', { ascending: false }).limit(50),
        nodeB.from('items').select('*').order('created_at', { ascending: false }).limit(50),
      ])
      const now = Date.now()
      const bIds = new Set((resB.data ?? []).map((i: Item) => i.id))
      const aIds = new Set((resA.data ?? []).map((i: Item) => i.id))
      setItemsA(
        (resA.data ?? []).map((item: Item) => ({
          ...item,
          receivedAt: now,
          syncedAt: bIds.has(item.id) ? now : undefined,
        }))
      )
      setItemsB(
        (resB.data ?? []).map((item: Item) => ({
          ...item,
          receivedAt: now,
          syncedAt: aIds.has(item.id) ? now : undefined,
        }))
      )
    }
    loadInitial()
    fetch('/api/write')
      .then((r) => r.json())
      .then(({ nextNode }) => setNextNode(nextNode))
  }, [])

  // ── Realtime subscriptions ────────────────────────────────────────────────
  useEffect(() => {
    function handleInsertA(item: Item) {
      const now = Date.now()
      const existsInB = itemsBRef.current.some((i) => i.id === item.id)
      setItemsA((prev) => {
        if (prev.some((i) => i.id === item.id)) return prev
        return [{ ...item, receivedAt: now, syncedAt: existsInB ? now : undefined }, ...prev]
      })
      if (existsInB) {
        setItemsB((prev) =>
          prev.map((i) => (i.id === item.id && !i.syncedAt ? { ...i, syncedAt: now } : i))
        )
      }
    }

    function handleInsertB(item: Item) {
      const now = Date.now()
      const existsInA = itemsARef.current.some((i) => i.id === item.id)
      setItemsB((prev) => {
        if (prev.some((i) => i.id === item.id)) return prev
        return [{ ...item, receivedAt: now, syncedAt: existsInA ? now : undefined }, ...prev]
      })
      if (existsInA) {
        setItemsA((prev) =>
          prev.map((i) => (i.id === item.id && !i.syncedAt ? { ...i, syncedAt: now } : i))
        )
      }
    }

    function handleUpdateA(updated: Partial<Item> & { id: string }) {
      setItemsA((prev) =>
        prev.map((i) => (i.id === updated.id ? { ...i, ...updated } : i))
      )
    }

    function handleUpdateB(updated: Partial<Item> & { id: string }) {
      setItemsB((prev) =>
        prev.map((i) => (i.id === updated.id ? { ...i, ...updated } : i))
      )
    }

    const channelA = nodeA
      .channel('items-a')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'items' }, (p) =>
        handleInsertA(p.new as Item)
      )
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'items' }, (p) =>
        handleUpdateA(p.new as Item)
      )
      .subscribe()

    const channelB = nodeB
      .channel('items-b')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'items' }, (p) =>
        handleInsertB(p.new as Item)
      )
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'items' }, (p) =>
        handleUpdateB(p.new as Item)
      )
      .subscribe()

    return () => {
      nodeA.removeChannel(channelA)
      nodeB.removeChannel(channelB)
    }
  }, [])

  // ── Batch mode ────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!batchActive) return
    batchTimerRef.current = setInterval(async () => {
      const n = ++batchCountRef.current
      setBatchCount(n)
      await fetch('/api/write', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: `batch #${n} @ ${new Date().toLocaleTimeString()}` }),
      })
    }, BATCH_INTERVAL_MS)
    return () => {
      if (batchTimerRef.current) clearInterval(batchTimerRef.current)
    }
  }, [batchActive])

  function toggleBatch() {
    if (batchActive) {
      setBatchActive(false)
    } else {
      batchCountRef.current = 0
      setBatchCount(0)
      setBatchActive(true)
    }
  }

  // ── Normal write ──────────────────────────────────────────────────────────
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!content.trim() || submitting) return
    setSubmitting(true)
    try {
      const res = await fetch('/api/write', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content }),
      })
      const { writtenTo, error } = await res.json()
      if (error) throw new Error(error)
      setLastWritten(writtenTo)
      setNextNode(writtenTo === 'node-a' ? 'node-b' : 'node-a')
      setContent('')
    } finally {
      setSubmitting(false)
    }
  }

  // ── Inline edit ───────────────────────────────────────────────────────────
  function startEdit(item: TrackedItem) {
    setEditingId(item.id)
    setEditContent(item.content)
  }

  function cancelEdit() {
    setEditingId(null)
    setEditContent('')
  }

  const handleUpdate = useCallback(async (id: string, newContent: string, sourceNode: string) => {
    if (!newContent.trim()) return
    setSavingId(id)
    try {
      const client = sourceNode === 'node-a' ? nodeA : nodeB
      const { error } = await client
        .from('items')
        .update({ content: newContent.trim() })
        .eq('id', id)
      if (error) throw error
      // Optimistic local update; Realtime will confirm it on both panels
      const patch = { content: newContent.trim() }
      setItemsA((prev) => prev.map((i) => (i.id === id ? { ...i, ...patch } : i)))
      setItemsB((prev) => prev.map((i) => (i.id === id ? { ...i, ...patch } : i)))
      setEditingId(null)
      setEditContent('')
    } finally {
      setSavingId(null)
    }
  }, [])

  // ── Reset / truncate ──────────────────────────────────────────────────────
  function handleResetClick() {
    if (resetState === 'idle') {
      setResetState('confirm')
      resetConfirmTimer.current = setTimeout(() => setResetState('idle'), 4000)
      return
    }
    if (resetState === 'confirm') {
      if (resetConfirmTimer.current) clearTimeout(resetConfirmTimer.current)
      doReset()
    }
  }

  async function doReset() {
    setBatchActive(false)
    setResetState('resetting')
    try {
      await fetch('/api/truncate', { method: 'POST' })
      setItemsA([])
      setItemsB([])
      setBatchCount(0)
      batchCountRef.current = 0
      setLastWritten(null)
      setEditingId(null)
    } finally {
      setResetState('idle')
    }
  }

  // ── Derived stats ─────────────────────────────────────────────────────────
  const allIds = new Set([...itemsA.map((i) => i.id), ...itemsB.map((i) => i.id)])
  const syncedCount = [...allIds].filter(
    (id) => itemsA.some((i) => i.id === id) && itemsB.some((i) => i.id === id)
  ).length
  const pendingCount = allIds.size - syncedCount

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 font-mono">
      {/* Header */}
      <header className="border-b border-gray-800 px-6 py-4">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <div>
            <h1 className="text-lg font-bold text-white">Supabase BDR Demo</h1>
            <p className="text-xs text-gray-500 mt-0.5">
              Bidirectional logical replication · Round-robin writes
            </p>
          </div>
          <div className="flex items-center gap-4 text-xs">
            <span className="text-green-400">{syncedCount} synced</span>
            {pendingCount > 0 && (
              <span className="text-yellow-400 animate-pulse">{pendingCount} pending</span>
            )}
            <span className="text-gray-600">|</span>
            <span className="text-gray-400">{allIds.size} total rows</span>
            <span className="text-gray-600">|</span>
            <button
              onClick={handleResetClick}
              disabled={resetState === 'resetting'}
              className={`px-2.5 py-1 rounded font-medium transition-colors disabled:opacity-40 ${
                resetState === 'confirm'
                  ? 'bg-red-600 hover:bg-red-500 text-white animate-pulse'
                  : 'bg-gray-800 hover:bg-gray-700 text-gray-400 hover:text-red-400'
              }`}
            >
              {resetState === 'idle' && '↺ Reset'}
              {resetState === 'confirm' && '⚠ Confirm reset?'}
              {resetState === 'resetting' && 'Resetting…'}
            </button>
          </div>
        </div>
      </header>

      {/* Toolbar */}
      <div className="border-b border-gray-800 px-6 py-4 bg-gray-900">
        <div className="max-w-6xl mx-auto space-y-3">
          {/* Write form */}
          <form onSubmit={handleSubmit} className="flex gap-3 items-center">
            <input
              type="text"
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="Enter content to write..."
              disabled={batchActive}
              className="flex-1 bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-gray-500 disabled:opacity-40"
            />
            <button
              type="submit"
              disabled={submitting || !content.trim() || batchActive}
              className="px-4 py-2 text-sm rounded font-medium bg-indigo-600 hover:bg-indigo-500 text-white disabled:opacity-40 transition-colors"
            >
              {submitting
                ? 'Writing...'
                : `Write → ${nextNode === 'node-a' ? 'Node A' : 'Node B'}`}
            </button>

            {/* Batch toggle */}
            <button
              type="button"
              onClick={toggleBatch}
              className={`px-4 py-2 text-sm rounded font-medium transition-colors ${
                batchActive
                  ? 'bg-red-700 hover:bg-red-600 text-white animate-pulse'
                  : 'bg-gray-700 hover:bg-gray-600 text-gray-200'
              }`}
            >
              {batchActive ? `⏹ Stop Batch (${batchCount})` : '⚡ Batch Test'}
            </button>
          </form>

          {/* Status line */}
          <div className="text-xs text-gray-500 flex items-center gap-2">
            {batchActive ? (
              <>
                <span className="text-yellow-400 animate-pulse">●</span>
                <span className="text-yellow-400">
                  Batch inserting at {Math.round(1000 / BATCH_INTERVAL_MS * 10) / 10}/sec ·{' '}
                  {batchCount} written
                </span>
              </>
            ) : (
              <>
                <span>Next write targets</span>
                <NodeBadge node={nextNode} />
                {lastWritten && (
                  <>
                    <span className="text-gray-600">·</span>
                    <span>
                      Last written to <NodeBadge node={lastWritten} />
                    </span>
                  </>
                )}
              </>
            )}
          </div>
        </div>
      </div>

      {/* Node panels */}
      <main className="max-w-6xl mx-auto px-6 py-6 grid grid-cols-2 gap-6">
        <NodePanel
          label="Node A"
          dbRef={NODE_A_REF}
          items={itemsA}
          color="blue"
          peerItems={itemsB}
          editingId={editingId}
          editContent={editContent}
          savingId={savingId}
          onEditStart={startEdit}
          onEditChange={setEditContent}
          onEditSave={handleUpdate}
          onEditCancel={cancelEdit}
        />
        <NodePanel
          label="Node B"
          dbRef={NODE_B_REF}
          items={itemsB}
          color="green"
          peerItems={itemsA}
          editingId={editingId}
          editContent={editContent}
          savingId={savingId}
          onEditStart={startEdit}
          onEditChange={setEditContent}
          onEditSave={handleUpdate}
          onEditCancel={cancelEdit}
        />
      </main>

      <footer className="border-t border-gray-800 px-6 py-3 mt-4">
        <p className="max-w-6xl mx-auto text-xs text-gray-600 text-center">
          <code>bdr_pub</code> on each node · <code>origin=none</code> subscriptions prevent
          replication loops · click any row to edit · edits replicate automatically
        </p>
      </footer>
    </div>
  )
}

// ── Sub-components ─────────────────────────────────────────────────────────

function NodeBadge({ node }: { node: string }) {
  const isA = node === 'node-a'
  return (
    <span
      className={`px-1.5 py-0.5 rounded text-xs font-medium ${
        isA ? 'bg-blue-900 text-blue-300' : 'bg-green-900 text-green-300'
      }`}
    >
      {isA ? 'Node A' : 'Node B'}
    </span>
  )
}

type NodePanelProps = {
  label: string
  dbRef: string
  items: TrackedItem[]
  color: 'blue' | 'green'
  peerItems: TrackedItem[]
  editingId: string | null
  editContent: string
  savingId: string | null
  onEditStart: (item: TrackedItem) => void
  onEditChange: (v: string) => void
  onEditSave: (id: string, content: string, sourceNode: string) => void
  onEditCancel: () => void
}

function NodePanel({
  label,
  dbRef,
  items,
  color,
  peerItems,
  editingId,
  editContent,
  savingId,
  onEditStart,
  onEditChange,
  onEditSave,
  onEditCancel,
}: NodePanelProps) {
  const peerIds = new Set(peerItems.map((i) => i.id))
  const isBlue = color === 'blue'

  return (
    <div
      className={`border rounded-lg overflow-hidden ${
        isBlue ? 'border-blue-800' : 'border-green-800'
      }`}
    >
      <div
        className={`px-4 py-3 flex items-center justify-between ${
          isBlue ? 'bg-blue-950' : 'bg-green-950'
        }`}
      >
        <div className="flex items-center gap-2">
          <span className={`w-2 h-2 rounded-full ${isBlue ? 'bg-blue-400' : 'bg-green-400'}`} />
          <span className={`font-bold text-sm ${isBlue ? 'text-blue-300' : 'text-green-300'}`}>
            {label}
          </span>
          <span className="text-xs text-gray-500 ml-1">{items.length} rows</span>
        </div>
        <span className="text-xs text-gray-500 font-mono truncate max-w-[160px]">
          {dbRef}.supabase.co
        </span>
      </div>
      <div className="divide-y divide-gray-800 max-h-[520px] overflow-y-auto">
        {items.length === 0 ? (
          <div className="px-4 py-8 text-center text-gray-600 text-sm">No items yet</div>
        ) : (
          items.map((item) => (
            <ItemRow
              key={item.id}
              item={item}
              isOnPeer={peerIds.has(item.id)}
              isEditing={editingId === item.id}
              isSaving={savingId === item.id}
              editContent={editContent}
              onEditStart={onEditStart}
              onEditChange={onEditChange}
              onEditSave={onEditSave}
              onEditCancel={onEditCancel}
            />
          ))
        )}
      </div>
    </div>
  )
}

type ItemRowProps = {
  item: TrackedItem
  isOnPeer: boolean
  isEditing: boolean
  isSaving: boolean
  editContent: string
  onEditStart: (item: TrackedItem) => void
  onEditChange: (v: string) => void
  onEditSave: (id: string, content: string, sourceNode: string) => void
  onEditCancel: () => void
}

function ItemRow({
  item,
  isOnPeer,
  isEditing,
  isSaving,
  editContent,
  onEditStart,
  onEditChange,
  onEditSave,
  onEditCancel,
}: ItemRowProps) {
  const lagMs = item.syncedAt ? item.syncedAt - item.receivedAt : null

  if (isEditing) {
    return (
      <div className="px-4 py-3 bg-gray-900">
        <div className="flex gap-2 items-center">
          <input
            autoFocus
            type="text"
            value={editContent}
            onChange={(e) => onEditChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') onEditSave(item.id, editContent, item.source_node)
              if (e.key === 'Escape') onEditCancel()
            }}
            disabled={isSaving}
            className="flex-1 bg-gray-800 border border-indigo-500 rounded px-2 py-1 text-sm text-white focus:outline-none"
          />
          <button
            onClick={() => onEditSave(item.id, editContent, item.source_node)}
            disabled={isSaving || !editContent.trim()}
            className="px-2 py-1 text-xs rounded bg-indigo-600 hover:bg-indigo-500 text-white disabled:opacity-40 transition-colors"
          >
            {isSaving ? '…' : '✓'}
          </button>
          <button
            onClick={onEditCancel}
            disabled={isSaving}
            className="px-2 py-1 text-xs rounded bg-gray-700 hover:bg-gray-600 text-gray-300 disabled:opacity-40 transition-colors"
          >
            ✕
          </button>
        </div>
        <p className="text-xs text-gray-600 mt-1.5">
          Editing · saves to <NodeBadge node={item.source_node} /> then replicates
        </p>
      </div>
    )
  }

  return (
    <div
      className="px-4 py-3 flex items-start justify-between gap-2 group cursor-pointer hover:bg-gray-900 transition-colors"
      onClick={() => onEditStart(item)}
      title="Click to edit"
    >
      <div className="flex-1 min-w-0">
        <p className="text-sm text-white truncate group-hover:text-indigo-300 transition-colors">
          {item.content}
          <span className="ml-2 text-gray-600 text-xs opacity-0 group-hover:opacity-100 transition-opacity">
            ✎
          </span>
        </p>
        <p className="text-xs text-gray-600 mt-0.5">
          {new Date(item.created_at).toLocaleTimeString()} · <NodeBadge node={item.source_node} />
        </p>
      </div>
      {isOnPeer ? (
        <span className="shrink-0 text-xs text-green-400 flex items-center gap-1">
          <span>✓</span>
          <span>{lagMs !== null ? `${lagMs}ms` : 'synced'}</span>
        </span>
      ) : (
        <span className="shrink-0 text-xs text-yellow-500 flex items-center gap-1 animate-pulse">
          <span>⟳</span>
          <span>pending</span>
        </span>
      )}
    </div>
  )
}
