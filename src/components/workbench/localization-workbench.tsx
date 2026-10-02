'use client'

import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  AlertCircle, ArrowDown, ArrowUp, BookOpen, Check, CheckCheck, ChevronRight, CircleAlert,
  Cloud, CloudOff, Code2, Download, FileText, GitCompare, History, Import, Languages, Link2,
  Loader2, MessageSquare, RefreshCw, RotateCw, Save, Search, Send, ShieldCheck, Sparkles, Undo2,
  UndoDot, Variable, X,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Progress } from '@/components/ui/progress'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { analyzeDocument, parseMarkdown, renderTargetMarkdown } from '@/lib/markdown'
import {
  LEGACY_DRAFT_KEY, STORAGE_KEYS, affectedTermIds, draftMapOf, effectiveStatus,
  loadJSON, migrateLegacy, newId, removeKey, reviewMapOf, saveJSON, snapshotDiverged,
  type GlossaryCache, type MigrationResult, type ReviewerStore, type TranslatorStore,
  type WorkspaceStore,
} from '@/lib/ownership'
import {
  seedConflicts, seedDiscussions, seedDocument, seedDrafts, seedGlossaryV1, seedHistory,
  seedReviews, seedSourceSegments,
} from '@/lib/seed'
import type {
  Discussion, DraftRecord, EffectiveStatus, GlossaryTerm, GlossaryVersion, HistoryEntry,
  ReviewRecord, SourceSegment, TranslationConflict, TranslationIssue,
} from '@/lib/types'
import { cn } from '@/lib/utils'

const kindIcon = { heading: <FileText className="h-3.5 w-3.5" />, paragraph: <FileText className="h-3.5 w-3.5" />, code: <Code2 className="h-3.5 w-3.5" />, link: <Link2 className="h-3.5 w-3.5" />, variable: <Variable className="h-3.5 w-3.5" /> }
const kindLabel: Record<SourceSegment['kind'], string> = { heading: '标题', paragraph: '段落', code: '代码块', link: '链接', variable: '占位符' }
const statusLabel: Record<EffectiveStatus, string> = { draft: '草稿', 'needs-work': '待处理', confirmed: '已确认', returned: '已退回', retranslate: '术语更新·待重译', withdrawn: '确认已撤回' }
const statusClass: Record<EffectiveStatus, string> = {
  draft: 'bg-slate-100 text-slate-700', 'needs-work': 'bg-amber-100 text-amber-800',
  confirmed: 'bg-emerald-100 text-emerald-800', returned: 'bg-red-100 text-red-800',
  retranslate: 'bg-violet-100 text-violet-800', withdrawn: 'bg-slate-200 text-slate-600',
}
const issueLabel: Record<TranslationIssue['type'], string> = {
  'missing-translation': '漏译', 'missing-variable': '变量缺失', 'link-mismatch': '链接不一致', glossary: '术语不一致', 'code-format': '代码格式',
}
const actionLabel: Record<HistoryEntry['action'], string> = {
  edit: '编辑译文', confirm: '审校确认', return: '审校退回', 'resolve-conflict': '解决冲突',
  import: '导入文档', discussion: '讨论', withdraw: '确认撤回', release: '术语表发布', migrate: '旧数据迁移',
}
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T
const shortVersion = (version: string) => version.replace('glossary-', '')

interface FullSnapshot {
  sources: SourceSegment[]
  drafts: DraftRecord[]
  reviews: ReviewRecord[]
  discussions: Discussion[]
  conflicts: TranslationConflict[]
}

interface PendingReview {
  action: 'confirm' | 'return' | 'bulk-return'
  segmentIds: string[]
  reason?: string
}

export function LocalizationWorkbench() {
  const queryClient = useQueryClient()
  const fileInput = useRef<HTMLInputElement>(null)
  const [sources, setSources] = useState<SourceSegment[]>(seedSourceSegments)
  const [drafts, setDrafts] = useState<DraftRecord[]>(seedDrafts)
  const [reviews, setReviews] = useState<ReviewRecord[]>(seedReviews)
  const [discussions, setDiscussions] = useState<Discussion[]>(seedDiscussions)
  const [history, setHistory] = useState<HistoryEntry[]>(seedHistory)
  const [conflicts, setConflicts] = useState<TranslationConflict[]>(seedConflicts)
  const [glossaryVersion, setGlossaryVersion] = useState<GlossaryVersion>(seedGlossaryV1)
  const [checkedIssues, setCheckedIssues] = useState<TranslationIssue[] | null>(null)
  const [selectedSegmentId, setSelectedSegmentId] = useState('seg-05')
  const [mode, setMode] = useState<'translate' | 'review'>('translate')
  const [filter, setFilter] = useState<'all' | 'issues' | 'untranslated' | 'confirmed' | 'retranslate'>('all')
  const [glossarySearch, setGlossarySearch] = useState('')
  const [discussionDraft, setDiscussionDraft] = useState('')
  const [selectedForReturn, setSelectedForReturn] = useState<Set<string>>(new Set())
  const [returnReason, setReturnReason] = useState('请根据术语表修改后重新提交。')
  const [dirty, setDirty] = useState(false)
  const [saveError, setSaveError] = useState(false)
  const [hydrated, setHydrated] = useState(false)
  const [migrationNotice, setMigrationNotice] = useState<number | null>(null)
  const [pendingReview, setPendingReview] = useState<PendingReview | null>(null)
  const [glossaryFailSwitch, setGlossaryFailSwitch] = useState(false)
  const [reviewFailSwitch, setReviewFailSwitch] = useState(false)
  const [past, setPast] = useState<FullSnapshot[]>([])
  const [future, setFuture] = useState<FullSnapshot[]>([])

  const documentQuery = useQuery({
    queryKey: ['localization-document'],
    queryFn: async () => {
      const response = await fetch('/api/document')
      if (!response.ok) throw new Error('document request failed')
      return response.json()
    },
    initialData: seedDocument,
  })

  const glossaryQuery = useQuery({
    queryKey: ['glossary-current'],
    queryFn: async () => {
      const response = await fetch('/api/glossary/current')
      if (!response.ok) throw new Error('glossary request failed')
      return response.json() as Promise<GlossaryVersion>
    },
    initialData: seedGlossaryV1,
    retry: false,
  })

  const checkMutation = useMutation({
    mutationFn: async () => {
      const targets = Object.fromEntries(drafts.map((draft) => [draft.segmentId, draft.targetText]))
      const response = await fetch('/api/check', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sources, targets, glossary: glossaryVersion.terms, confirmedIds: [...confirmedIdsMemo] }),
      })
      if (!response.ok) throw new Error('check failed')
      return response.json() as Promise<{ checkedAt: number; issues: TranslationIssue[] }>
    },
    onSuccess: (data) => { setCheckedIssues(data.issues); setFilter('issues') },
  })
  const saveMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch('/api/draft', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ documentId: seedDocument.id, drafts }) })
      if (!response.ok) throw new Error('save failed')
      return response.json()
    },
    onSuccess: () => { setDirty(false); setSaveError(false) },
    onError: () => setSaveError(true),
  })
  const reviewMutation = useMutation({
    mutationFn: async (payload: PendingReview) => {
      const response = await fetch('/api/review', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: payload.action, segmentIds: payload.segmentIds, reason: payload.reason }),
      })
      if (!response.ok) throw new Error('review failed')
      return response.json()
    },
    onSuccess: () => setPendingReview(null),
  })
  const releaseMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch('/api/glossary/release', { method: 'POST' })
      if (!response.ok) throw new Error('glossary release failed')
      return response.json() as Promise<GlossaryVersion>
    },
    onSuccess: (next) => {
      queryClient.setQueryData(['glossary-current'], next)
      setCheckedIssues(null)
      setHistory((current) => [{ id: newId('history'), segmentId: '', author: '术语服务', action: 'release', before: shortVersion(glossaryVersion.version), after: `${shortVersion(next.version)}：${next.releaseNote}`, createdAt: Date.now() }, ...current])
    },
  })

  const draftMap = useMemo(() => draftMapOf(drafts), [drafts])
  const reviewMap = useMemo(() => reviewMapOf(reviews), [reviews])
  const termsById = useMemo(() => new Map<string, GlossaryTerm>(glossaryVersion.terms.map((term) => [term.id, term])), [glossaryVersion])
  const changedTermIds = useMemo(() => new Set((glossaryVersion.changes ?? []).map((change) => change.termId)), [glossaryVersion])
  const confirmedIdsMemo = useMemo(() => new Set(sources
    .map((source) => reviewMap.get(source.id))
    .filter((review): review is ReviewRecord => !!review && !review.withdrawn && review.glossaryVersion === glossaryVersion.version && review.status === 'confirmed')
    .map((review) => review.segmentId)), [sources, reviewMap, glossaryVersion.version])
  const statusOf = (source: SourceSegment): EffectiveStatus => effectiveStatus(reviewMap.get(source.id), draftMap.get(source.id), glossaryVersion.version)
  const textOf = (segmentId: string) => draftMap.get(segmentId)?.targetText ?? ''

  const liveIssues = useMemo(
    () => analyzeDocument(sources, textOf, glossaryVersion.terms, confirmedIdsMemo),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sources, draftMap, glossaryVersion, confirmedIdsMemo],
  )
  const issues = checkedIssues ?? liveIssues
  const issueMap = useMemo(() => issues.reduce<Record<string, TranslationIssue[]>>((map, issue) => {
    map[issue.segmentId] = [...(map[issue.segmentId] ?? []), issue]
    return map
  }, {}), [issues])
  const issueSegmentIds = useMemo(() => new Set(issues.map((issue) => issue.segmentId)), [issues])
  const filteredSegments = useMemo(() => sources.filter((source) => {
    if (filter === 'issues') return issueSegmentIds.has(source.id)
    if (filter === 'untranslated') return !textOf(source.id).trim()
    if (filter === 'confirmed') return statusOf(source) === 'confirmed'
    if (filter === 'retranslate') return statusOf(source) === 'retranslate'
    return true
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [filter, issueSegmentIds, sources, draftMap, reviewMap, glossaryVersion.version])
  const selectedSegment = sources.find((source) => source.id === selectedSegmentId) ?? sources[0]
  const statusCounts = useMemo(() => {
    const counts: Record<EffectiveStatus, number> = { draft: 0, 'needs-work': 0, confirmed: 0, returned: 0, retranslate: 0, withdrawn: 0 }
    for (const source of sources) counts[statusOf(source)] += 1
    return counts
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sources, draftMap, reviewMap, glossaryVersion.version])
  const translatedCount = sources.filter((source) => textOf(source.id).trim()).length
  const progress = sources.length ? Math.round((statusCounts.confirmed / sources.length) * 100) : 0
  const filteredGlossary = glossaryVersion.terms.filter((term) => `${term.source} ${term.target}`.toLowerCase().includes(glossarySearch.toLowerCase()))
  const selectedDiscussions = discussions.filter((discussion) => discussion.segmentId === selectedSegment?.id)
  const glossaryServiceDown = glossaryQuery.isError
  const mockConnected = documentQuery.isFetched

  /** 旧数据第一次打开：按片段归属迁移到两端，再启用工作台 */
  useEffect(() => {
    if (hydrated) return
    try {
      const alreadyMigrated = localStorage.getItem(STORAGE_KEYS.schema) === 'v2'
      if (!alreadyMigrated) {
        const legacyRaw = localStorage.getItem(LEGACY_DRAFT_KEY)
        if (legacyRaw) {
          const legacy = JSON.parse(legacyRaw) as Parameters<typeof migrateLegacy>[0]
          const result = migrateLegacy(legacy, seedGlossaryV1)
          setDrafts(result.translator.drafts.length ? result.translator.drafts : seedDrafts)
          setReviews(result.reviewer.records)
          setDiscussions(result.workspace.discussions)
          setHistory((current) => [{ id: newId('history'), segmentId: '', author: '系统', action: 'migrate', before: '混合存储 v1', after: `已按片段归属迁移 ${result.migratedSegmentCount} 条：译文归译者端、结论归审校端`, createdAt: Date.now() }, ...result.workspace.history.length ? result.workspace.history : current])
          setConflicts(result.workspace.conflicts)
          if (result.glossary) setGlossaryVersion(result.glossary.version)
          saveJSON(STORAGE_KEYS.translator, result.translator)
          saveJSON(STORAGE_KEYS.reviewer, result.reviewer)
          saveJSON(STORAGE_KEYS.workspace, { discussions: result.workspace.discussions, history: result.workspace.history, conflicts: result.workspace.conflicts } satisfies WorkspaceStore)
          if (result.glossary) saveJSON(STORAGE_KEYS.glossary, result.glossary satisfies GlossaryCache)
          saveJSON(STORAGE_KEYS.schema, 'v2')
          removeKey(LEGACY_DRAFT_KEY)
          setMigrationNotice(result.migratedSegmentCount)
          setHydrated(true)
          return
        }
        saveJSON(STORAGE_KEYS.schema, 'v2')
      } else {
        const translatorStore = loadJSON<TranslatorStore>(STORAGE_KEYS.translator)
        const reviewerStore = loadJSON<ReviewerStore>(STORAGE_KEYS.reviewer)
        const workspaceStore = loadJSON<WorkspaceStore>(STORAGE_KEYS.workspace)
        const glossaryCache = loadJSON<GlossaryCache>(STORAGE_KEYS.glossary)
        if (translatorStore?.drafts?.length) setDrafts(translatorStore.drafts)
        if (reviewerStore?.records) setReviews(reviewerStore.records)
        if (workspaceStore) {
          setDiscussions(workspaceStore.discussions ?? seedDiscussions)
          setHistory(workspaceStore.history ?? seedHistory)
          setConflicts(workspaceStore.conflicts ?? seedConflicts)
        }
        if (glossaryCache?.version) setGlossaryVersion(glossaryCache.version)
      }
    } catch { /* start from seed */ }
    setHydrated(true)
  }, [hydrated])

  /** 两端各自持久化，互不覆盖 */
  useEffect(() => { if (hydrated) saveJSON(STORAGE_KEYS.translator, { drafts } satisfies TranslatorStore) }, [drafts, hydrated])
  useEffect(() => { if (hydrated) saveJSON(STORAGE_KEYS.reviewer, { records: reviews } satisfies ReviewerStore) }, [reviews, hydrated])
  useEffect(() => { if (hydrated) saveJSON(STORAGE_KEYS.workspace, { discussions, history, conflicts } satisfies WorkspaceStore) }, [discussions, history, conflicts, hydrated])
  useEffect(() => {
    if (!hydrated) return
    if (glossaryQuery.data) {
      setGlossaryVersion(glossaryQuery.data)
      saveJSON(STORAGE_KEYS.glossary, { version: glossaryQuery.data, seenAt: Date.now() } satisfies GlossaryCache)
    }
  }, [glossaryQuery.data, hydrated])

  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (!dirty) return
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', beforeUnload)
    return () => window.removeEventListener('beforeunload', beforeUnload)
  }, [dirty])

  const snapshot = (): FullSnapshot => ({ sources: clone(sources), drafts: clone(drafts), reviews: clone(reviews), discussions: clone(discussions), conflicts: clone(conflicts) })
  const commit = (next: Partial<FullSnapshot>) => {
    setPast((current) => [...current.slice(-49), snapshot()])
    setFuture([])
    if (next.sources !== undefined) setSources(next.sources)
    if (next.drafts !== undefined) setDrafts(next.drafts)
    if (next.reviews !== undefined) setReviews(next.reviews)
    if (next.discussions !== undefined) setDiscussions(next.discussions)
    if (next.conflicts !== undefined) setConflicts(next.conflicts)
    setCheckedIssues(null)
    setDirty(true)
  }
  const pushHistoryEntry = (segmentId: string, action: HistoryEntry['action'], before: string, after: string, author = '当前用户') => {
    setHistory((current) => [{ id: newId('history'), segmentId, author, action, before, after, createdAt: Date.now() }, ...current])
  }

  /** 译者写译文：草稿记住当前术语表版本；动到审校确认过的片段时自动撤回确认并留档 */
  const writeDraft = (source: SourceSegment, targetText: string, action: HistoryEntry['action'] = 'edit', author = '译者 · 当前用户', historyAfter?: string) => {
    const previousDraft = draftMap.get(source.id)
    const nextDrafts = drafts.some((draft) => draft.segmentId === source.id)
      ? drafts.map((draft) => draft.segmentId === source.id
        ? { ...draft, targetText, glossaryVersion: glossaryVersion.version, needsWork: false, updatedAt: Date.now() }
        : draft)
      : [...drafts, { segmentId: source.id, targetText, glossaryVersion: glossaryVersion.version, needsWork: false, updatedAt: Date.now() }]
    const activeReview = reviewMap.get(source.id)
    let nextReviews = reviews
    if (activeReview && !activeReview.withdrawn) {
      if (activeReview.status === 'confirmed' && activeReview.glossaryVersion === glossaryVersion.version) {
        // 当前版本的确认被动到：自动撤回，审校那份译文保留，页面上与当前译文并排对比
        nextReviews = reviews.map((record) => record.segmentId === source.id ? { ...record, withdrawn: true } : record)
        pushHistoryEntry(source.id, 'withdraw', activeReview.snapshotText, targetText, '系统')
      } else {
        // 已退回、或按旧版术语表确认而退回待重译的片段：改好即解除旧结论，交回正常流程
        nextReviews = reviews.filter((record) => record.segmentId !== source.id)
      }
    }
    commit({ drafts: nextDrafts, reviews: nextReviews })
    pushHistoryEntry(source.id, action, previousDraft?.targetText ?? '', historyAfter ?? targetText, author)
    setSelectedForReturn((current) => { const copy = new Set(current); copy.delete(source.id); return copy })
  }

  /** 审校端下结论：留存确认/退回当时的译文与术语表版本 */
  const decideReview = (source: SourceSegment, status: 'confirmed' | 'returned', reason?: string) => {
    const draft = draftMap.get(source.id)
    const record: ReviewRecord = {
      segmentId: source.id,
      status,
      snapshotText: draft?.targetText ?? '',
      glossaryVersion: glossaryVersion.version,
      reason,
      reviewer: '审校 · 当前用户',
      decidedAt: Date.now(),
    }
    const nextReviews = [...reviews.filter((item) => item.segmentId !== source.id), record]
    const nextDrafts = draft?.needsWork ? drafts.map((item) => item.segmentId === source.id ? { ...item, needsWork: false } : item) : drafts
    commit({ reviews: nextReviews, drafts: nextDrafts })
    pushHistoryEntry(source.id, status === 'confirmed' ? 'confirm' : 'return', record.snapshotText, reason ?? record.snapshotText, record.reviewer)
    setSelectedForReturn((current) => { const copy = new Set(current); copy.delete(source.id); return copy })
    const payload: PendingReview = { action: status === 'confirmed' ? 'confirm' : 'return', segmentIds: [source.id], reason }
    setPendingReview(payload)
    void reviewMutation.mutateAsync(payload).catch(() => { /* 送审失败只挂住审校侧，等待按侧重试 */ })
  }

  const undo = () => {
    const previous = past.at(-1)
    if (!previous) return
    setFuture((current) => [snapshot(), ...current])
    setPast((current) => current.slice(0, -1))
    setSources(previous.sources); setDrafts(previous.drafts); setReviews(previous.reviews)
    setDiscussions(previous.discussions); setConflicts(previous.conflicts)
    setCheckedIssues(null); setDirty(true)
  }
  const redo = () => {
    const next = future[0]
    if (!next) return
    setPast((current) => [...current, snapshot()])
    setFuture((current) => current.slice(1))
    setSources(next.sources); setDrafts(next.drafts); setReviews(next.reviews)
    setDiscussions(next.discussions); setConflicts(next.conflicts)
    setCheckedIssues(null); setDirty(true)
  }
  const selectAndScroll = (segmentId: string) => {
    setSelectedSegmentId(segmentId)
    requestAnimationFrame(() => document.getElementById(`segment-${segmentId}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }))
  }
  const nextIssue = (direction: 1 | -1 = 1) => {
    const ids = Array.from(new Set(issues.map((issue) => issue.segmentId)))
    if (!ids.length) return
    const index = Math.max(0, ids.indexOf(selectedSegmentId))
    const nextIndex = direction > 0 ? (index + 1) % ids.length : (index - 1 + ids.length) % ids.length
    selectAndScroll(ids[nextIndex])
  }
  const addDiscussion = () => {
    if (!selectedSegment || !discussionDraft.trim()) return
    const nextDiscussion: Discussion = { id: newId('discussion'), segmentId: selectedSegment.id, author: '译者 · 当前用户', body: discussionDraft.trim(), resolved: false, createdAt: Date.now() }
    commit({ discussions: [nextDiscussion, ...discussions] })
    pushHistoryEntry(selectedSegment.id, 'discussion', '', nextDiscussion.body)
    setDiscussionDraft('')
  }
  const bulkReturn = () => {
    if (!selectedForReturn.size) return
    const ids = Array.from(selectedForReturn)
    const timestamp = Date.now()
    const newRecords: ReviewRecord[] = ids.map((id) => ({
      segmentId: id,
      status: 'returned' as const,
      snapshotText: draftMap.get(id)?.targetText ?? '',
      glossaryVersion: glossaryVersion.version,
      reason: returnReason,
      reviewer: '审校 · 当前用户',
      decidedAt: timestamp,
    }))
    commit({ reviews: [...reviews.filter((record) => !ids.includes(record.segmentId)), ...newRecords] })
    ids.forEach((id) => pushHistoryEntry(id, 'return', returnReason, `退回原因：${returnReason}`, '审校 · 当前用户'))
    const payload: PendingReview = { action: 'bulk-return', segmentIds: ids, reason: returnReason }
    setPendingReview(payload)
    void reviewMutation.mutateAsync(payload).catch(() => { /* 送审失败只挂住审校侧 */ })
    setSelectedForReturn(new Set())
  }
  const resolveConflict = (conflict: TranslationConflict, strategy: 'local' | 'remote') => {
    const source = sources.find((item) => item.id === conflict.segmentId)
    if (!source) return
    const targetText = strategy === 'local' ? conflict.localText : conflict.remoteText
    writeDraft(source, targetText, 'resolve-conflict', strategy === 'local' ? '保留本地' : conflict.remoteAuthor, targetText)
    setConflicts((current) => current.filter((item) => item.id !== conflict.id))
  }
  const importMarkdown = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return
    const imported = parseMarkdown(await file.text())
    if (!imported.length) return
    const importedDrafts: DraftRecord[] = imported.map((segment) => ({ segmentId: segment.id, targetText: '', glossaryVersion: glossaryVersion.version, updatedAt: Date.now() }))
    commit({ sources: imported, drafts: importedDrafts, reviews: [], discussions: [], conflicts: [] })
    pushHistoryEntry(imported[0].id, 'import', '', file.name)
    setSelectedSegmentId(imported[0].id)
    event.target.value = ''
  }
  const exportMarkdown = () => {
    const blob = new Blob([renderTargetMarkdown(sources, textOf)], { type: 'text/markdown;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = documentQuery.data.sourceFile.replace(/\.md$/, '.zh-CN.md')
    anchor.click()
    URL.revokeObjectURL(url)
  }
  const toggleReturnSelection = (segmentId: string) => {
    setSelectedForReturn((current) => {
      const next = new Set(current)
      next.has(segmentId) ? next.delete(segmentId) : next.add(segmentId)
      return next
    })
  }
  const toggleGlossaryFail = (checked: boolean) => {
    setGlossaryFailSwitch(checked)
    try { checked ? localStorage.setItem('sologsb-1003-glossary-service-fail', '1') : localStorage.removeItem('sologsb-1003-glossary-service-fail') } catch { /* ignore */ }
  }
  const toggleReviewFail = (checked: boolean) => {
    setReviewFailSwitch(checked)
    try { checked ? localStorage.setItem('sologsb-1003-review-service-fail', '1') : localStorage.removeItem('sologsb-1003-review-service-fail') } catch { /* ignore */ }
  }

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement
      const editing = ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) || target.isContentEditable
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z') {
        event.preventDefault(); event.shiftKey ? redo() : undo(); return
      }
      if (editing) return
      if (event.key.toLowerCase() === 'j') { event.preventDefault(); nextIssue(1) }
      if (event.key.toLowerCase() === 'k') { event.preventDefault(); nextIssue(-1) }
      if (event.key.toLowerCase() === 'c' && selectedSegment && mode === 'review') decideReview(selectedSegment, 'confirmed')
      if (event.key.toLowerCase() === 'r' && selectedSegment && mode === 'review') decideReview(selectedSegment, 'returned', returnReason)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  })

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top_left,#e8f1ff_0,transparent_32%)] pb-24">
      <header className="sticky top-0 z-40 border-b border-slate-800/80 bg-slate-950/95 text-white shadow-xl backdrop-blur">
        <div className="mx-auto flex max-w-[1800px] items-center gap-5 px-4 py-3 lg:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-blue-400/30 bg-blue-500/15 text-blue-300"><Languages className="h-5 w-5" /></div>
            <div className="min-w-0"><h1 className="truncate font-semibold tracking-tight">开源文档本地化工作台</h1><p className="truncate text-[11px] text-slate-400">{documentQuery.data.sourceFile} · {documentQuery.data.title}</p></div>
          </div>
          <div className="hidden items-center gap-2 md:flex">
            <Badge className={cn(mockConnected ? 'bg-emerald-500/15 text-emerald-300' : 'bg-amber-500/15 text-amber-300', 'border-0')}>{mockConnected ? <Cloud className="mr-1 h-3 w-3" /> : <CloudOff className="mr-1 h-3 w-3" />}{mockConnected ? 'MSW 已连接' : '连接模拟接口'}</Badge>
            <Badge className={cn('border-0', glossaryServiceDown ? 'bg-red-500/20 text-red-300' : 'bg-slate-700 text-slate-200')}><BookOpen className="mr-1 h-3 w-3" />{glossaryServiceDown ? '术语服务中断（译者侧重试）' : `术语表 ${shortVersion(glossaryVersion.version)}`}</Badge>
            <Badge className={cn('border-0', dirty ? 'bg-amber-500/15 text-amber-300' : saveError ? 'bg-red-500/20 text-red-300' : 'bg-slate-700 text-slate-200')}>{saveMutation.isPending ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Save className="mr-1 h-3 w-3" />}{saveMutation.isPending ? '保存中' : saveError ? '草稿保存失败' : dirty ? '草稿未保存' : '已持久化'}</Badge>
          </div>
          <div className="header-actions ml-auto flex items-center gap-2">
            <Tabs value={mode} onValueChange={(value) => setMode(value as 'translate' | 'review')}><TabsList className="bg-slate-800"><TabsTrigger value="translate" className="text-slate-300 data-[state=active]:bg-blue-600 data-[state=active]:text-white">翻译</TabsTrigger><TabsTrigger value="review" className="text-slate-300 data-[state=active]:bg-blue-600 data-[state=active]:text-white">审校</TabsTrigger></TabsList></Tabs>
            <Button variant="outline" size="sm" className="border-slate-700 bg-slate-900 text-slate-200 hover:bg-slate-800 hover:text-white" onClick={undo} disabled={!past.length}><Undo2 className="h-4 w-4" />撤销</Button>
            <Button variant="outline" size="sm" className="border-slate-700 bg-slate-900 text-slate-200 hover:bg-slate-800 hover:text-white" onClick={redo} disabled={!future.length}><RotateCw className="h-4 w-4" />重做</Button>
            <input ref={fileInput} type="file" accept=".md,.markdown,text/markdown" className="hidden" onChange={(event) => void importMarkdown(event)} />
            <Button variant="outline" size="sm" className="border-slate-700 bg-slate-900 text-slate-200 hover:bg-slate-800 hover:text-white" onClick={() => fileInput.current?.click()}><Import className="h-4 w-4" />导入</Button>
            <Button size="sm" onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}><Save className="h-4 w-4" />保存</Button>
          </div>
        </div>
      </header>

      {migrationNotice !== null && (
        <div className="border-b border-blue-200 bg-blue-50 px-4 py-2.5 lg:px-6">
          <div className="mx-auto flex max-w-[1800px] items-center gap-3 text-xs text-blue-800">
            <ShieldCheck className="h-4 w-4 shrink-0" />
            <span>旧数据已按片段归属迁移完成：<b>{migrationNotice}</b> 条译文归入译者端草稿，审校确认/退回结论（含当时译文快照）归入审校端，之后工作台才启用。</span>
            <Button size="sm" variant="ghost" className="ml-auto h-7 text-blue-700" onClick={() => setMigrationNotice(null)}><X className="h-3.5 w-3.5" />知道了</Button>
          </div>
        </div>
      )}

      <div className="border-b bg-white/85 px-4 py-2.5 backdrop-blur lg:px-6">
        <div className="mx-auto flex max-w-[1800px] flex-wrap items-center gap-x-6 gap-y-2 text-xs text-slate-600">
          <span><b className="text-slate-900">{sources.length}</b> 个内容块</span>
          <span><b className="text-slate-900">{translatedCount}</b> 已翻译</span>
          <span className="flex items-center gap-1"><CircleAlert className="h-3.5 w-3.5 text-amber-600" /><b className="text-slate-900">{issues.length}</b> 个检查结果</span>
          <span className="flex items-center gap-1"><CheckCheck className="h-3.5 w-3.5 text-emerald-600" /><b className="text-slate-900">{statusCounts.confirmed}</b> 已确认</span>
          {statusCounts.retranslate > 0 && <span className="flex items-center gap-1 text-violet-700"><RefreshCw className="h-3.5 w-3.5" /><b>{statusCounts.retranslate}</b> 术语更新待重译</span>}
          {statusCounts.withdrawn > 0 && <span className="flex items-center gap-1 text-slate-600"><Undo2 className="h-3.5 w-3.5" /><b>{statusCounts.withdrawn}</b> 确认已撤回</span>}
          <div className="ml-auto flex min-w-[220px] items-center gap-3"><span>审校进度 {progress}%</span><Progress value={progress} className="w-36" /></div>
          <Button size="sm" variant="secondary" onClick={() => checkMutation.mutate()} disabled={checkMutation.isPending}>{checkMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}运行本地术语检查</Button>
          <Button size="sm" variant="outline" onClick={exportMarkdown}><Download className="h-4 w-4" />导出译文</Button>
        </div>
      </div>

      <main className="workbench-grid mx-auto grid max-w-[1800px] grid-cols-[270px_minmax(620px,1fr)_340px] gap-4 p-4 lg:p-5">
        <aside className="workbench-left space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-sm">
                <BookOpen className="h-4 w-4 text-blue-600" />术语服务
                <Badge variant="secondary">{glossaryVersion.terms.length}</Badge>
                <Badge variant="outline" className="ml-auto text-[10px]">{shortVersion(glossaryVersion.version)}</Badge>
              </CardTitle>
              <p className="mt-1 text-[10px] leading-relaxed text-slate-500">{glossaryVersion.releaseNote} · 发布于 {new Date(glossaryVersion.releasedAt).toLocaleString('zh-CN')}</p>
              <div className="relative mt-2"><Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-slate-400" /><Input value={glossarySearch} onChange={(event) => setGlossarySearch(event.target.value)} placeholder="搜索术语" className="h-9 pl-8 text-xs" /></div>
            </CardHeader>
            <CardContent className="space-y-2">
              {glossaryServiceDown && (
                <div className="rounded-lg border border-red-200 bg-red-50 p-2.5">
                  <p className="flex items-center gap-1.5 text-[11px] font-medium text-red-700"><CloudOff className="h-3.5 w-3.5" />术语表拉取失败，只挂住译者侧</p>
                  <p className="mt-1 text-[10px] leading-relaxed text-red-600">当前显示的是上次缓存（{shortVersion(glossaryVersion.version)}），审校侧与已缓存内容照旧可读。</p>
                  <Button size="sm" variant="outline" className="mt-2 h-7 w-full border-red-300 text-[11px] text-red-700 hover:bg-red-100" onClick={() => void glossaryQuery.refetch()}>{glossaryQuery.isFetching ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}按侧重试拉取</Button>
                </div>
              )}
              <div className="flex items-center justify-between gap-2">
                <label className="flex cursor-pointer items-center gap-1.5 text-[10px] text-slate-500"><input type="checkbox" checked={glossaryFailSwitch} onChange={(event) => toggleGlossaryFail(event.target.checked)} className="h-3.5 w-3.5 accent-red-600" />模拟术语服务故障</label>
                <Button size="sm" variant="outline" className="h-7 text-[11px]" disabled={releaseMutation.isPending || glossaryVersion.version !== 'glossary-v1'} onClick={() => releaseMutation.mutate()}>
                  {releaseMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                  {glossaryVersion.version === 'glossary-v1' ? '发布 v2 新版' : '新版已发布'}
                </Button>
              </div>
              {filteredGlossary.map((term) => (
                <div key={term.id} className={cn('rounded-lg border p-2.5', changedTermIds.has(term.id) ? 'border-violet-200 bg-violet-50/60' : 'bg-slate-50/70')}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-semibold text-slate-800">{term.source}</span>
                    <ChevronRight className="h-3.5 w-3.5 text-slate-400" />
                    <span className="text-xs font-semibold text-blue-700">{term.target}</span>
                  </div>
                  <div className="mt-1 flex items-center justify-between gap-2">
                    <p className="text-[10px] leading-relaxed text-slate-500">{term.note}</p>
                    {changedTermIds.has(term.id) && <Badge className="shrink-0 bg-violet-200 text-violet-800 hover:bg-violet-200">{glossaryVersion.changes?.find((change) => change.termId === term.id)?.kind === 'added' ? '新增' : '译法变更'}</Badge>}
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3"><CardTitle className="flex items-center gap-2 text-sm"><AlertCircle className="h-4 w-4 text-amber-600" />问题导航 <Badge variant={issues.length ? 'warning' : 'success'}>{issues.length}</Badge></CardTitle></CardHeader>
            <CardContent className="space-y-2">
              {issues.slice(0, 14).map((issue) => {
                const source = sources.find((item) => item.id === issue.segmentId)
                return <button key={issue.id} className={cn('w-full rounded-lg border p-2.5 text-left transition hover:border-blue-300 hover:bg-blue-50', selectedSegmentId === issue.segmentId && 'border-blue-300 bg-blue-50')} onClick={() => selectAndScroll(issue.segmentId)}><div className="flex items-center justify-between gap-2"><Badge variant={issue.severity === 'error' ? 'destructive' : 'warning'}>{issueLabel[issue.type]}</Badge><span className="text-[10px] text-slate-400">#{source?.index}</span></div><p className="mt-1.5 text-[11px] leading-relaxed text-slate-600">{issue.message}</p></button>
              })}
              {!issues.length && <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-center text-xs text-emerald-700"><Check className="mx-auto mb-2 h-5 w-5" />所有检查已通过</div>}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3"><CardTitle className="flex items-center gap-2 text-sm"><GitCompare className="h-4 w-4 text-violet-600" />批量退回 <Badge variant="secondary">{selectedForReturn.size}</Badge></CardTitle></CardHeader>
            <CardContent>
              <p className="mb-3 text-[11px] leading-relaxed text-slate-500">在段落标题处勾选需要退回的片段，填写原因后统一提交。送审失败只挂住审校侧。</p>
              <Textarea value={returnReason} onChange={(event) => setReturnReason(event.target.value)} rows={3} className="text-xs" />
              <label className="mt-3 flex cursor-pointer items-center gap-1.5 text-[10px] text-slate-500"><input type="checkbox" checked={reviewFailSwitch} onChange={(event) => toggleReviewFail(event.target.checked)} className="h-3.5 w-3.5 accent-red-600" />模拟送审服务故障</label>
              <Button className="mt-3 w-full" variant="destructive" disabled={!selectedForReturn.size || reviewMutation.isPending} onClick={bulkReturn}>{reviewMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <UndoDot className="h-4 w-4" />}批量退回 {selectedForReturn.size || ''}</Button>
              {pendingReview && (
                <div className="mt-3 rounded-lg border border-red-200 bg-red-50 p-2.5">
                  <p className="text-[11px] font-medium text-red-700">送审失败（{pendingReview.action === 'bulk-return' ? `批量退回 ${pendingReview.segmentIds.length} 条` : pendingReview.action === 'confirm' ? '确认' : '退回'}）</p>
                  <p className="mt-1 text-[10px] text-red-600">审校结论已暂存在本侧，译者侧照旧可读可改。</p>
                  <div className="mt-2 flex gap-2">
                    <Button size="sm" variant="outline" className="h-7 flex-1 border-red-300 text-[11px] text-red-700 hover:bg-red-100" onClick={() => void reviewMutation.mutateAsync(pendingReview).catch(() => {})}>{reviewMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}按侧重试</Button>
                    <Button size="sm" variant="ghost" className="h-7 text-[11px]" onClick={() => setPendingReview(null)}>暂不处理</Button>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </aside>

        <section className="workbench-center min-w-0 space-y-3">
          <div className="flex flex-wrap items-center gap-2 rounded-xl border bg-white p-2.5 shadow-sm">
            <div className="flex flex-wrap items-center rounded-lg bg-slate-100 p-1">
              {([['all', '全部'], ['issues', '问题'], ['untranslated', '漏译'], ['retranslate', '待重译'], ['confirmed', '已确认']] as const).map(([value, label]) => <button key={value} onClick={() => setFilter(value)} className={cn('rounded-md px-3 py-1.5 text-xs font-medium transition', filter === value ? 'bg-white text-blue-700 shadow-sm' : 'text-slate-500 hover:text-slate-800')}>{label}</button>)}
            </div>
            <div className="ml-auto flex items-center gap-2 text-xs text-slate-500"><span>{filteredSegments.length} / {sources.length}</span><Button variant="outline" size="sm" onClick={() => nextIssue(-1)}><ArrowUp className="h-3.5 w-3.5" />上一问题</Button><Button variant="outline" size="sm" onClick={() => nextIssue(1)}>下一问题<ArrowDown className="h-3.5 w-3.5" /></Button></div>
          </div>

          {filteredSegments.map((segment) => {
            const segmentIssues = issueMap[segment.id] ?? []
            const draft = draftMap.get(segment.id)
            const review = reviewMap.get(segment.id)
            const status = statusOf(segment)
            const targetText = draft?.targetText ?? ''
            const isSelected = selectedSegment?.id === segment.id
            const isReturnSelected = selectedForReturn.has(segment.id)
            const impacted = status === 'retranslate' ? affectedTermIds(segment, review, draft, glossaryVersion, termsById) : []
            const diverged = status === 'withdrawn' && snapshotDiverged(review, draft)
            const draftStale = !!draft && draft.glossaryVersion !== glossaryVersion.version
            return (
              <article id={`segment-${segment.id}`} key={segment.id} onClick={() => setSelectedSegmentId(segment.id)} className={cn('scroll-mt-32 overflow-hidden rounded-xl border bg-white shadow-sm transition', isSelected && 'ring-2 ring-blue-500/30', (status === 'returned' || segmentIssues.some((issue) => issue.severity === 'error')) && 'border-red-200', status === 'retranslate' && 'border-violet-300')}>
                <header className="flex flex-wrap items-center gap-2 border-b bg-slate-50/80 px-3 py-2.5">
                  <input type="checkbox" checked={isReturnSelected} onChange={() => toggleReturnSelection(segment.id)} onClick={(event) => event.stopPropagation()} className="h-4 w-4 rounded border-slate-300 accent-blue-600" aria-label={`选择片段 ${segment.index}`} />
                  <span className="text-[11px] font-semibold text-slate-500">#{String(segment.index).padStart(2, '0')}</span>
                  <Badge variant="outline" className="gap-1 text-[10px]">{kindIcon[segment.kind]}{kindLabel[segment.kind]}</Badge>
                  <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-medium', statusClass[status])}>{statusLabel[status]}</span>
                  {draft && <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-medium', draftStale ? 'bg-amber-100 text-amber-800' : 'bg-slate-100 text-slate-500')} title="译者草稿所依据的术语表版本">草稿依据 {shortVersion(draft.glossaryVersion)}</span>}
                  {segment.protectedTokens.length > 0 && <Badge variant="secondary" className="gap-1 text-[10px]"><Variable className="h-3 w-3" />{segment.protectedTokens.length} 个受保护标记</Badge>}
                  {!!segmentIssues.length && <Badge variant="destructive" className="ml-auto">{segmentIssues.length} 个问题</Badge>}
                  <div className={cn('flex gap-1.5', !segmentIssues.length && 'ml-auto')}>
                    {mode === 'review' && <><Button size="sm" variant="outline" className="border-emerald-300 text-emerald-700 hover:bg-emerald-50" onClick={(event) => { event.stopPropagation(); decideReview(segment, 'confirmed') }}><Check className="h-3.5 w-3.5" />确认</Button><Button size="sm" variant="outline" className="border-red-200 text-red-700 hover:bg-red-50" onClick={(event) => { event.stopPropagation(); decideReview(segment, 'returned', returnReason) }}><X className="h-3.5 w-3.5" />退回</Button></>}
                  </div>
                </header>
                <div className="compare-grid grid grid-cols-2 divide-x">
                  <div className="min-w-0 p-3.5">
                    <div className="mb-2 flex items-center justify-between"><span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">English · Source</span><Badge variant="outline" className="text-[9px]">只读</Badge></div>
                    <div className={cn('document-prose text-sm leading-6 text-slate-700', segment.kind === 'code' && 'markdown-code rounded-lg bg-slate-950 p-3 text-xs text-slate-100')}>{segment.sourceText}</div>
                    {segment.note && <p className="mt-3 rounded-md bg-amber-50 px-2.5 py-1.5 text-[10px] text-amber-700">译者备注：{segment.note}</p>}
                  </div>
                  <div className="min-w-0 p-3.5">
                    <div className="mb-2 flex items-center justify-between"><span className="text-[10px] font-semibold uppercase tracking-wider text-blue-500">简体中文 · Target · 译者端</span>{mode === 'translate' ? <Badge variant="outline" className="text-[9px]">编辑中</Badge> : <Badge variant="secondary" className="text-[9px]">审校只读</Badge>}</div>
                    <Textarea id={`target-${segment.id}`} value={targetText} readOnly={mode === 'review'} onChange={(event) => writeDraft(segment, event.target.value)} rows={Math.max(3, Math.ceil(segment.sourceText.length / 46))} className={cn('min-h-[84px] resize-y border-slate-200 bg-slate-50/40 text-sm leading-6 focus-visible:bg-white', segment.kind === 'code' && 'markdown-code text-xs')} placeholder="在此输入译文，或保留代码块原样…" />
                    {segment.protectedTokens.length > 0 && <div className="mt-2 flex flex-wrap gap-1">{segment.protectedTokens.map((token) => <code key={token} className="rounded bg-blue-50 px-1.5 py-0.5 text-[10px] text-blue-700">{token}</code>)}</div>}
                  </div>
                </div>

                {status === 'retranslate' && review && (
                  <div className="border-t border-violet-200 bg-violet-50/70 px-3.5 py-2.5">
                    <p className="flex flex-wrap items-center gap-1.5 text-[11px] font-medium text-violet-800"><RefreshCw className="h-3.5 w-3.5" />该片段按旧版术语表 {shortVersion(review.glossaryVersion)} 做的确认已退回待重译，译文保留未动。</p>
                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                      <span className="text-[10px] text-violet-600">受影响的术语：</span>
                      {impacted.length ? impacted.map((termId) => {
                        const term = termsById.get(termId)
                        return term ? <code key={termId} className="rounded bg-violet-200/70 px-1.5 py-0.5 text-[10px] text-violet-900">{term.source} → {term.target}</code> : null
                      }) : <span className="text-[10px] text-violet-500">本片段未命中新版变更术语，但确认依据的术语表已过期</span>}
                    </div>
                  </div>
                )}

                {status === 'withdrawn' && review && (
                  <div className="border-t bg-slate-50 px-3.5 py-3">
                    <p className="mb-2 flex items-center gap-1.5 text-[11px] font-medium text-slate-700"><Undo2 className="h-3.5 w-3.5" />译者改动了已确认译文，审校确认已自动撤回（{review.reviewer} · 依据 {shortVersion(review.glossaryVersion)}）。审校留档与当前译文并排：</p>
                    <div className="compare-grid grid grid-cols-2 gap-3">
                      <div className="rounded-lg border border-slate-200 bg-white p-2.5"><span className="text-[9px] font-semibold uppercase tracking-wider text-emerald-600">审校确认时译文</span><p className={cn('document-prose mt-1 text-xs leading-5 text-slate-600', segment.kind === 'code' && 'markdown-code bg-slate-950 p-2 text-slate-100')}>{review.snapshotText}</p></div>
                      <div className={cn('rounded-lg border p-2.5', diverged ? 'border-amber-300 bg-amber-50/60' : 'border-slate-200 bg-white')}><span className="text-[9px] font-semibold uppercase tracking-wider text-blue-600">译者当前译文{diverged ? ' · 已偏离' : ' · 与留档一致'}</span><p className={cn('document-prose mt-1 text-xs leading-5 text-slate-700', segment.kind === 'code' && 'markdown-code bg-slate-950 p-2 text-slate-100')}>{targetText}</p></div>
                    </div>
                  </div>
                )}

                {status === 'returned' && review?.reason && (
                  <div className="border-t border-red-100 bg-red-50/60 px-3.5 py-2.5"><p className="text-[11px] text-red-700"><b>退回原因（{review.reviewer}）：</b>{review.reason}</p></div>
                )}
                {status === 'confirmed' && review && (
                  <div className="border-t border-emerald-100 bg-emerald-50/50 px-3.5 py-2"><p className="text-[10px] text-emerald-700">{review.reviewer} 已按 {shortVersion(review.glossaryVersion)} 确认，留档译文随审校端保存。</p></div>
                )}

                {!!segmentIssues.length && <div className="border-t bg-red-50/50 px-3.5 py-2.5"><div className="space-y-1.5">{segmentIssues.map((issue) => <div key={issue.id} className="flex items-start gap-2 text-[11px]"><CircleAlert className={cn('mt-0.5 h-3.5 w-3.5 shrink-0', issue.severity === 'error' ? 'text-red-600' : 'text-amber-600')} /><span className={issue.severity === 'error' ? 'text-red-700' : 'text-amber-700'}>{issue.message}</span></div>)}</div></div>}
                <footer className="flex items-center gap-2 border-t bg-white px-3 py-2 text-[10px] text-slate-400"><span>译文归译者端 · 结论归审校端</span><button className="ml-auto flex items-center gap-1 text-blue-600 hover:underline" onClick={(event) => { event.stopPropagation(); setSelectedSegmentId(segment.id); document.getElementById('discussion-tab')?.click() }}><MessageSquare className="h-3 w-3" />讨论 {discussions.filter((item) => item.segmentId === segment.id && !item.resolved).length}</button></footer>
              </article>
            )
          })}
          {!filteredSegments.length && <Card><CardContent className="grid min-h-52 place-items-center text-center"><div><Sparkles className="mx-auto h-7 w-7 text-blue-500" /><p className="mt-3 text-sm font-medium">当前筛选下没有片段</p><p className="mt-1 text-xs text-slate-500">切换筛选条件或运行检查。</p></div></CardContent></Card>}
        </section>

        <aside className="workbench-right min-w-0">
          <Card className="sticky top-[74px] max-h-[calc(100vh-96px)] overflow-hidden">
            <Tabs defaultValue="discussion" className="flex h-full flex-col">
              <TabsList className="mx-3 mt-3 grid grid-cols-4"><TabsTrigger id="discussion-tab" value="discussion" className="px-1 text-[11px]">讨论</TabsTrigger><TabsTrigger value="issues" className="px-1 text-[11px]">问题</TabsTrigger><TabsTrigger value="history" className="px-1 text-[11px]">历史</TabsTrigger><TabsTrigger value="conflicts" className="px-1 text-[11px]">冲突 {conflicts.length ? `(${conflicts.length})` : ''}</TabsTrigger></TabsList>
              <TabsContent value="discussion" className="m-0 max-h-[calc(100vh-160px)] overflow-auto p-3">
                <div className="rounded-lg border border-blue-100 bg-blue-50/60 p-2.5"><p className="text-[10px] font-semibold text-blue-800">当前片段 #{selectedSegment?.index}</p><p className="mt-1 line-clamp-3 text-xs leading-5 text-blue-700">{textOf(selectedSegment?.id ?? '') || selectedSegment?.sourceText}</p></div>
                <div className="mt-3 flex gap-2"><Textarea value={discussionDraft} onChange={(event) => setDiscussionDraft(event.target.value)} rows={2} placeholder="针对当前句子留下讨论…" className="text-xs" /><Button size="icon" className="h-auto self-stretch" onClick={addDiscussion}><Send className="h-4 w-4" /></Button></div>
                <div className="mt-4 space-y-3">{selectedDiscussions.map((discussion) => <div key={discussion.id} className="rounded-lg border p-3"><div className="flex items-center justify-between"><b className="text-xs text-slate-800">{discussion.author}</b><Badge variant={discussion.resolved ? 'success' : 'warning'}>{discussion.resolved ? '已解决' : '待回应'}</Badge></div><p className="mt-2 text-xs leading-5 text-slate-600">{discussion.body}</p><p className="mt-2 text-[10px] text-slate-400">{hydrated ? new Date(discussion.createdAt).toLocaleString('zh-CN') : null}</p></div>)}{!selectedDiscussions.length && <p className="py-8 text-center text-xs text-slate-400">当前片段还没有讨论</p>}</div>
              </TabsContent>
              <TabsContent value="issues" className="m-0 max-h-[calc(100vh-160px)] overflow-auto p-3"><div className="space-y-2">{issues.map((issue) => <button key={issue.id} onClick={() => selectAndScroll(issue.segmentId)} className="w-full rounded-lg border p-3 text-left hover:border-amber-300 hover:bg-amber-50"><div className="flex items-center justify-between"><Badge variant={issue.severity === 'error' ? 'destructive' : 'warning'}>{issueLabel[issue.type]}</Badge><span className="text-[10px] text-slate-400">#{sources.find((item) => item.id === issue.segmentId)?.index}</span></div><p className="mt-2 text-xs leading-5 text-slate-600">{issue.message}</p></button>)}{!issues.length && <p className="py-8 text-center text-xs text-emerald-600">没有待处理问题</p>}</div></TabsContent>
              <TabsContent value="history" className="m-0 max-h-[calc(100vh-160px)] overflow-auto p-3"><div className="space-y-0">{history.map((entry) => <div key={entry.id} className="relative border-l border-slate-200 pb-4 pl-4"><span className="absolute -left-1.5 top-0 h-3 w-3 rounded-full border-2 border-white bg-blue-500" /><div className="flex items-center justify-between"><b className="text-[11px] text-slate-700">{entry.author}</b><span className="text-[9px] text-slate-400">{hydrated ? new Date(entry.createdAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }) : null}</span></div><p className="mt-1 text-[10px] text-slate-500">{entry.segmentId ? `片段 #${sources.find((item) => item.id === entry.segmentId)?.index ?? '—'} · ` : ''}{actionLabel[entry.action]}</p>{entry.after && <p className="mt-1 line-clamp-2 text-[10px] leading-4 text-slate-400">{entry.after}</p>}</div>)}</div></TabsContent>
              <TabsContent value="conflicts" className="m-0 max-h-[calc(100vh-160px)] overflow-auto p-3"><div className="space-y-3">{conflicts.map((conflict) => <div key={conflict.id} className="overflow-hidden rounded-lg border border-red-200"><div className="bg-red-50 px-3 py-2"><b className="text-xs text-red-800">片段 #{sources.find((item) => item.id === conflict.segmentId)?.index} 存在并发修改</b><p className="mt-1 text-[10px] text-red-600">{conflict.remoteAuthor} 修改了同一句</p></div><div className="space-y-2 p-3"><div><span className="text-[9px] font-semibold text-slate-400">本地版本</span><p className="mt-1 text-[11px] leading-5 text-slate-600">{conflict.localText}</p></div><div><span className="text-[9px] font-semibold text-slate-400">远端版本</span><p className="mt-1 text-[11px] leading-5 text-blue-700">{conflict.remoteText}</p></div><div className="flex gap-2"><Button size="sm" variant="outline" onClick={() => resolveConflict(conflict, 'local')}>保留本地</Button><Button size="sm" onClick={() => resolveConflict(conflict, 'remote')}>采用远端</Button></div></div></div>)}{!conflicts.length && <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-center text-xs text-emerald-700"><Check className="mx-auto mb-2 h-5 w-5" />所有冲突已解决</div>}</div></TabsContent>
            </Tabs>
          </Card>
          <div className="mt-3 rounded-xl border bg-slate-950 px-3 py-3 text-[10px] text-slate-400"><p className="mb-2 font-semibold text-slate-200">键盘操作</p><div className="grid grid-cols-2 gap-2"><span><kbd>J</kbd> 下一问题</span><span><kbd>K</kbd> 上一问题</span><span><kbd>C</kbd> 确认</span><span><kbd>R</kbd> 退回</span><span><kbd>⌘ Z</kbd> 撤销</span><span><kbd>⌘ ⇧ Z</kbd> 重做</span></div></div>
        </aside>
      </main>

      {selectedForReturn.size > 0 && <div className="fixed bottom-0 left-0 right-0 z-50 border-t bg-slate-950 px-4 py-3 text-white shadow-2xl"><div className="mx-auto flex max-w-[1800px] items-center gap-3"><GitCompare className="h-4 w-4 text-amber-300" /><span className="text-xs">已选择 <b>{selectedForReturn.size}</b> 个片段</span><Input value={returnReason} onChange={(event) => setReturnReason(event.target.value)} className="ml-auto max-w-lg border-slate-700 bg-slate-900 text-white" /><Button variant="destructive" size="sm" onClick={bulkReturn}>确认批量退回</Button><Button variant="ghost" size="sm" className="text-slate-300" onClick={() => setSelectedForReturn(new Set())}>取消</Button></div></div>}
    </div>
  )
}
