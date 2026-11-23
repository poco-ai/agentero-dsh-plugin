import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { createElement, type ReactNode } from 'react'
import { LibraryPanel } from './papers-library'
import { LibraryFeedback, type LibraryNotice } from './library-feedback'
import {
  bibText,
  discoverItems,
  errorText,
  postJson,
  readJson,
  setPaperRead,
  type LibraryFace,
  type VaultInfo,
} from './papers'

/** Right-sidebar tab identity. The body registers under this key. */
const TAB_ID = 'agentero-dsh-library'

/** Page kind opened from the session guide. */
const TAB_KIND = 'agentero.library'

const NS = 'agentero.library'

const zh = {
  title: '文献',
  guideDescription: '打开这个会话的文献库',
  filter: '按标题或作者筛选',
  readFilter: '阅读状态',
  allPapers: '全部',
  unreadOnly: '未读',
  read: '已读',
  unread: '未读',
  readUnknown: '阅读状态未知',
  markRead: '标记已读',
  markUnread: '标记未读',
  colTitle: '标题',
  colAuthors: '作者',
  colYear: '年份',
  colTags: '标签',
  loading: '加载中…',
  empty: '没有文献',
  noMatches: '没有匹配的文献',
  pdfDisabled: 'PDF 插件未启用',
  vaultMissing: '尚未配置 Vault',
  invalid: '无法读取文献列表',
  loadFailed: '无法加载文献',
  importPlaceholder: 'arXiv / DOI / URL',
  importAction: '导入',
  discoverPlaceholder: '关键词',
  discoverAction: '发现',
  exportBib: '导出 BibTeX',
  importBib: '导入 BibTeX',
  deletePaper: '删除',
  download: '下载',
  addTag: '标签',
  removeTag: '移除标签',
  confirmDelete: '移到回收站？',
  actionFailed: '操作失败',
  moreActions: '更多操作',
  refresh: '刷新',
  openPaper: '打开论文',
  editTags: '编辑标签',
  paperCount: '{count} 篇文献',
  filteredCount: '{count} / {total} 篇文献',
  clearResults: '关闭发现结果',
  invalidVault: '请选择已有的 Agentero 知识库根目录。',
  pickerUnavailable: '目录选择器不可用，请输入知识库路径。',
}

const en = {
  title: 'Library',
  guideDescription: 'Open the library for this session',
  filter: 'Filter by title or authors',
  readFilter: 'Reading status',
  allPapers: 'All',
  unreadOnly: 'Unread',
  read: 'Read',
  unread: 'Unread',
  readUnknown: 'Reading status unknown',
  markRead: 'Mark as read',
  markUnread: 'Mark as unread',
  colTitle: 'Title',
  colAuthors: 'Authors',
  colYear: 'Year',
  colTags: 'Tags',
  loading: 'Loading…',
  empty: 'No papers',
  noMatches: 'No matching papers',
  pdfDisabled: 'PDF plugin is not enabled',
  vaultMissing: 'Vault is not configured',
  invalid: 'Could not read the paper list',
  loadFailed: 'Could not load papers',
  importPlaceholder: 'arXiv / DOI / URL',
  importAction: 'Import',
  discoverPlaceholder: 'Keyword',
  discoverAction: 'Discover',
  exportBib: 'Export BibTeX',
  importBib: 'Import BibTeX',
  deletePaper: 'Delete',
  download: 'Download',
  addTag: 'Tag',
  removeTag: 'Remove tag',
  confirmDelete: 'Move to the recycle bin?',
  actionFailed: 'Action failed',
  moreActions: 'More actions',
  refresh: 'Refresh',
  openPaper: 'Open paper',
  editTags: 'Edit tags',
  paperCount: '{count} papers',
  filteredCount: '{count} of {total} papers',
  clearResults: 'Close discovery results',
  invalidVault: 'Choose the root directory of an existing Agentero knowledge base.',
  pickerUnavailable: 'The directory picker is unavailable. Enter the knowledge base path instead.',
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Library panel copy. */
    'agentero.library': keyof typeof zh
  }
}

/** Document opener the host client service provides, when that plugin is loaded. */
interface AgenteroLike {
  open(kind: 'paper' | 'note', id: string): boolean
  getVault(): Promise<VaultInfo>
  request(url: string, init?: RequestInit): Promise<Response>
}

function LibraryArtwork({ size = 36, className }: { size?: number | undefined, className?: string | undefined }): ReactNode {
  return createElement('svg', {
    width: size,
    height: size,
    className,
    viewBox: '0 0 36 36',
    fill: 'none',
    'aria-hidden': true,
  },
  createElement('rect', { x: 8, y: 7, width: 20, height: 22, rx: 2, stroke: '#8AB4F8', strokeWidth: 2 }),
  createElement('path', { d: 'M13 14h10M13 19h10M13 24h6', stroke: '#8AB4F8', strokeWidth: 2, strokeLinecap: 'round' }))
}

/** Browser plugin name. */
export const name = 'agentero-library'

/**
 * Slot and locale services. `agentero` stays optional: a row asks
 * `ctx.get('agentero')` and reports a missing opener inside the panel.
 */
export const inject = ['slots', 'locale', 'sidebarRightTabs']

/**
 * Register the library as one page in the session's right sidebar.
 * The guide card opens it. The body does not replace the conversation.
 * @param ctx - Browser plugin context.
 */
export function apply(ctx: Context): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }))
  const t = ctx.locale.bind(NS)
  let source: AgenteroLike | undefined
  const agentero = (): AgenteroLike => {
    const service = source ??= ctx.get('agentero') as AgenteroLike | undefined
    if (service === undefined) throw new Error(t('vaultMissing'))
    return service
  }
  const request = (url: string, init?: RequestInit): Promise<Response> => agentero().request(url, init)
  const post = (url: string, body: unknown): Promise<unknown> => postJson(url, body, request)
  const notice = createSnapshotStore<LibraryNotice>(null)
  let sequence = 0
  ctx.effect(() => () => { notice.set(null) })
  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay', id: 'agentero-library.feedback',
    inject: () => ({ hooks: { notice }, dismiss: () => { notice.set(null) } }),
  }, LibraryFeedback))
  const face: LibraryFace = {
    notifyError(message) { notice.set({ text: message, sequence: ++sequence }) },
    loadVault() { return agentero().getVault() },
    async loadPapers() {
      const response = await request('/agentero/api/papers', { cache: 'no-store' })
      const body = await readJson(response)
      if (!response.ok) throw new Error(errorText(body) ?? '')
      if (body === undefined) throw new Error('invalid papers response')
      return body
    },
    openPaper(id) {
      const agentero = ctx.get('agentero') as AgenteroLike | undefined
      if (agentero === undefined || typeof agentero.open !== 'function') return false
      return agentero.open('paper', id)
    },
    async importId(text) {
      await post('/agentero/api/import', { text })
    },
    async importBib(text) {
      await post('/agentero/api/import/bib', { text })
    },
    async exportBib() {
      const response = await request('/agentero/api/export/bib', { cache: 'no-store' })
      const body = await readJson(response)
      if (!response.ok) throw new Error(errorText(body) ?? t('actionFailed'))
      if (body === undefined) throw new Error(t('actionFailed'))
      return bibText(body)
    },
    async discover(keyword) {
      return discoverItems(await post('/agentero/api/discover', { keyword }))
    },
    async addTag(ref, tag) {
      await post('/agentero/api/papers/tags', { ref, op: 'add', tag })
    },
    async removeTag(ref, tag) {
      await post('/agentero/api/papers/tags', { ref, op: 'rm', tag })
    },
    async deletePaper(ref) {
      await post('/agentero/api/papers/delete', { ref })
    },
    setRead(ref, read, revision) { return setPaperRead(ref, read, revision, request) },
    async download(ref) {
      await post('/agentero/api/papers/download', { ref })
    },
  }
  ctx.effect(() => ctx.sidebarRightTabs.register({
    id: TAB_ID,
    kind: TAB_KIND,
    title: () => t('title'),
    guide: [{
      id: 'library',
      order: 40,
      title: () => t('title'),
      description: () => t('guideDescription'),
      icon: LibraryArtwork,
    }],
  }))
  ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({
    name: 'sidebar.right.pane.tab',
    key: TAB_ID,
    locale: NS,
    inject: () => face,
  }, LibraryPanel)))
}
