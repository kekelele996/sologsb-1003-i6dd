import type { DraftRecord, EffectiveStatus, ReviewRecord, SourceSegment } from './types'

/** 两端各自的持久化键，互不覆盖 */
export const STORAGE_KEYS = {
  schema: 'sologsb-1003-schema-v2',
  translator: 'sologsb-1003-translator-drafts-v2',
  reviewer: 'sologsb-1003-reviewer-records-v2',
  workspace: 'sologsb-1003-workspace-v2',
  glossary: 'sologsb-1003-glossary-cache-v2',
} as const

/** 旧版把译文、术语表、审校结论堆在一处的键，首次打开时迁移 */
export const LEGACY_DRAFT_KEY = 'sologsb-1003-localization-draft-v1'

export interface TranslatorStore {
  drafts: DraftRecord[]
}

export interface ReviewerStore {
  records: ReviewRecord[]
}

export interface WorkspaceStore {
  discussions: import('./types').Discussion[]
  history: import('./types').HistoryEntry[]
  conflicts: import('./types').TranslationConflict[]
}

export interface GlossaryCache {
  version: import('./types').GlossaryVersion
  seenAt: number
}

/** 片段归属迁移结果：译文归译者端、确认结论归审校端 */
export interface MigrationResult {
  translator: TranslatorStore
  reviewer: ReviewerStore
  workspace: WorkspaceStore
  glossary: GlossaryCache | null
  migratedSegmentCount: number
}

interface LegacySegment {
  id: string
  targetText?: string
  status?: string
  note?: string
}

const safeParse = <T,>(raw: string): T | null => {
  try { return JSON.parse(raw) as T } catch { return null }
}

const now = () => Date.now()

/**
 * 旧数据第一次打开：按片段归属把译文拆到译者端、把确认/退回结论拆到审校端。
 * 审校端记录同时留存当时的译文快照与术语表版本。
 */
export function migrateLegacy(
  legacy: {
    segments?: LegacySegment[]
    discussions?: import('./types').Discussion[]
    history?: import('./types').HistoryEntry[]
    glossary?: import('./types').GlossaryTerm[]
  },
  fallbackGlossaryVersion: import('./types').GlossaryVersion,
): MigrationResult {
  const timestamp = now()
  const glossaryVersion = fallbackGlossaryVersion.version
  const drafts: DraftRecord[] = []
  const records: ReviewRecord[] = []

  for (const segment of legacy.segments ?? []) {
    const targetText = segment.targetText ?? ''
    drafts.push({ segmentId: segment.id, targetText, glossaryVersion, needsWork: segment.status === 'needs-work', updatedAt: timestamp })
    if (segment.status === 'confirmed' || segment.status === 'returned') {
      records.push({
        segmentId: segment.id,
        status: segment.status,
        snapshotText: targetText,
        glossaryVersion,
        reviewer: '审校 · 迁移自旧数据',
        decidedAt: timestamp,
      })
    }
  }

  return {
    translator: { drafts },
    reviewer: { records },
    workspace: {
      discussions: legacy.discussions ?? [],
      history: legacy.history ?? [],
      conflicts: [],
    },
    glossary: legacy.glossary ? { version: { ...fallbackGlossaryVersion, terms: legacy.glossary }, seenAt: timestamp } : null,
    migratedSegmentCount: drafts.length,
  }
}

export const draftMapOf = (drafts: DraftRecord[]) => new Map(drafts.map((draft) => [draft.segmentId, draft]))
export const reviewMapOf = (records: ReviewRecord[]) => new Map(records.map((record) => [record.segmentId, record]))

/**
 * 片段当前归属状态：
 * - retranslate：按旧版术语表确认过的片段，新版发布后退回待重译（已退回记录保持退回）
 * - withdrawn：确认后译者又改了译文，确认自动撤回
 * - confirmed / returned：审校端现行结论
 * - needs-work / draft：无审校端现行结论时看译者端
 */
export function effectiveStatus(
  review: ReviewRecord | undefined,
  draft: DraftRecord | undefined,
  currentGlossaryVersion: string,
): EffectiveStatus {
  if (review) {
    if (review.withdrawn) return 'withdrawn'
    if (review.status === 'confirmed' && review.glossaryVersion !== currentGlossaryVersion) return 'retranslate'
    return review.status
  }
  return draft?.needsWork ? 'needs-work' : 'draft'
}

/** 译文是否与审校留档的快照不一致（撤回并排对比的依据） */
export function snapshotDiverged(review: ReviewRecord | undefined, draft: DraftRecord | undefined): boolean {
  return !!review && !!draft && review.snapshotText !== draft.targetText
}

/** 受当前术语表升级影响的片段：依据旧版做过审校结论、且新版变更术语命中源文或译文 */
export function affectedTermIds(
  source: SourceSegment,
  review: ReviewRecord | undefined,
  draft: DraftRecord | undefined,
  current: import('./types').GlossaryVersion,
  termsById: Map<string, import('./types').GlossaryTerm>,
): string[] {
  if (!review || review.glossaryVersion === current.version) return []
  const haystack = `${source.sourceText}\n${draft?.targetText ?? ''}`
  return (current.changes ?? [])
    .map((change) => change.termId)
    .filter((termId) => {
      const term = termsById.get(termId)
      if (!term) return false
      const needle = term.source
      return term.caseSensitive ? haystack.includes(needle) : haystack.toLowerCase().includes(needle.toLowerCase())
    })
}

export function loadJSON<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key)
    return raw ? safeParse<T>(raw) : null
  } catch { return null }
}

export function saveJSON(key: string, value: unknown): void {
  try { localStorage.setItem(key, JSON.stringify(value)) } catch { /* storage may be unavailable */ }
}

export function removeKey(key: string): void {
  try { localStorage.removeItem(key) } catch { /* storage may be unavailable */ }
}

export const newId = (prefix: string) => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
