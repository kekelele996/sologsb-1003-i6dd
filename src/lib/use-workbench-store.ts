'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { analyzeDocument, parseMarkdown } from '@/lib/markdown'
import { seedConflicts, seedDiscussions, seedDocument, seedGlossary, seedHistory, seedSegments } from '@/lib/seed'
import type {
  Discussion, DraftSegment, GlossaryTerm, HistoryEntry, ReviewRecord, Segment,
  SegmentStatus, TranslationConflict, TranslationIssue,
} from '@/lib/types'

const TRANSLATOR_KEY = 'sologsb-1003-workbench-translator-v1'
const REVIEWER_KEY = 'sologsb-1003-workbench-reviewer-v1'
const META_KEY = 'sologsb-1003-workbench-meta-v1'
const GLOSSARY_KEY = 'sologsb-1003-workbench-glossary-v1'
const LEGACY_KEY = 'sologsb-1003-localization-draft-v1'
const GLOSSARY_QUERY_KEY = ['glossary']

const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T

type ReviewPayload = { action: string; segmentIds: string[]; reason?: string }

interface Snapshot { drafts: DraftSegment[]; reviews: ReviewRecord[]; discussions: Discussion[] }

// 同步读取持久化的术语表（版本 + 术语），供初始状态与查询初始数据使用
function loadPersistedGlossary(): { version: number; terms: GlossaryTerm[] } {
  if (typeof window === 'undefined') return { version: 1, terms: seedGlossary }
  try {
    const raw = localStorage.getItem(GLOSSARY_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as { version?: number; terms?: GlossaryTerm[] }
      if (parsed.terms?.length) return { version: parsed.version ?? 1, terms: parsed.terms }
    }
  } catch { /* 从种子开始 */ }
  return { version: 1, terms: seedGlossary }
}

const seedDrafts = (): DraftSegment[] => seedSegments.map((segment) => ({
  id: segment.id,
  index: segment.index,
  kind: segment.kind,
  sourceText: segment.sourceText,
  targetText: segment.targetText,
  protectedTokens: segment.protectedTokens,
  note: segment.note,
  draftGlossaryVersion: 1,
}))

const seedReviews = (): ReviewRecord[] => seedSegments.map((segment) => ({
  segmentId: segment.id,
  status: (segment.status === 'confirmed' ? 'confirmed' : segment.status === 'returned' ? 'returned' : 'pending') as SegmentStatus,
  confirmedText: segment.status === 'confirmed' ? segment.targetText : undefined,
  reason: segment.status === 'returned' ? (segment.note || undefined) : undefined,
  glossaryVersion: segment.status === 'confirmed' ? 1 : undefined,
  updatedAt: Date.now(),
}))

// 旧版合并数据按片段归属拆到两端：内容归译者，结论归审校
function migrateLegacy(): { drafts: DraftSegment[]; reviews: ReviewRecord[]; glossary: GlossaryTerm[]; discussions: Discussion[]; history: HistoryEntry[] } | null {
  try {
    const raw = localStorage.getItem(LEGACY_KEY)
    if (!raw) return null
    const legacy = JSON.parse(raw) as {
      segments?: Segment[]
      glossary?: GlossaryTerm[]
      discussions?: Discussion[]
      history?: HistoryEntry[]
    }
    if (!legacy.segments?.length) return null
    const glossary = legacy.glossary ?? seedGlossary
    const drafts: DraftSegment[] = legacy.segments.map((segment) => ({
      id: segment.id,
      index: segment.index,
      kind: segment.kind,
      sourceText: segment.sourceText,
      targetText: segment.targetText,
      protectedTokens: segment.protectedTokens,
      note: segment.note,
      draftGlossaryVersion: 1,
    }))
    const reviews: ReviewRecord[] = legacy.segments.map((segment) => ({
      segmentId: segment.id,
      status: (segment.status === 'confirmed' ? 'confirmed' : segment.status === 'returned' ? 'returned' : 'pending') as SegmentStatus,
      confirmedText: segment.status === 'confirmed' ? segment.targetText : undefined,
      reason: segment.status === 'returned' ? (segment.note || undefined) : undefined,
      glossaryVersion: segment.status === 'confirmed' ? 1 : undefined,
      updatedAt: Date.now(),
    }))
    return { drafts, reviews, glossary, discussions: legacy.discussions ?? seedDiscussions, history: legacy.history ?? seedHistory }
  } catch {
    return null
  }
}

export function useWorkbenchStore() {
  const queryClient = useQueryClient()
  const [hydrated, setHydrated] = useState(false)
  const [drafts, setDrafts] = useState<DraftSegment[]>(seedDrafts)
  const [reviews, setReviews] = useState<ReviewRecord[]>(seedReviews)
  const [discussions, setDiscussions] = useState<Discussion[]>(seedDiscussions)
  const [history, setHistory] = useState<HistoryEntry[]>(seedHistory)
  const [conflicts, setConflicts] = useState<TranslationConflict[]>(seedConflicts)
  const [glossary, setGlossary] = useState<GlossaryTerm[]>(seedGlossary)
  const [glossaryVersion, setGlossaryVersion] = useState(1)
  const [reviewError, setReviewError] = useState<string | null>(null)
  const [lastReviewAction, setLastReviewAction] = useState<ReviewPayload | null>(null)
  const [checkedIssues, setCheckedIssues] = useState<TranslationIssue[] | null>(null)
  const [dirty, setDirty] = useState(false)
  const [past, setPast] = useState<Snapshot[]>([])
  const [future, setFuture] = useState<Snapshot[]>([])

  const prevGlossaryVersion = useRef(1)

  const documentQuery = useQuery({
    queryKey: ['localization-document'],
    queryFn: async () => {
      const response = await fetch('/api/document')
      if (!response.ok) throw new Error('document request failed')
      return response.json()
    },
    initialData: seedDocument,
  })
  const historyQuery = useQuery({
    queryKey: ['localization-history'],
    queryFn: async () => {
      const response = await fetch('/api/history')
      if (!response.ok) throw new Error('history request failed')
      return response.json() as Promise<HistoryEntry[]>
    },
    initialData: seedHistory,
  })
  const conflictQuery = useQuery({
    queryKey: ['localization-conflicts'],
    queryFn: async () => {
      const response = await fetch('/api/conflicts')
      if (!response.ok) throw new Error('conflicts request failed')
      return response.json() as Promise<TranslationConflict[]>
    },
    initialData: seedConflicts,
  })

  // 译者端拉取术语表；失败只挂住译者侧，审校侧照旧可读
  const glossaryQuery = useQuery({
    queryKey: GLOSSARY_QUERY_KEY,
    queryFn: async () => {
      const response = await fetch('/api/glossary')
      if (!response.ok) throw new Error('glossary request failed')
      return response.json() as Promise<{ version: number; terms: GlossaryTerm[] }>
    },
    initialData: { version: 1, terms: seedGlossary },
    retry: false,
  })

  const checkMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch('/api/check', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ segments, glossary }) })
      if (!response.ok) throw new Error('check failed')
      return response.json() as Promise<{ checkedAt: number; issues: TranslationIssue[] }>
    },
    onSuccess: (data) => setCheckedIssues(data.issues),
  })

  const saveMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch('/api/draft', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ documentId: seedDocument.id, segments, discussions }) })
      if (!response.ok) throw new Error('save failed')
      return response.json()
    },
    onSuccess: () => setDirty(false),
  })

  // 审校端送审；失败只挂住审校侧，译者侧照旧可读
  const reviewMutation = useMutation({
    mutationFn: async (payload: ReviewPayload) => {
      const response = await fetch('/api/review', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
      if (!response.ok) throw new Error('review failed')
      return response.json()
    },
    onError: (_error, payload) => {
      setReviewError('送审失败：审校结论尚未同步到服务端，可点击重试。')
      setLastReviewAction(payload)
    },
    onSuccess: () => {
      setReviewError(null)
      setLastReviewAction(null)
    },
  })

  // 术语服务放出新版
  const releaseMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch('/api/glossary/release', { method: 'POST' })
      if (!response.ok) throw new Error('release failed')
      return response.json() as Promise<{ version: number; terms: GlossaryTerm[] }>
    },
    onSuccess: (data) => queryClient.setQueryData(GLOSSARY_QUERY_KEY, data),
  })

  const pushHistoryEntry = useCallback((segmentId: string, action: HistoryEntry['action'], before: string, after: string, author = '当前用户') => {
    setHistory((current) => [{ id: `history-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, segmentId, author, action, before, after, createdAt: Date.now() }, ...current])
  }, [])

  // 术语表升级：照旧版确认过的片段退回待重译，译者译文保留，标出受影响术语
  const applyGlossaryBump = useCallback((oldTerms: GlossaryTerm[], newTerms: GlossaryTerm[], newVersion: number) => {
    const oldMap = new Map(oldTerms.map((term) => [term.id, term]))
    const changedIds = new Set<string>()
    for (const next of newTerms) {
      const prev = oldMap.get(next.id)
      if (!prev || prev.source !== next.source || prev.target !== next.target) changedIds.add(next.id)
    }
    for (const prev of oldTerms) {
      if (!newTerms.some((term) => term.id === prev.id)) changedIds.add(prev.id)
    }
    if (!changedIds.size) return
    setReviews((current) => current.map((record) => {
      if (record.status !== 'confirmed' || (record.glossaryVersion ?? 0) >= newVersion) return record
      const draft = drafts.find((item) => item.id === record.segmentId)
      const affected = newTerms.filter((term) => {
        if (!changedIds.has(term.id) || !draft) return false
        return term.caseSensitive ? draft.sourceText.includes(term.source) : draft.sourceText.toLowerCase().includes(term.source.toLowerCase())
      })
      if (!affected.length) return { ...record, glossaryVersion: newVersion, updatedAt: Date.now() }
      pushHistoryEntry(record.segmentId, 'glossary-update', record.confirmedText ?? '', `术语表更新至 v${newVersion}，受影响术语：${affected.map((term) => term.source).join('、')}`)
      return { ...record, status: 'needs-retranslation', affectedTermIds: affected.map((term) => term.id), glossaryVersion: newVersion, updatedAt: Date.now() }
    }))
  }, [drafts, pushHistoryEntry])

  const bumpRef = useRef(applyGlossaryBump)
  bumpRef.current = applyGlossaryBump

  // 拉到新版术语表时触发升级
  // 拉到术语表：只升级不降级（服务侧重置时保留已持久化的新版本）
  useEffect(() => {
    const data = glossaryQuery.data
    const version = data?.version ?? 1
    const terms = data?.terms ?? seedGlossary
    if (version > prevGlossaryVersion.current) {
      bumpRef.current(glossary, terms, version)
      prevGlossaryVersion.current = version
      setGlossary(terms)
      setGlossaryVersion(version)
    }
  }, [glossaryQuery.data, glossary])

  // 首次打开：旧数据按片段归属迁移到两端，再启用
  useEffect(() => {
    if (hydrated) return
    try {
      const legacy = migrateLegacy()
      if (legacy) {
        setDrafts(legacy.drafts)
        setReviews(legacy.reviews)
        setGlossary(legacy.glossary)
        setDiscussions(legacy.discussions)
        setHistory(legacy.history)
        localStorage.removeItem(LEGACY_KEY)
        localStorage.setItem(TRANSLATOR_KEY, JSON.stringify(legacy.drafts))
        localStorage.setItem(REVIEWER_KEY, JSON.stringify(legacy.reviews))
        localStorage.setItem(META_KEY, JSON.stringify({ discussions: legacy.discussions, history: legacy.history }))
        setHydrated(true)
        return
      }
      const translatorRaw = localStorage.getItem(TRANSLATOR_KEY)
      const reviewerRaw = localStorage.getItem(REVIEWER_KEY)
      const metaRaw = localStorage.getItem(META_KEY)
      setDrafts(translatorRaw ? JSON.parse(translatorRaw) : seedDrafts())
      setReviews(reviewerRaw ? JSON.parse(reviewerRaw) : seedReviews())
      if (metaRaw) {
        const meta = JSON.parse(metaRaw) as { discussions?: Discussion[]; history?: HistoryEntry[] }
        setDiscussions(meta.discussions ?? seedDiscussions)
        setHistory(meta.history ?? seedHistory)
      }
      // 术语表：加载持久化版本（只升级不降级）
      const persisted = loadPersistedGlossary()
      if (persisted.version > 1) {
        setGlossary(persisted.terms)
        setGlossaryVersion(persisted.version)
        prevGlossaryVersion.current = persisted.version
      }
    } catch { /* 从种子开始 */ }
    setHydrated(true)
  }, [hydrated])

  // 两端分别持久化
  useEffect(() => { if (hydrated) localStorage.setItem(TRANSLATOR_KEY, JSON.stringify(drafts)) }, [drafts, hydrated])
  useEffect(() => { if (hydrated) localStorage.setItem(REVIEWER_KEY, JSON.stringify(reviews)) }, [reviews, hydrated])
  useEffect(() => { if (hydrated) localStorage.setItem(META_KEY, JSON.stringify({ discussions, history })) }, [discussions, history, hydrated])
  useEffect(() => { if (hydrated) localStorage.setItem(GLOSSARY_KEY, JSON.stringify({ version: glossaryVersion, terms: glossary })) }, [glossary, glossaryVersion, hydrated])

  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (!dirty) return
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', beforeUnload)
    return () => window.removeEventListener('beforeunload', beforeUnload)
  }, [dirty])

  // 合并视图模型：译者草稿 + 审校结论
  const segments: Segment[] = useMemo(() => drafts.map((draft) => {
    const review = reviews.find((record) => record.segmentId === draft.id)
    return {
      id: draft.id,
      index: draft.index,
      kind: draft.kind,
      sourceText: draft.sourceText,
      targetText: draft.targetText,
      status: review?.status ?? 'pending',
      protectedTokens: draft.protectedTokens,
      note: draft.note,
    }
  }), [drafts, reviews])

  const snapshot = (): Snapshot => ({ drafts: clone(drafts), reviews: clone(reviews), discussions: clone(discussions) })
  const pushUndo = () => { setPast((current) => [...current.slice(-49), snapshot()]); setFuture([]) }

  const undo = () => {
    const previous = past.at(-1)
    if (!previous) return
    setFuture((current) => [snapshot(), ...current])
    setPast((current) => current.slice(0, -1))
    setDrafts(previous.drafts)
    setReviews(previous.reviews)
    setDiscussions(previous.discussions)
    setCheckedIssues(null)
    setDirty(true)
  }
  const redo = () => {
    const next = future[0]
    if (!next) return
    setPast((current) => [...current, snapshot()])
    setFuture((current) => current.slice(1))
    setDrafts(next.drafts)
    setReviews(next.reviews)
    setDiscussions(next.discussions)
    setCheckedIssues(null)
    setDirty(true)
  }

  // 译者改译文：记录依据的术语表版本；审校确认过的片段再动，确认自动撤回（保留 confirmedText 供并排对比）
  const updateTarget = (segmentId: string, targetText: string) => {
    pushUndo()
    const previous = drafts.find((item) => item.id === segmentId)?.targetText ?? ''
    setDrafts((current) => current.map((item) => item.id === segmentId ? { ...item, targetText, draftGlossaryVersion: glossaryVersion } : item))
    setReviews((current) => current.map((record) => {
      if (record.segmentId !== segmentId) return record
      if (record.status === 'confirmed' || record.status === 'needs-retranslation' || record.status === 'returned') {
        return { ...record, status: 'pending', affectedTermIds: undefined, updatedAt: Date.now() }
      }
      return record
    }))
    pushHistoryEntry(segmentId, 'edit', previous, targetText)
    setCheckedIssues(null)
    setDirty(true)
  }

  const confirmSegment = (segmentId: string) => {
    pushUndo()
    const target = drafts.find((item) => item.id === segmentId)?.targetText ?? ''
    setReviews((current) => current.map((record) => record.segmentId === segmentId ? {
      ...record, status: 'confirmed', confirmedText: target, reason: undefined,
      glossaryVersion, affectedTermIds: undefined, updatedAt: Date.now(),
    } : record))
    pushHistoryEntry(segmentId, 'confirm', target, target, '审校 · 当前用户')
    setDirty(true)
    void reviewMutation.mutateAsync({ action: 'confirm', segmentIds: [segmentId] }).catch(() => { /* 错误已挂到审校侧 */ })
  }

  const returnSegment = (segmentId: string, reason = '请根据术语表修改后重新提交。') => {
    pushUndo()
    const target = drafts.find((item) => item.id === segmentId)?.targetText ?? ''
    setReviews((current) => current.map((record) => record.segmentId === segmentId ? {
      ...record, status: 'returned', confirmedText: target, reason,
      glossaryVersion, affectedTermIds: undefined, updatedAt: Date.now(),
    } : record))
    pushHistoryEntry(segmentId, 'return', target, `退回原因：${reason}`, '审校 · 当前用户')
    setDirty(true)
    void reviewMutation.mutateAsync({ action: 'return', segmentIds: [segmentId], reason }).catch(() => { /* 错误已挂到审校侧 */ })
  }

  const bulkReturn = (ids: string[], reason: string) => {
    if (!ids.length) return
    pushUndo()
    setReviews((current) => current.map((record) => ids.includes(record.segmentId) ? {
      ...record, status: 'returned', reason, glossaryVersion, updatedAt: Date.now(),
    } : record))
    ids.forEach((id) => pushHistoryEntry(id, 'return', '', `退回原因：${reason}`, '审校 · 当前用户'))
    setDirty(true)
    void reviewMutation.mutateAsync({ action: 'bulk-return', segmentIds: ids, reason }).catch(() => { /* 错误已挂到审校侧 */ })
  }

  const retryReview = () => {
    if (lastReviewAction) void reviewMutation.mutateAsync(lastReviewAction)
  }
  const retryGlossary = () => {
    // 译者侧重试：发布失败则重试发布，拉取失败则重新拉取
    if (releaseMutation.isError) releaseGlossary()
    else void glossaryQuery.refetch()
  }
  const releaseGlossary = () => { void releaseMutation.mutateAsync() }

  const addDiscussion = (segmentId: string, body: string) => {
    if (!body.trim()) return
    pushUndo()
    const next: Discussion = { id: `discussion-${Date.now()}`, segmentId, author: '译者 · 当前用户', body: body.trim(), resolved: false, createdAt: Date.now() }
    setDiscussions((current) => [next, ...current])
    pushHistoryEntry(segmentId, 'discussion', '', next.body)
  }

  const resolveConflict = (conflict: TranslationConflict, strategy: 'local' | 'remote') => {
    pushUndo()
    const targetText = strategy === 'local' ? conflict.localText : conflict.remoteText
    const previous = drafts.find((item) => item.id === conflict.segmentId)?.targetText ?? ''
    setDrafts((current) => current.map((item) => item.id === conflict.segmentId ? { ...item, targetText, draftGlossaryVersion: glossaryVersion } : item))
    setReviews((current) => current.map((record) => record.segmentId === conflict.segmentId ? { ...record, status: 'pending', affectedTermIds: undefined, updatedAt: Date.now() } : record))
    pushHistoryEntry(conflict.segmentId, 'resolve-conflict', previous, targetText, strategy === 'local' ? '保留本地' : conflict.remoteAuthor)
    setConflicts((current) => current.filter((item) => item.id !== conflict.id))
    setDirty(true)
  }

  const importMarkdown = (markdown: string): string | null => {
    const parsed = parseMarkdown(markdown)
    if (!parsed.length) return null
    pushUndo()
    setDrafts(parsed.map((segment) => ({ ...segment, draftGlossaryVersion: glossaryVersion })))
    setReviews(parsed.map((segment) => ({ segmentId: segment.id, status: 'pending' as SegmentStatus, updatedAt: Date.now() })))
    pushHistoryEntry(parsed[0].id, 'import', '', '导入 Markdown')
    setDirty(true)
    return parsed[0].id
  }

  const liveIssues = useMemo(() => analyzeDocument(segments, glossary), [segments, glossary])
  const issues = checkedIssues ?? liveIssues
  const issueMap = useMemo(() => issues.reduce<Record<string, TranslationIssue[]>>((map, issue) => {
    map[issue.segmentId] = [...(map[issue.segmentId] ?? []), issue]
    return map
  }, {}), [issues])
  const issueSegmentIds = useMemo(() => new Set(issues.map((issue) => issue.segmentId)), [issues])

  const confirmedCount = segments.filter((segment) => segment.status === 'confirmed').length
  const translatedCount = segments.filter((segment) => segment.targetText.trim()).length
  const needsRetranslationCount = reviews.filter((record) => record.status === 'needs-retranslation').length

  const reviewFor = useCallback((segmentId: string) => reviews.find((record) => record.segmentId === segmentId), [reviews])
  const affectedTermsFor = useCallback((segmentId: string): GlossaryTerm[] => {
    const record = reviews.find((item) => item.segmentId === segmentId)
    if (!record?.affectedTermIds?.length) return []
    return record.affectedTermIds.map((id) => glossary.find((term) => term.id === id)).filter((term): term is GlossaryTerm => Boolean(term))
  }, [reviews, glossary])

  return {
    // 状态
    hydrated,
    drafts,
    reviews,
    segments,
    discussions,
    history,
    conflicts,
    glossary,
    glossaryVersion,
    glossaryError: glossaryQuery.isError || releaseMutation.isError,
    reviewError,
    issues,
    issueMap,
    issueSegmentIds,
    checkedIssues,
    dirty,
    past,
    future,
    confirmedCount,
    translatedCount,
    needsRetranslationCount,
    // 查询
    documentQuery,
    historyQuery,
    conflictQuery,
    glossaryQuery,
    checkMutation,
    saveMutation,
    reviewMutation,
    releaseMutation,
    // 操作
    updateTarget,
    confirmSegment,
    returnSegment,
    bulkReturn,
    retryReview,
    retryGlossary,
    releaseGlossary,
    addDiscussion,
    resolveConflict,
    importMarkdown,
    reviewFor,
    affectedTermsFor,
    setCheckedIssues,
    setDirty,
    undo,
    redo,
    pushHistoryEntry,
  }
}

export type WorkbenchStore = ReturnType<typeof useWorkbenchStore>
