import { http, HttpResponse } from 'msw'
import { analyzeDocument } from '@/lib/markdown'
import {
  seedConflicts, seedDocument, seedGlossaryV1, seedGlossaryV2, seedHistory,
} from '@/lib/seed'
import type { GlossaryVersion } from '@/lib/types'

const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T

/** 术语服务的进程内状态；故障开关由页面侧写入 localStorage，只挂住本侧重试 */
const GLOSSARY_FAIL_KEY = 'sologsb-1003-glossary-service-fail'
const REVIEW_FAIL_KEY = 'sologsb-1003-review-service-fail'
const GLOSSARY_RELEASED_KEY = 'sologsb-1003-glossary-released'

const readReleased = () => {
  try { return localStorage.getItem(GLOSSARY_RELEASED_KEY) === '1' } catch { return false }
}
const glossaryState: { version: GlossaryVersion; v2Released: boolean } = {
  version: clone(readReleased() ? seedGlossaryV2 : seedGlossaryV1),
  v2Released: readReleased(),
}

const serviceFailing = (key: string) => {
  try { return localStorage.getItem(key) === '1' } catch { return false }
}

export const handlers = [
  http.get('/api/document', () => HttpResponse.json(clone(seedDocument))),
  http.get('/api/history', () => HttpResponse.json(clone(seedHistory))),
  http.get('/api/conflicts', () => HttpResponse.json(clone(seedConflicts))),

  /** 拉取术语表：故障开启时仅术语服务侧失败，另一侧照旧可读 */
  http.get('/api/glossary/current', () => {
    if (serviceFailing(GLOSSARY_FAIL_KEY)) return HttpResponse.json({ error: 'glossary service unavailable' }, { status: 503 })
    return HttpResponse.json(clone(glossaryState.version))
  }),
  /** 术语服务放出新版 */
  http.post('/api/glossary/release', async () => {
    await new Promise((resolve) => setTimeout(resolve, 300))
    if (serviceFailing(GLOSSARY_FAIL_KEY)) return HttpResponse.json({ error: 'glossary service unavailable' }, { status: 503 })
    glossaryState.v2Released = true
    glossaryState.version = clone(seedGlossaryV2)
    try { localStorage.setItem(GLOSSARY_RELEASED_KEY, '1') } catch { /* ignore */ }
    return HttpResponse.json(clone(glossaryState.version))
  }),

  http.post('/api/check', async ({ request }) => {
    const body = await request.json() as { sources: Parameters<typeof analyzeDocument>[0]; targets: Record<string, string>; glossary: GlossaryVersion['terms']; confirmedIds?: string[] }
    const draftTextOf = (id: string) => body.targets[id] ?? ''
    await new Promise((resolve) => setTimeout(resolve, 320))
    return HttpResponse.json({ checkedAt: Date.now(), issues: analyzeDocument(body.sources, draftTextOf, body.glossary, new Set(body.confirmedIds ?? [])) })
  }),
  /** 译者侧保存草稿 */
  http.post('/api/draft', async ({ request }) => {
    const body = await request.json() as { documentId: string; drafts: unknown[] }
    await new Promise((resolve) => setTimeout(resolve, 240))
    return HttpResponse.json({ saved: true, documentId: body.documentId, segmentCount: body.drafts.length, savedAt: Date.now() })
  }),
  /** 审校侧送审：故障开启时仅审校侧挂起，另一侧照旧可读 */
  http.post('/api/review', async ({ request }) => {
    const body = await request.json() as { action: string; segmentIds: string[]; reason?: string }
    await new Promise((resolve) => setTimeout(resolve, 280))
    if (serviceFailing(REVIEW_FAIL_KEY)) return HttpResponse.json({ error: 'review service unavailable' }, { status: 503 })
    return HttpResponse.json({ accepted: true, ...body, reviewedAt: Date.now() })
  }),
]
