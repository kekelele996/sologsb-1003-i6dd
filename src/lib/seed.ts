import type {
  Discussion, DraftRecord, GlossaryVersion, HistoryEntry, LocalizationDocument,
  ReviewRecord, SourceSegment, TranslationConflict,
} from './types'

/** 源片段：两端共享、只读 */
export const seedSourceSegments: SourceSegment[] = [
  { id: 'seg-01', index: 1, kind: 'heading', sourceText: '# Deployment Guide', protectedTokens: [], note: '保留 Markdown 标题层级。' },
  { id: 'seg-02', index: 2, kind: 'paragraph', sourceText: 'This guide explains how to deploy {{project_name}} version {{version}} to a Kubernetes cluster.', protectedTokens: ['{{project_name}}', '{{version}}'], note: '项目名和版本号保留占位符。' },
  { id: 'seg-03', index: 3, kind: 'heading', sourceText: '## Prerequisites', protectedTokens: [], note: '' },
  { id: 'seg-04', index: 4, kind: 'link', sourceText: 'Before you begin, review the [configuration reference](https://docs.example.com/config) and install `kubectl`.', protectedTokens: ['https://docs.example.com/config'], note: '' },
  { id: 'seg-05', index: 5, kind: 'paragraph', sourceText: 'The operator requires cluster-admin privileges during installation. Production environments should use a dedicated service account.', protectedTokens: [], note: 'operator 的术语待 unified。' },
  { id: 'seg-06', index: 6, kind: 'code', sourceText: '```bash\nhelm upgrade --install {{release_name}} oci://registry.example.com/operator --version {{version}}\n```', protectedTokens: ['{{release_name}}', '{{version}}'], note: '命令保持原样。' },
  { id: 'seg-07', index: 7, kind: 'variable', sourceText: 'Set `replicaCount` to `{replica_count}` in your values file.', protectedTokens: ['{replica_count}'], note: '' },
  { id: 'seg-08', index: 8, kind: 'paragraph', sourceText: 'If the controller cannot reach the API server, check the network policy and then restart the pod.', protectedTokens: [], note: '' },
  { id: 'seg-09', index: 9, kind: 'link', sourceText: 'See [Troubleshooting](https://docs.example.com/troubleshooting#connectivity) for detailed diagnostics.', protectedTokens: ['https://docs.example.com/troubleshooting#connectivity'], note: '锚点链接丢失，需要修复。' },
  { id: 'seg-10', index: 10, kind: 'heading', sourceText: '## Upgrade Notes', protectedTokens: [], note: '漏译示例。' },
]

const v1ReleasedAt = Date.now() - 86_400_000

export const seedGlossaryV1: GlossaryVersion = {
  version: 'glossary-v1',
  releasedAt: v1ReleasedAt,
  releaseNote: '初始术语表。',
  terms: [
    { id: 'term-01', source: 'operator', target: 'Operator', caseSensitive: false, note: 'Kubernetes 扩展概念，保留首字母大写。' },
    { id: 'term-02', source: 'service account', target: '服务账号', caseSensitive: false, note: '统一使用“服务账号”。' },
    { id: 'term-03', source: 'network policy', target: '网络策略', caseSensitive: false, note: 'Kubernetes 资源名称。' },
    { id: 'term-04', source: 'pod', target: '容器组（Pod）', caseSensitive: false, note: '资源对象名称。' },
  ],
}

/** 术语服务可放出的新版：pod 译法变更，controller 新增 */
export const seedGlossaryV2: GlossaryVersion = {
  version: 'glossary-v2',
  releasedAt: Date.now() - 3_600_000,
  releaseNote: '统一 Pod 译法并新增 controller 术语。',
  terms: [
    { id: 'term-01', source: 'operator', target: 'Operator', caseSensitive: false, note: 'Kubernetes 扩展概念，保留首字母大写。' },
    { id: 'term-02', source: 'service account', target: '服务账号', caseSensitive: false, note: '统一使用“服务账号”。' },
    { id: 'term-03', source: 'network policy', target: '网络策略', caseSensitive: false, note: 'Kubernetes 资源名称。' },
    { id: 'term-04', source: 'pod', target: 'Pod', caseSensitive: false, note: '资源对象名称统一保持 Pod，不再加中文注释。' },
    { id: 'term-05', source: 'controller', target: '控制器', caseSensitive: false, note: 'Kubernetes 控制器，统一译为“控制器”。' },
  ],
  changes: [
    { termId: 'term-04', kind: 'changed' },
    { termId: 'term-05', kind: 'added' },
  ],
}

/** 译者端持有的译文草稿（记录照哪一版术语表存的） */
export const seedDrafts: DraftRecord[] = [
  { segmentId: 'seg-01', targetText: '# 部署指南', glossaryVersion: seedGlossaryV1.version, updatedAt: Date.now() - 7_200_000 },
  { segmentId: 'seg-02', targetText: '本指南介绍如何将 {{project_name}} {{version}} 版部署到 Kubernetes 集群。', glossaryVersion: seedGlossaryV1.version, updatedAt: Date.now() - 6_000_000 },
  { segmentId: 'seg-03', targetText: '## 前置条件', glossaryVersion: seedGlossaryV1.version, updatedAt: Date.now() - 7_000_000 },
  { segmentId: 'seg-04', targetText: '开始前，请阅读 [配置参考](https://docs.example.com/config)，并安装 `kubectl`。', glossaryVersion: seedGlossaryV1.version, updatedAt: Date.now() - 5_800_000 },
  { segmentId: 'seg-05', targetText: '安装 operator 时需要集群管理员权限。生产环境建议使用专用的服务账号。', glossaryVersion: seedGlossaryV1.version, needsWork: true, updatedAt: Date.now() - 5_200_000 },
  { segmentId: 'seg-06', targetText: '```bash\nhelm upgrade --install {{release_name}} oci://registry.example.com/operator --version {{version}}\n```', glossaryVersion: seedGlossaryV1.version, updatedAt: Date.now() - 6_500_000 },
  { segmentId: 'seg-07', targetText: '在 values 文件中将 `replicaCount` 设置为 `{replica_count}`。', glossaryVersion: seedGlossaryV1.version, updatedAt: Date.now() - 4_800_000 },
  { segmentId: 'seg-08', targetText: '如果控制器无法连接 API 服务器，请检查网络策略，然后重启容器组（Pod）。', glossaryVersion: seedGlossaryV1.version, updatedAt: Date.now() - 4_200_000 },
  { segmentId: 'seg-09', targetText: '详细诊断请参阅 [故障排查](https://docs.example.com/troubleshooting)。', glossaryVersion: seedGlossaryV1.version, updatedAt: Date.now() - 4_000_000 },
  { segmentId: 'seg-10', targetText: '', glossaryVersion: seedGlossaryV1.version, updatedAt: Date.now() - 3_000_000 },
]

/** 审校端持有的逐条结论（含确认/退回当时的译文） */
export const seedReviews: ReviewRecord[] = [
  { segmentId: 'seg-01', status: 'confirmed', snapshotText: '# 部署指南', glossaryVersion: seedGlossaryV1.version, reviewer: '审校 · Maya', decidedAt: Date.now() - 3_200_000 },
  { segmentId: 'seg-03', status: 'confirmed', snapshotText: '## 前置条件', glossaryVersion: seedGlossaryV1.version, reviewer: '审校 · Maya', decidedAt: Date.now() - 3_000_000 },
  { segmentId: 'seg-06', status: 'confirmed', snapshotText: '```bash\nhelm upgrade --install {{release_name}} oci://registry.example.com/operator --version {{version}}\n```', glossaryVersion: seedGlossaryV1.version, reviewer: '审校 · Maya', decidedAt: Date.now() - 2_800_000 },
  { segmentId: 'seg-09', status: 'returned', snapshotText: '详细诊断请参阅 [故障排查](https://docs.example.com/troubleshooting)。', glossaryVersion: seedGlossaryV1.version, reason: '源链接包含 connectivity 锚点，请勿省略。', reviewer: '审校 · Maya', decidedAt: Date.now() - 2_600_000 },
]

export const seedDiscussions: Discussion[] = [
  { id: 'disc-01', segmentId: 'seg-05', author: '译者 · 李然', body: '这里的 operator 指本项目控制器还是通用 Kubernetes Operator？会影响是否保留英文。', resolved: false, createdAt: Date.now() - 4200000 },
  { id: 'disc-02', segmentId: 'seg-09', author: '审校 · Maya', body: '源链接包含 connectivity 锚点，请勿省略。', resolved: false, createdAt: Date.now() - 2600000 },
  { id: 'disc-03', segmentId: 'seg-02', author: '术语负责人 · Chen', body: '占位符里的变量名不能翻译。', resolved: true, createdAt: Date.now() - 9600000 },
]

export const seedHistory: HistoryEntry[] = [
  { id: 'h-01', segmentId: 'seg-05', author: '译者 · 李然', action: 'edit', before: '', after: '安装 operator 时需要集群管理员权限。生产环境建议使用专用的服务账号。', createdAt: Date.now() - 5200000 },
  { id: 'h-02', segmentId: 'seg-09', author: '译者 · 李然', action: 'edit', before: '', after: '详细诊断请参阅 [故障排查](https://docs.example.com/troubleshooting)。', createdAt: Date.now() - 4000000 },
  { id: 'h-03', segmentId: 'seg-01', author: '审校 · Maya', action: 'confirm', before: '# 部署指南', after: '# 部署指南', createdAt: Date.now() - 3200000 },
]

export const seedConflicts: TranslationConflict[] = [
  { id: 'cf-01', segmentId: 'seg-05', localText: '安装 operator 时需要集群管理员权限。生产环境建议使用专用的服务账号。', remoteText: '安装 Operator 时需要集群管理员权限。生产环境应使用专用服务账号。', remoteAuthor: '远端协作者 · Alex', createdAt: Date.now() - 1200000 },
  { id: 'cf-02', segmentId: 'seg-09', localText: '详细诊断请参阅 [故障排查](https://docs.example.com/troubleshooting)。', remoteText: '详细诊断请参阅 [故障排查](https://docs.example.com/troubleshooting#connectivity)。', remoteAuthor: 'MSW 模拟审校者', createdAt: Date.now() - 900000 },
]

export const seedDocument: LocalizationDocument = {
  id: 'doc-k8s-operator',
  title: 'Kubernetes Operator Developer Guide',
  sourceFile: 'docs/deployment.md',
  sourceLanguage: 'English',
  targetLanguage: '简体中文',
  updatedAt: Date.now(),
  segments: seedSourceSegments,
  glossary: seedGlossaryV1.terms,
  discussions: seedDiscussions,
}
