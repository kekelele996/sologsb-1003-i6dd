export type SegmentKind = 'heading' | 'paragraph' | 'code' | 'link' | 'variable'
export type SegmentStatus = 'draft' | 'needs-work' | 'confirmed' | 'returned'
/** 撤回 / 术语表升级后派生出的展示状态，归属仍在审校端记录中 */
export type EffectiveStatus = SegmentStatus | 'retranslate' | 'withdrawn'
export type IssueType = 'missing-translation' | 'missing-variable' | 'link-mismatch' | 'glossary' | 'code-format'
export type IssueSeverity = 'error' | 'warning'

/** 源片段：两端共享的只读结构，不再携带译文与审校结论 */
export interface SourceSegment {
  id: string
  index: number
  kind: SegmentKind
  sourceText: string
  protectedTokens: string[]
  note: string
}

/** 译者端持有：译文草稿，以及草稿照哪一版术语表存的 */
export interface DraftRecord {
  segmentId: string
  targetText: string
  glossaryVersion: string
  needsWork?: boolean
  updatedAt: number
}

/** 审校端持有：逐条片段的结论，并留存确认/退回当时的译文 */
export interface ReviewRecord {
  segmentId: string
  status: 'confirmed' | 'returned'
  snapshotText: string
  glossaryVersion: string
  reason?: string
  reviewer: string
  decidedAt: number
  /** 译者在确认后又改动译文时自动撤回，记录保留用于并排对比 */
  withdrawn?: boolean
}

export interface GlossaryTerm {
  id: string
  source: string
  target: string
  caseSensitive: boolean
  note: string
}

export interface GlossaryChange {
  termId: string
  kind: 'added' | 'changed'
}

/** 术语服务放出的版本化术语表 */
export interface GlossaryVersion {
  version: string
  releasedAt: number
  releaseNote: string
  terms: GlossaryTerm[]
  /** 相对上一版的新增/变更术语，用于页面上标出受影响的术语 */
  changes?: GlossaryChange[]
}

export interface Discussion {
  id: string
  segmentId: string
  author: string
  body: string
  resolved: boolean
  createdAt: number
}

export interface TranslationIssue {
  id: string
  segmentId: string
  type: IssueType
  severity: IssueSeverity
  message: string
  expected?: string
}

export interface HistoryEntry {
  id: string
  segmentId: string
  author: string
  action: 'edit' | 'confirm' | 'return' | 'resolve-conflict' | 'import' | 'discussion' | 'withdraw' | 'release' | 'migrate'
  before: string
  after: string
  createdAt: number
}

export interface TranslationConflict {
  id: string
  segmentId: string
  localText: string
  remoteText: string
  remoteAuthor: string
  createdAt: number
}

export interface LocalizationDocument {
  id: string
  title: string
  sourceFile: string
  sourceLanguage: string
  targetLanguage: string
  updatedAt: number
  segments: SourceSegment[]
  glossary: GlossaryTerm[]
  discussions: Discussion[]
}
