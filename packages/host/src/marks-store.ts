/**
 * Reading marks under `<vault>/papers/<paper>/marks`, without the Agentero CLI.
 *
 * The on-disk contract is shared with the desktop reader and `agentero mark`:
 * highlights live in `annotations.json` as the EmbedPDF transfer blob, and
 * per-id marks (ask / translate / visual) live in `marks/<id>.json`. Writes
 * mirror `crates/agentero-core/src/features/pdf/locate/annotations.rs`:
 * 2-space JSON, trailing newline, dedupe by id, atomic replace.
 */

import { randomBytes, randomUUID } from 'node:crypto'
import { lstat, mkdir, readFile, readdir, realpath, rename, rm, writeFile } from 'node:fs/promises'
import * as path from 'node:path'
import { locateVaultPath, within } from './notes-files.js'

const ANNOTATIONS_FILE = 'annotations.json'
/** `PdfAnnotationSubtype.HIGHLIGHT` from `@embedpdf/models`. */
const HIGHLIGHT_SUBTYPE = 9
/** `HIGHLIGHT_OPACITY` from the desktop palette. */
const HIGHLIGHT_OPACITY = 0.4
/** Desktop highlight palette. Drifting breaks the picker round-trip. */
const PALETTE: Record<string, string> = {
  yellow: '#fcd34d',
  green: '#86efac',
  blue: '#7dd3fc',
  pink: '#f9a8d4',
  purple: '#d8b4fe',
}
/** Same alphabet as `annotations::new_mark_id`. */
const MARK_ID_ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ_abcdefghijklmnopqrstuvwxyz-'

const INVALID_PATH = 'invalid path'
const NOT_FOUND = 'not found'

/** Page rectangle. `pt` marks use page points, `norm` marks use 0–1. */
export interface MarkRect {
  x: number
  y: number
  w: number
  h: number
}

export interface MarkItem {
  id: string
  kind: string
  /** 1-based page number. */
  page: number
  space: 'pt' | 'norm'
  rects: MarkRect[]
  note: string
  /** Highlight palette key when the store has one. */
  color?: string
  /** Vault-relative PNG for visual region marks. */
  asset?: string
}

export type MarksReadResult =
  | { ok: true, paperPath: string, marks: MarkItem[] }
  | { ok: false, status: 400 | 404, error: string }

export interface MarkWrite {
  ref: string
  kind: 'highlight' | 'ask' | 'translate' | 'visual'
  quote: string
  page: number
  /** Page-point rectangles from the browser selection. */
  rects: MarkRect[]
  /** Page size at scale 1, used to normalize per-id mark anchors. */
  pageSize: { width: number, height: number }
  color?: string
  comment?: string
  question?: string
  /** Completed model translation, persisted in the desktop-compatible mark. */
  result?: string
  /** Visual region crops: bare base64 PNG, stored under marks/assets. */
  asset?: { mediaType: string, data: string }
}

export type MarksWriteResult =
  | { ok: true, ids: string[], path: string }
  | { ok: false, status: 400 | 404, error: string }

function ioCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('code' in error)) return undefined
  return typeof error.code === 'string' ? error.code : undefined
}

function recordOf(value: unknown): Record<string, unknown> | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined
  return value as Record<string, unknown>
}

function numberOr(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function textOr(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

/**
 * Both stored shapes: EmbedPDF transfer rects (`origin` / `size`, page points)
 * and per-id anchors (`x` / `y` / `w` / `h`, normalized).
 */
function rectOf(value: unknown): MarkRect | undefined {
  const record = recordOf(value)
  if (record === undefined) return undefined
  const origin = recordOf(record.origin)
  const size = recordOf(record.size)
  if (origin !== undefined && size !== undefined) {
    const x = numberOr(origin.x)
    const y = numberOr(origin.y)
    const w = numberOr(size.width)
    const h = numberOr(size.height)
    if (x === undefined || y === undefined || w === undefined || h === undefined) return undefined
    return w > 0 && h > 0 ? { x, y, w, h } : undefined
  }
  const x = numberOr(record.x)
  const y = numberOr(record.y)
  const w = numberOr(record.w)
  const h = numberOr(record.h)
  if (x === undefined || y === undefined || w === undefined || h === undefined) return undefined
  return w > 0 && h > 0 ? { x, y, w, h } : undefined
}

interface PaperDir {
  /** Vault-relative paper directory, `/` separated. */
  relative: string
  /** Resolved directory on disk. */
  real: string
}

/** Resolve the paper directory behind a `papers/...` directory or one of its PDF files. */
async function paperDir(vault: string, ref: string): Promise<
  | { ok: true, dir: PaperDir }
  | { ok: false, status: 400 | 404, error: string }
> {
  const located = await locateVaultPath(vault, ref)
  if (!located.ok) return located
  const { root, lexical } = located.location
  let real: string
  try {
    real = await realpath(lexical)
  } catch (error) {
    const code = ioCode(error)
    if (code === 'ENOENT') return { ok: false, status: 404, error: NOT_FOUND }
    if (code === 'ELOOP' || code === 'ENOTDIR') return { ok: false, status: 400, error: INVALID_PATH }
    throw error
  }
  if (!within(root, real, false)) return { ok: false, status: 400, error: INVALID_PATH }
  const stat = await lstat(real)
  // Chat links name the PDF file while the library names its directory; both
  // address the same paper.
  const directory = stat.isDirectory() ? real : stat.isFile() ? path.dirname(real) : undefined
  if (directory === undefined || !within(root, directory, false)) return { ok: false, status: 400, error: INVALID_PATH }
  const relative = path.relative(root, directory).split(path.sep).join('/')
  if (relative !== 'papers' && !relative.startsWith('papers/')) {
    return { ok: false, status: 400, error: INVALID_PATH }
  }
  return { ok: true, dir: { relative, real: directory } }
}

async function readAnnotations(dir: string): Promise<unknown[]> {
  try {
    const parsed: unknown = JSON.parse(await readFile(path.join(dir, ANNOTATIONS_FILE), 'utf8'))
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function fromAnnotation(value: unknown): MarkItem | undefined {
  const record = recordOf(value)
  if (record === undefined) return undefined
  const annotation = recordOf(record.annotation) ?? record
  const id = textOr(annotation.id)
  const pageIndex = numberOr(annotation.pageIndex)
  if (id === '' || pageIndex === undefined || pageIndex < 0) return undefined
  const rects: MarkRect[] = []
  const segments = Array.isArray(annotation.segmentRects) ? annotation.segmentRects : []
  for (const segment of segments) {
    const rect = rectOf(segment)
    if (rect !== undefined) rects.push(rect)
  }
  if (rects.length === 0) {
    const single = rectOf(annotation.rect)
    if (single === undefined) return undefined
    rects.push(single)
  }
  const custom = recordOf(annotation.custom)
  const palette = textOr(custom?.paletteKey)
  return {
    id,
    kind: 'highlight',
    page: pageIndex + 1,
    space: 'pt',
    rects,
    note: textOr(annotation.contents),
    ...(palette !== '' && palette in PALETTE ? { color: palette } : {}),
  }
}

function fromMarkFile(name: string, value: unknown): MarkItem | undefined {
  const record = recordOf(value)
  if (record === undefined) return undefined
  const anchor = recordOf(record.anchor)
  const kind = textOr(record.kind)
  if (kind === '') return undefined
  const page = numberOr(record.page) ?? numberOr(anchor?.page)
  if (page === undefined || page < 1) return undefined
  let raw: unknown[] = []
  if (Array.isArray(record.rects)) raw = record.rects
  else if (anchor !== undefined && Array.isArray(anchor.rects)) raw = anchor.rects
  const rects: MarkRect[] = []
  for (const item of raw) {
    const rect = rectOf(item)
    if (rect !== undefined) rects.push(rect)
  }
  return {
    id: textOr(record.id) || name.replace(/\.json$/, ''),
    kind,
    page,
    space: 'norm',
    rects,
    note: textOr(record.result) || textOr(record.comment),
    ...(textOr(record.asset) === '' ? {} : { asset: textOr(record.asset) }),
  }
}

/**
 * Every mark for one paper: `annotations.json` highlights first, then per-id
 * files in filename order, deduped by id (the same order the viewer used).
 */
export async function readMarks(vault: string, ref: string): Promise<MarksReadResult> {
  const paper = await paperDir(vault, ref)
  if (!paper.ok) return paper
  const dir = path.join(paper.dir.real, 'marks')
  const marks: MarkItem[] = []
  const seen = new Set<string>()
  const push = (mark: MarkItem | undefined): void => {
    if (mark === undefined || seen.has(mark.id)) return
    seen.add(mark.id)
    marks.push(mark)
  }

  for (const item of await readAnnotations(dir)) push(fromAnnotation(item))

  let names: string[] = []
  try {
    names = (await readdir(dir))
      .filter(name => name.endsWith('.json') && name !== ANNOTATIONS_FILE)
      .sort((left, right) => left.localeCompare(right))
  } catch {
    names = []
  }
  for (const name of names) {
    try {
      const mark = fromMarkFile(name, JSON.parse(await readFile(path.join(dir, name), 'utf8')))
      // The JSON stores the desktop-compatible paper-relative crop path; the
      // reader and the asset route need it vault-relative.
      if (mark?.asset !== undefined && !mark.asset.startsWith('papers/') && !mark.asset.startsWith('/')) {
        mark.asset = `${paper.dir.relative}/${mark.asset}`
      }
      push(mark)
    } catch {
      // A half-written or hand-edited mark must not hide the others.
    }
  }
  return { ok: true, paperPath: paper.dir.relative, marks }
}

function nowIso(): string {
  return new Date().toISOString()
}

function newMarkId(): string {
  let out = ''
  for (const byte of randomBytes(10)) out += MARK_ID_ALPHABET[byte % 64]
  return out
}

function unionRect(rects: readonly MarkRect[]): MarkRect {
  let left = Number.POSITIVE_INFINITY
  let top = Number.POSITIVE_INFINITY
  let right = Number.NEGATIVE_INFINITY
  let bottom = Number.NEGATIVE_INFINITY
  for (const rect of rects) {
    left = Math.min(left, rect.x)
    top = Math.min(top, rect.y)
    right = Math.max(right, rect.x + rect.w)
    bottom = Math.max(bottom, rect.y + rect.h)
  }
  return { x: left, y: top, w: right - left, h: bottom - top }
}

/** Page-point rect as the EmbedPDF transfer blob stores it. */
function pagePointRect(rect: MarkRect): { origin: { x: number, y: number }, size: { width: number, height: number } } {
  return {
    origin: { x: rect.x, y: rect.y },
    size: { width: rect.w, height: rect.h },
  }
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value))
}

/** Share of the smaller region that must intersect before two highlights are the same selection. */
const HIGHLIGHT_OVERLAP = 0.6

function rectArea(rect: MarkRect): number {
  return rect.w * rect.h
}

function intersectionArea(left: MarkRect, right: MarkRect): number {
  const width = Math.min(left.x + left.w, right.x + right.w) - Math.max(left.x, right.x)
  const height = Math.min(left.y + left.h, right.y + right.h) - Math.max(left.y, right.y)
  if (width <= 0 || height <= 0) return 0
  return width * height
}

function overlapRatio(left: readonly MarkRect[], right: readonly MarkRect[]): number {
  const leftArea = left.reduce((sum, rect) => sum + rectArea(rect), 0)
  const rightArea = right.reduce((sum, rect) => sum + rectArea(rect), 0)
  const smaller = Math.min(leftArea, rightArea)
  if (!(smaller > 0)) return 0
  let shared = 0
  for (const a of left) {
    for (const b of right) shared += intersectionArea(a, b)
  }
  return shared / smaller
}

function annotationRecord(item: unknown): Record<string, unknown> | undefined {
  const record = recordOf(item)
  if (record === undefined) return undefined
  return recordOf(record.annotation) ?? record
}

function annotationRects(annotation: Record<string, unknown>): MarkRect[] {
  const rects: MarkRect[] = []
  const segments = Array.isArray(annotation.segmentRects) ? annotation.segmentRects : []
  for (const segment of segments) {
    const rect = rectOf(segment)
    if (rect !== undefined) rects.push(rect)
  }
  if (rects.length === 0) {
    const single = rectOf(annotation.rect)
    if (single !== undefined) rects.push(single)
  }
  return rects
}

interface HighlightMatch {
  index: number
  annotation: Record<string, unknown>
}

/** The same-page highlight that already covers this selection, if one does. */
function matchingHighlight(items: readonly unknown[], page: number, rects: readonly MarkRect[]): HighlightMatch | undefined {
  let best: (HighlightMatch & { ratio: number }) | undefined
  for (let index = 0; index < items.length; index += 1) {
    const annotation = annotationRecord(items[index])
    if (annotation === undefined) continue
    const subtype = numberOr(annotation.type)
    if (subtype !== undefined && subtype !== HIGHLIGHT_SUBTYPE) continue
    const pageIndex = numberOr(annotation.pageIndex)
    if (pageIndex === undefined || pageIndex + 1 !== page) continue
    const ratio = overlapRatio(rects, annotationRects(annotation))
    if (ratio < HIGHLIGHT_OVERLAP) continue
    if (best === undefined || ratio > best.ratio) best = { index, annotation, ratio }
  }
  return best === undefined ? undefined : { index: best.index, annotation: best.annotation }
}

/** 2-space JSON with a trailing newline, replaced atomically (same as Rust). */
async function writeAnnotations(dir: string, items: unknown[]): Promise<void> {
  await mkdir(dir, { recursive: true })
  const target = path.join(dir, ANNOTATIONS_FILE)
  const tmp = `${target}.tmp`
  await writeFile(tmp, `${JSON.stringify(items, null, 2)}\n`, 'utf8')
  await rename(tmp, target)
}

/**
 * Write one browser-originated mark. Rects come from the live selection, so no
 * text re-location is needed; the stored geometry is exactly what was selected.
 */
export async function writeMark(vault: string, body: MarkWrite): Promise<MarksWriteResult> {
  const paper = await paperDir(vault, body.ref)
  if (!paper.ok) return paper
  const quote = body.quote.trim()
  if ((quote === '' && body.kind !== 'visual') || body.rects.length === 0 || body.page < 1) {
    return { ok: false, status: 400, error: 'invalid body' }
  }
  const dir = path.join(paper.dir.real, 'marks')
  const now = nowIso()

  if (body.kind === 'highlight') {
    const color = body.color !== undefined && body.color in PALETTE ? body.color : 'yellow'
    const comment = body.comment?.trim() ?? ''
    const existing = await readAnnotations(dir)
    const match = matchingHighlight(existing, body.page, body.rects)
    const storedPath = `${paper.dir.relative}/marks/${ANNOTATIONS_FILE}`
    if (match !== undefined) {
      const current = textOr(recordOf(match.annotation.custom)?.paletteKey) || 'yellow'
      const id = textOr(match.annotation.id)
      if (comment === '' && current === color) {
        existing.splice(match.index, 1)
        await writeAnnotations(dir, existing)
        return { ok: true, ids: id === '' ? [] : [id], path: storedPath }
      }
      match.annotation.strokeColor = PALETTE[color]
      match.annotation.opacity = HIGHLIGHT_OPACITY
      const custom = recordOf(match.annotation.custom) ?? { app: 'agentero', quote }
      custom.paletteKey = color
      match.annotation.custom = custom
      if (comment !== '') match.annotation.contents = comment
      await writeAnnotations(dir, existing)
      return { ok: true, ids: id === '' ? [] : [id], path: storedPath }
    }
    const id = randomUUID()
    const annotation: Record<string, unknown> = {
      type: HIGHLIGHT_SUBTYPE,
      id,
      pageIndex: body.page - 1,
      rect: pagePointRect(unionRect(body.rects)),
      segmentRects: body.rects.map(pagePointRect),
      strokeColor: PALETTE[color],
      opacity: HIGHLIGHT_OPACITY,
      created: now,
      custom: { app: 'agentero', paletteKey: color, quote },
    }
    if (comment !== '') annotation.contents = comment
    await writeAnnotations(dir, [...existing, { annotation }])
    return { ok: true, ids: [id], path: storedPath }
  }

  const width = body.pageSize.width
  const height = body.pageSize.height
  if (!(width > 0) || !(height > 0)) return { ok: false, status: 400, error: 'invalid body' }
  const geometry = body.rects.map(rect => ({
    x: clamp01(rect.x / width),
    y: clamp01(rect.y / height),
    w: clamp01(rect.w / width),
    h: clamp01(rect.h / height),
  }))

  if (body.kind === 'translate') {
    const result = body.result?.trim() ?? ''
    if (result === '') return { ok: false, status: 400, error: 'translation is empty' }
    const id = newMarkId()
    const mark = {
      version: 1,
      kind: 'translate',
      id,
      paperPath: paper.dir.relative,
      createdAt: now,
      updatedAt: now,
      page: body.page,
      rects: geometry,
      quote,
      result,
      geometry: 'resolved',
    }
    await mkdir(dir, { recursive: true })
    await writeFile(path.join(dir, `${id}.json`), `${JSON.stringify(mark, null, 2)}\n`, 'utf8')
    return { ok: true, ids: [id], path: `${paper.dir.relative}/marks/${id}.json` }
  }

  if (body.kind === 'visual') {
    const asset = body.asset
    if (asset === undefined || asset.mediaType !== 'image/png') {
      return { ok: false, status: 400, error: 'invalid body' }
    }
    const encoded = asset.data.replace(/\s+/g, '')
    if (encoded === '' || encoded.length > 6_000_000) {
      return { ok: false, status: 400, error: 'invalid body' }
    }
    const png = Buffer.from(encoded, 'base64')
    if (png.length === 0 || png.length > 4_500_000) {
      return { ok: false, status: 400, error: 'invalid body' }
    }
    const id = newMarkId()
    const assetDir = path.join(dir, 'assets')
    const relative = `marks/assets/${id}.png`
    const comment = body.comment?.trim() ?? ''
    const mark = {
      version: 2,
      kind: 'visual',
      id,
      paperPath: paper.dir.relative,
      createdAt: now,
      updatedAt: now,
      status: 'open',
      geometry: 'resolved',
      asset: relative,
      ...(comment === '' ? {} : { comment }),
      anchor: {
        page: body.page,
        rects: geometry,
        quote: comment,
        trigger: 'region',
      },
    }
    await mkdir(assetDir, { recursive: true })
    await writeFile(path.join(assetDir, `${id}.png`), png)
    await writeFile(path.join(dir, `${id}.json`), `${JSON.stringify(mark, null, 2)}\n`, 'utf8')
    return { ok: true, ids: [id], path: `${paper.dir.relative}/marks/${id}.json` }
  }

  const id = newMarkId()
  const question = (body.question ?? body.comment ?? '').trim()
  const mark = {
    version: 1,
    kind: 'ask',
    id,
    paperPath: paper.dir.relative,
    createdAt: now,
    updatedAt: now,
    status: 'open',
    geometry: 'resolved',
    anchor: {
      page: body.page,
      rects: geometry,
      quote,
      trigger: 'selection',
    },
    messages: question === ''
      ? []
      : [{ id: `${id}-q`, role: 'user', content: question, createdAt: now }],
  }
  await mkdir(dir, { recursive: true })
  await writeFile(path.join(dir, `${id}.json`), `${JSON.stringify(mark, null, 2)}\n`, 'utf8')
  return { ok: true, ids: [id], path: `${paper.dir.relative}/marks/${id}.json` }
}

const MARK_ID = /^[A-Za-z0-9_-]{1,80}$/

/** Remove one highlight from `annotations.json`, or one per-id mark file. */
export async function deleteMark(vault: string, ref: string, id: string): Promise<MarksWriteResult> {
  if (!MARK_ID.test(id)) return { ok: false, status: 400, error: 'invalid body' }
  const paper = await paperDir(vault, ref)
  if (!paper.ok) return paper
  const dir = path.join(paper.dir.real, 'marks')
  const existing = await readAnnotations(dir)
  const next = existing.filter(item => textOr(annotationRecord(item)?.id) !== id)
  let removed = next.length !== existing.length
  if (removed) await writeAnnotations(dir, next)
  try {
    await rm(path.join(dir, `${id}.json`))
    removed = true
  } catch (error) {
    const code = ioCode(error)
    if (code !== 'ENOENT') throw error
  }
  if (!removed) return { ok: false, status: 404, error: 'not found' }
  return { ok: true, ids: [id], path: `${paper.dir.relative}/marks/${ANNOTATIONS_FILE}` }
}
