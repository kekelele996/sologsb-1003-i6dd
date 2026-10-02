import type { GlossaryTerm, SegmentKind, SourceSegment, TranslationIssue } from './types'

const variablePattern = /\{\{[^{}]+\}\}|\{[A-Za-z_][\w.-]*\}|%\([^)]+\)[sd]|%[sd]/g
const linkPattern = /\[[^\]]+\]\(([^)]+)\)/g

export const unique = <T,>(items: T[]) => Array.from(new Set(items))
export const extractVariables = (text: string) => unique(text.match(variablePattern) ?? [])
export const extractLinks = (text: string) => unique(Array.from(text.matchAll(linkPattern), (match) => match[1]))
export const extractProtected = (text: string) => unique([...extractVariables(text), ...extractLinks(text)])

export const segmentKind = (text: string, fencedCode: boolean): SegmentKind => {
  if (fencedCode || /^ {4}\S/m.test(text)) return 'code'
  if (/^#{1,6}\s+/.test(text)) return 'heading'
  if (extractLinks(text).length) return 'link'
  if (extractVariables(text).length) return 'variable'
  return 'paragraph'
}

export const parseMarkdown = (markdown: string): SourceSegment[] => {
  const normalized = markdown.replace(/\r/g, '')
  const blocks: { text: string; code: boolean }[] = []
  const codeFence = /```[\s\S]*?```/g
  let cursor = 0
  for (const match of normalized.matchAll(codeFence)) {
    const before = normalized.slice(cursor, match.index).split(/\n{2,}/).filter((part) => part.trim())
    blocks.push(...before.map((text) => ({ text: text.trim(), code: false })))
    blocks.push({ text: match[0].trim(), code: true })
    cursor = (match.index ?? 0) + match[0].length
  }
  blocks.push(...normalized.slice(cursor).split(/\n{2,}/).filter((part) => part.trim()).map((text) => ({ text: text.trim(), code: false })))
  return blocks.map((block, index) => ({
    id: `segment-import-${index + 1}`,
    index: index + 1,
    kind: segmentKind(block.text, block.code),
    sourceText: block.text,
    protectedTokens: extractProtected(block.text),
    note: '',
  }))
}

const meaningful = (text: string) => text.replace(/[#*_`>\s]/g, '').length > 1

export const analyzeSegment = (source: SourceSegment, targetText: string, glossary: GlossaryTerm[]): TranslationIssue[] => {
  const issues: TranslationIssue[] = []
  const sourceVariables = extractVariables(source.sourceText)
  const targetVariables = extractVariables(targetText)
  const sourceLinks = extractLinks(source.sourceText)
  const targetLinks = extractLinks(targetText)
  if (meaningful(source.sourceText) && !targetText.trim()) {
    issues.push({ id: `${source.id}-missing`, segmentId: source.id, type: 'missing-translation', severity: 'error', message: '译文为空，存在漏译。' })
  }
  const missingVariables = sourceVariables.filter((token) => !targetVariables.includes(token))
  if (missingVariables.length) {
    issues.push({ id: `${source.id}-variable`, segmentId: source.id, type: 'missing-variable', severity: 'error', message: `缺少变量占位符：${missingVariables.join('、')}`, expected: missingVariables.join(' ') })
  }
  const missingLinks = sourceLinks.filter((url) => !targetLinks.includes(url))
  if (missingLinks.length) {
    issues.push({ id: `${source.id}-link`, segmentId: source.id, type: 'link-mismatch', severity: 'warning', message: `链接目标不一致或缺失：${missingLinks.join('、')}`, expected: missingLinks.join(' ') })
  }
  for (const term of glossary) {
    const sourceHit = term.caseSensitive ? source.sourceText.includes(term.source) : source.sourceText.toLowerCase().includes(term.source.toLowerCase())
    if (sourceHit && targetText && !targetText.includes(term.target)) {
      issues.push({ id: `${source.id}-term-${term.id}`, segmentId: source.id, type: 'glossary', severity: 'warning', message: `术语“${term.source}”应译为“${term.target}”。`, expected: term.target })
    }
  }
  if (source.kind === 'code' && targetText && source.sourceText !== targetText) {
    issues.push({ id: `${source.id}-code`, segmentId: source.id, type: 'code-format', severity: 'error', message: '代码块应保持原样，不能翻译或改动格式。' })
  }
  return issues
}

/**
 * 检查译者端草稿；已按当前术语表确认的片段归审校端所有，不再重复检查。
 * confirmedIds 为按当前术语表版本仍然有效的确认片段。
 */
export const analyzeDocument = (
  sources: SourceSegment[],
  draftTextOf: (segmentId: string) => string,
  glossary: GlossaryTerm[],
  confirmedIds: ReadonlySet<string> = new Set(),
) =>
  sources.flatMap((source) => confirmedIds.has(source.id) ? [] : analyzeSegment(source, draftTextOf(source.id), glossary))

export const renderTargetMarkdown = (sources: SourceSegment[], draftTextOf: (segmentId: string) => string) =>
  sources.map((source) => draftTextOf(source.id) || source.sourceText).join('\n\n')
