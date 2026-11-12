import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import { NotesArtwork, NotesPanel } from './notes-panel'
import { PaperNotes } from './paper-notes'
import type { NoteFile, NoteListItem, NotesFace } from './types'

/** Right-sidebar tab identity. The body registers under this key. */
const TAB_ID = 'agentero-dsh-notes'

/** Page kind opened from the session guide. */
const TAB_KIND = 'agentero.notes'

const NS = 'agentero.notes'

const zh = {
  title: '笔记',
  guideDescription: '打开这个会话的笔记',
  loading: '加载中…',
  empty: '没有笔记',
  loadFailed: '无法加载笔记',
  vaultMissing: '尚未配置 Vault',
  invalid: '无法读取笔记',
  missing: '找不到笔记',
  readFailed: '无法打开笔记',
  saveFailed: '无法保存笔记',
  edit: '编辑',
  save: '保存',
  cancel: '取消',
  select: '选择一篇笔记',
  collapseList: '收起笔记列表',
  expandList: '展开笔记列表',
  paperEmpty: '这篇论文还没有笔记',
  find: '查找',
  replace: '替换',
  findNext: '下一个',
  findPrevious: '上一个',
  replaceOne: '替换',
  replaceAll: '全部替换',
  bold: '加粗',
  italic: '斜体',
  strike: '删除线',
  code: '代码',
  heading: '标题',
  bulletList: '无序列表',
  numberedList: '有序列表',
  quote: '引用',
  link: '链接',
  table: '表格',
  equation: '公式',
}

const en = {
  title: 'Notes',
  guideDescription: 'Open notes for this session',
  loading: 'Loading…',
  empty: 'No notes',
  loadFailed: 'Could not load notes',
  vaultMissing: 'Vault is not configured',
  invalid: 'Could not read notes',
  missing: 'Note not found',
  readFailed: 'Could not open the note',
  saveFailed: 'Could not save the note',
  edit: 'Edit',
  save: 'Save',
  cancel: 'Cancel',
  select: 'Select a note',
  collapseList: 'Hide notes',
  expandList: 'Show notes',
  paperEmpty: 'This paper has no notes yet',
  find: 'Find',
  replace: 'Replace',
  findNext: 'Next',
  findPrevious: 'Previous',
  replaceOne: 'Replace',
  replaceAll: 'Replace all',
  bold: 'Bold',
  italic: 'Italic',
  strike: 'Strikethrough',
  code: 'Code',
  heading: 'Heading',
  bulletList: 'Bulleted list',
  numberedList: 'Numbered list',
  quote: 'Quote',
  link: 'Link',
  table: 'Table',
  equation: 'Equation',
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Notes panel copy. */
    'agentero.notes': keyof typeof zh
  }

  interface SlotMap {
    /** Notes column beside an open PDF. Declared by the PDF panel. */
    'agentero.pdf.notes': {
      kind: 'single'
      scope: 'session'
      owner: { paperPath: string }
    }
  }
}

function errorText(body: unknown): string | undefined {
  if (body === null || typeof body !== 'object' || !('error' in body)) return undefined
  const error = body.error
  if (typeof error === 'string' && error.trim() !== '') return error
  if (error !== null && typeof error === 'object' && 'message' in error && typeof error.message === 'string') {
    return error.message
  }
  return undefined
}

function notesFrom(body: unknown): NoteListItem[] {
  if (body === null || typeof body !== 'object' || !('notes' in body) || !Array.isArray(body.notes)) {
    throw new Error('invalid notes response')
  }
  const notes: NoteListItem[] = []
  for (const item of body.notes) {
    if (item === null || typeof item !== 'object') continue
    const path = 'path' in item && typeof item.path === 'string' ? item.path : ''
    const title = 'title' in item && typeof item.title === 'string' ? item.title : ''
    if (path === '') continue
    notes.push({ path, title })
  }
  return notes
}

function noteFileFrom(body: unknown): NoteFile {
  if (body === null || typeof body !== 'object') throw new Error('invalid notes response')
  const path = 'path' in body && typeof body.path === 'string' ? body.path : ''
  const text = 'text' in body && typeof body.text === 'string' ? body.text : undefined
  if (path === '' || text === undefined) throw new Error('invalid notes response')
  return { path, text }
}

function savedPathFrom(body: unknown): { path: string } {
  if (body === null || typeof body !== 'object' || !('path' in body) || typeof body.path !== 'string' || body.path === '') {
    throw new Error('invalid notes response')
  }
  return { path: body.path }
}

async function parseBody(response: Response): Promise<unknown> {
  try {
    return await response.json()
  } catch {
    throw new Error(response.ok ? 'invalid notes response' : '')
  }
}

function fileUrl(notePath: string): string {
  const query = new URLSearchParams({ path: notePath })
  return `/agentero/api/notes/file?${query.toString()}`
}

/** Browser plugin name. */
export const name = 'agentero-notes'

/**
 * Slot and locale services. The panel receives note IO through its
 * inject face and does not take the plugin context.
 */
export const inject = ['slots', 'locale', 'sidebarRightTabs']

/**
 * Register the notes library as one page in the session's right sidebar.
 * Paper NOTES.md stays in the PDF page's notes slot.
 * @param ctx - Browser plugin context.
 */
export function apply(ctx: Context): void {
  let source: { request(url: string, init?: RequestInit): Promise<Response> } | undefined
  const request = (url: string, init?: RequestInit): Promise<Response> => {
    const agentero = source ??= ctx.get('agentero') as typeof source
    if (agentero === undefined) return Promise.reject(new Error('vault is not configured'))
    return agentero.request(url, init)
  }
  ctx.effect(() => ctx.locale.register(NS, { zh, en }))
  const t = ctx.locale.bind(NS)
  const face: NotesFace = {
    async loadNotes() {
      const response = await request('/agentero/api/notes', { cache: 'no-store' })
      const body = await parseBody(response)
      if (!response.ok) throw new Error(errorText(body) ?? '')
      return notesFrom(body)
    },
    async readNote(notePath) {
      const response = await request(fileUrl(notePath), { cache: 'no-store' })
      const body = await parseBody(response)
      if (!response.ok) throw new Error(errorText(body) ?? '')
      return noteFileFrom(body)
    },
    async writeNote(notePath, text) {
      const response = await request(fileUrl(notePath), {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text }),
        cache: 'no-store',
      })
      const parsed = await parseBody(response)
      if (!response.ok) throw new Error(errorText(parsed) ?? '')
      return savedPathFrom(parsed)
    },
  }
  ctx.effect(() => ctx.sidebarRightTabs.register({
    id: TAB_ID,
    kind: TAB_KIND,
    title: () => t('title'),
    guide: [{
      id: 'notes',
      order: 50,
      title: () => t('title'),
      description: () => t('guideDescription'),
      icon: NotesArtwork,
    }],
  }))
  ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({
    name: 'sidebar.right.pane.tab',
    key: TAB_ID,
    locale: NS,
    inject: () => face,
  }, NotesPanel)))
  ctx.effect(() => ctx.slots.inject('agentero.pdf.notes', () => ctx.slots.register({
    name: 'agentero.pdf.notes',
    locale: NS,
    inject: () => ({ readNote: face.readNote, writeNote: face.writeNote }),
  }, PaperNotes)))
}
