/** Axis-aligned boxes in one coordinate space. */
export interface Box {
  x: number
  y: number
  w: number
  h: number
}

/** Share of the smaller region that must intersect before two highlights are the same selection. */
const HIGHLIGHT_OVERLAP = 0.6

function area(rect: Box): number {
  return rect.w * rect.h
}

function intersectionArea(left: Box, right: Box): number {
  const width = Math.min(left.x + left.w, right.x + right.w) - Math.max(left.x, right.x)
  const height = Math.min(left.y + left.h, right.y + right.h) - Math.max(left.y, right.y)
  if (width <= 0 || height <= 0) return 0
  return width * height
}

function overlapRatio(left: readonly Box[], right: readonly Box[]): number {
  const leftArea = left.reduce((sum, rect) => sum + area(rect), 0)
  const rightArea = right.reduce((sum, rect) => sum + area(rect), 0)
  const smaller = Math.min(leftArea, rightArea)
  if (!(smaller > 0)) return 0
  let shared = 0
  for (const a of left) {
    for (const b of right) shared += intersectionArea(a, b)
  }
  return shared / smaller
}

export interface OverlapMark {
  id: string
  kind: string
  page: number
  space: string
  rects: readonly Box[]
}

/** Highlight on this page that already covers the selection, if one does. */
export function overlappingHighlightId(marks: readonly OverlapMark[], page: number, rects: readonly Box[]): string | undefined {
  let best: { id: string, ratio: number } | undefined
  for (const mark of marks) {
    if (mark.kind !== 'highlight' || mark.page !== page || mark.space !== 'pt' || mark.rects.length === 0) continue
    const ratio = overlapRatio(rects, mark.rects)
    if (ratio < HIGHLIGHT_OVERLAP) continue
    if (best === undefined || ratio > best.ratio) best = { id: mark.id, ratio }
  }
  return best?.id
}
