import { http, HttpResponse } from 'msw'
import { analyzeDocument } from '@/lib/markdown'
import { glossaryV2, seedConflicts, seedDocument, seedGlossary, seedHistory } from '@/lib/seed'
import type { GlossaryTerm, Segment } from '@/lib/types'

const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T

// 术语服务版本状态：v1 为当前版，release 后放出 v2
let glossaryReleased = false
let releaseAttempts = 0
let reviewAttempts = 0

const currentGlossary = (): { version: number; terms: GlossaryTerm[] } =>
  glossaryReleased ? { version: 2, terms: clone(glossaryV2) } : { version: 1, terms: clone(seedGlossary) }

export const handlers = [
  http.get('/api/document', () => HttpResponse.json(clone(seedDocument))),
  http.get('/api/history', () => HttpResponse.json(clone(seedHistory))),
  http.get('/api/conflicts', () => HttpResponse.json(clone(seedConflicts))),

  // 术语表拉取：返回当前版本与术语
  http.get('/api/glossary', () => {
    return HttpResponse.json(currentGlossary())
  }),

  // 术语服务放出新版：首次调用模拟服务暂不可用，重试后成功并升到 v2
  http.post('/api/glossary/release', async () => {
    releaseAttempts += 1
    await new Promise((resolve) => setTimeout(resolve, 320))
    if (releaseAttempts === 1) {
      return HttpResponse.json({ error: '术语服务暂不可用，请稍后重试' }, { status: 503 })
    }
    glossaryReleased = true
    const current = currentGlossary()
    return HttpResponse.json({ ...current, releasedAt: Date.now() })
  }),

  http.post('/api/check', async ({ request }) => {
    const body = await request.json() as { segments: Segment[]; glossary: GlossaryTerm[] }
    await new Promise((resolve) => setTimeout(resolve, 320))
    return HttpResponse.json({ checkedAt: Date.now(), issues: analyzeDocument(body.segments, body.glossary) })
  }),

  http.post('/api/draft', async ({ request }) => {
    const body = await request.json() as { documentId: string; segments: Segment[]; discussions: unknown[] }
    await new Promise((resolve) => setTimeout(resolve, 240))
    return HttpResponse.json({ saved: true, documentId: body.documentId, segmentCount: body.segments.length, savedAt: Date.now() })
  }),

  // 送审：首次调用模拟服务暂不可用，重试后成功
  http.post('/api/review', async ({ request }) => {
    const body = await request.json() as { action: string; segmentIds: string[]; reason?: string }
    reviewAttempts += 1
    await new Promise((resolve) => setTimeout(resolve, 280))
    if (reviewAttempts === 1) {
      return HttpResponse.json({ error: '审校服务暂不可用，请稍后重试' }, { status: 503 })
    }
    return HttpResponse.json({ accepted: true, ...body, reviewedAt: Date.now() })
  }),
]
