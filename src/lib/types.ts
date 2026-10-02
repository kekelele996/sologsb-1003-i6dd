export type SegmentKind = 'heading' | 'paragraph' | 'code' | 'link' | 'variable'

// 片段状态即审校端结论：pending 未审 / confirmed 已确认 / returned 已退回 / needs-retranslation 待重译
export type SegmentStatus = 'pending' | 'confirmed' | 'returned' | 'needs-retranslation'

export type IssueType = 'missing-translation' | 'missing-variable' | 'link-mismatch' | 'glossary' | 'code-format'
export type IssueSeverity = 'error' | 'warning'

// 译者端：译文草稿（内容归译者持有）
export interface DraftSegment {
  id: string
  index: number
  kind: SegmentKind
  sourceText: string
  targetText: string
  protectedTokens: string[]
  note: string
  // 草稿是照哪一版术语表存的
  draftGlossaryVersion: number
}

// 审校端：确认结论（决策归审校持有），另留一份确认当时的译文快照
export interface ReviewRecord {
  segmentId: string
  status: SegmentStatus
  confirmedText?: string        // 确认当时的译文快照
  reason?: string               // 退回原因
  glossaryVersion?: number      // 结论是照哪一版术语表做的
  affectedTermIds?: string[]    // 术语表更新后受影响的术语
  updatedAt: number
}

export interface GlossaryTerm {
  id: string
  source: string
  target: string
  caseSensitive: boolean
  note: string
}

export interface GlossaryState {
  version: number
  terms: GlossaryTerm[]
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
  action: 'edit' | 'confirm' | 'return' | 'resolve-conflict' | 'import' | 'discussion' | 'glossary-update'
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

// 合并视图模型：译者草稿 + 审校结论，供渲染与检查使用
export interface Segment {
  id: string
  index: number
  kind: SegmentKind
  sourceText: string
  targetText: string
  status: SegmentStatus
  protectedTokens: string[]
  note: string
}

export interface LocalizationDocument {
  id: string
  title: string
  sourceFile: string
  sourceLanguage: string
  targetLanguage: string
  updatedAt: number
  segments: Segment[]
  glossary: GlossaryTerm[]
  discussions: Discussion[]
}
