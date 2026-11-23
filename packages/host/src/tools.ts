import type { ChildProcess } from 'node:child_process'
import type { Context } from '@deepseek-ai/cordis'
import { discoverArxiv, importId, type CatalogSettings } from './catalog.js'
import { listVaultNotes, readVaultFile } from './notes-files.js'
import { listPapers } from './paper-list.js'

/** How many catalog rows a tool result may carry. */
const PAPER_CAP = 40

/** How many note files a search may open. */
const SEARCH_CAP = 40

/** How many search hits to return. */
const HIT_CAP = 20

/** Note text returned to the model, in characters. */
const TEXT_CAP = 12_000

interface ToolRegistry {
  register(definition: {
    name: string
    description: string
    parameters: Record<string, unknown>
    output: {
      schema: Record<string, unknown>
      render: (args: unknown, value: unknown) => { type: 'text', text: string }[]
    }
    execute: (args: unknown) => Promise<unknown>
  }): () => void
}

const objectSchema = {
  type: 'object',
  additionalProperties: true,
} as const

/**
 * Render a tool result. The tools API calls `render(arguments, value)`, so the
 * value to serialize is the second parameter — declaring only one would
 * stringify the arguments and hand the model an echo of its own call.
 */
function textResult(_arguments: unknown, value: unknown): { type: 'text', text: string }[] {
  return [{ type: 'text', text: JSON.stringify(value) }]
}

function record(value: unknown): Record<string, unknown> | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined
  return value as Record<string, unknown>
}

function stringArg(args: unknown, key: string): string {
  const row = record(args)
  const value = row?.[key]
  return typeof value === 'string' ? value.trim() : ''
}

/**
 * Register model tools that read and import the same vault as the panels.
 * @returns Disposer that unregisters every tool.
 */
export function registerTools(
  ctx: Context,
  settings: CatalogSettings,
  children: Set<ChildProcess>,
): () => void {
  const tools = (ctx as Context & { tools: ToolRegistry }).tools
  const dispose: (() => void)[] = []
  dispose.push(tools.register({
    name: 'agentero_list_papers',
    description: 'List papers already in the Agentero vault, newest first and at most 40 rows. Each row has id, a vault-relative path such as papers/<id>, title, authors, year, tags, state (read or unread), and a revision. Pass a query to filter; do not invent a second catalog.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        query: { type: 'string', description: 'Optional substring matched by the Agentero CLI against title, authors, id, path, and tags.' },
      },
    },
    output: { schema: { ...objectSchema }, render: textResult },
    async execute(args) {
      if (settings.vault === '') throw new Error('vault is not configured')
      const listed = await listPapers(settings, children, { query: stringArg(args, 'query'), limit: PAPER_CAP })
      if (!listed.ok) throw new Error(listed.failure.message)
      return { papers: listed.rows, truncated: listed.truncated }
    },
  }))
  dispose.push(tools.register({
    name: 'agentero_import_paper',
    description: 'Import one paper into the Agentero vault by arXiv id, DOI, or URL. Dedupes against papers already in the vault.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['text'],
      properties: {
        text: { type: 'string', description: 'arXiv id, DOI, or paper URL.' },
      },
    },
    output: { schema: { ...objectSchema }, render: textResult },
    async execute(args) {
      if (settings.vault === '') throw new Error('vault is not configured')
      const text = stringArg(args, 'text')
      if (text === '') throw new Error('text is required')
      const result = await importId(settings, text, children)
      if (result.status !== 200) throw new Error(result.error)
      return JSON.parse(result.raw) as unknown
    },
  }))
  dispose.push(tools.register({
    name: 'agentero_read_note',
    description: 'Read one Markdown file inside the vault. Use notes/<file>.md for the notes library, or papers/<id>/NOTES.md for the note beside a paper. Paths are vault-relative. This does not return PDF page text.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['path'],
      properties: {
        path: { type: 'string', description: 'Vault-relative path using / separators.' },
      },
    },
    output: { schema: { ...objectSchema }, render: textResult },
    async execute(args) {
      if (settings.vault === '') throw new Error('vault is not configured')
      const path = stringArg(args, 'path')
      if (path === '') throw new Error('path is required')
      const file = await readVaultFile(settings.vault, path)
      if (file.status !== 200) throw new Error(file.error)
      const truncated = file.text.length > TEXT_CAP
      return {
        path: file.path,
        text: truncated ? file.text.slice(0, TEXT_CAP) : file.text,
        truncated,
      }
    },
  }))
  dispose.push(tools.register({
    name: 'agentero_search_notes',
    description: 'Search Markdown files under the vault notes/ directory by title or body. Does not list per-paper NOTES.md files.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['query'],
      properties: {
        query: { type: 'string', description: 'Substring matched against the note title, path, and body.' },
      },
    },
    output: { schema: { ...objectSchema }, render: textResult },
    async execute(args) {
      if (settings.vault === '') throw new Error('vault is not configured')
      const query = stringArg(args, 'query').toLowerCase()
      if (query === '') throw new Error('query is required')
      const notes = await listVaultNotes(settings.vault)
      const hits: { path: string, title: string, excerpt: string }[] = []
      let scanned = 0
      for (const note of notes) {
        if (hits.length >= HIT_CAP || scanned >= SEARCH_CAP) break
        const titleHit = note.title.toLowerCase().includes(query) || note.path.toLowerCase().includes(query)
        scanned += 1
        const file = await readVaultFile(settings.vault, note.path)
        if (file.status !== 200) continue
        const body = file.text
        const at = body.toLowerCase().indexOf(query)
        if (!titleHit && at < 0) continue
        const start = at < 0 ? 0 : Math.max(0, at - 80)
        hits.push({
          path: note.path,
          title: note.title,
          excerpt: body.slice(start, start + 240),
        })
      }
      return { notes: hits }
    },
  }))
  dispose.push(tools.register({
    name: 'agentero_discover_arxiv',
    description: 'Rank a short arXiv list for one keyword. Papers already in the vault are omitted. Each item has an identifier, title, authors, and score; import a chosen identifier with agentero_import_paper.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['keyword'],
      properties: {
        keyword: { type: 'string', description: 'Topic term or phrase.' },
      },
    },
    output: { schema: { ...objectSchema }, render: textResult },
    async execute(args) {
      if (settings.vault === '') throw new Error('vault is not configured')
      const keyword = stringArg(args, 'keyword')
      if (keyword === '') throw new Error('keyword is required')
      const result = await discoverArxiv(settings, keyword, children)
      if (result.status !== 200) throw new Error(result.error)
      return JSON.parse(result.raw) as unknown
    },
  }))
  return () => {
    for (const remove of dispose) remove()
  }
}
