import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { deleteMark, readMarks, writeMark } from '../lib/marks-store.js'

const pageSize = { width: 600, height: 800 }
const rects = [{ x: 72, y: 140, w: 180, h: 14 }]

async function withPaper(run) {
  const vault = await mkdtemp(path.join(tmpdir(), 'agentero-marks-'))
  const paper = path.join(vault, 'papers', 'group', 'paper')
  await mkdir(paper, { recursive: true })
  try {
    await run(vault, 'papers/group/paper')
  } finally {
    await rm(vault, { recursive: true, force: true })
  }
}

test('a repeated highlight replaces the previous one instead of stacking', async () => {
  await withPaper(async (vault, ref) => {
    const first = await writeMark(vault, { ref, kind: 'highlight', quote: 'attention', page: 1, rects, pageSize, color: 'yellow' })
    assert.equal(first.ok, true)
    const second = await writeMark(vault, { ref, kind: 'highlight', quote: 'attention', page: 1, rects, pageSize, color: 'yellow' })
    assert.equal(second.ok, true)
    const cleared = await readMarks(vault, ref)
    assert.equal(cleared.ok, true)
    if (cleared.ok) assert.equal(cleared.marks.length, 0)

    await writeMark(vault, { ref, kind: 'highlight', quote: 'attention', page: 1, rects, pageSize, color: 'yellow' })
    const recolored = await writeMark(vault, { ref, kind: 'highlight', quote: 'attention', page: 1, rects, pageSize, color: 'green' })
    assert.equal(recolored.ok, true)
    const painted = await readMarks(vault, ref)
    assert.equal(painted.ok, true)
    if (!painted.ok) return
    assert.equal(painted.marks.length, 1)
    assert.equal(painted.marks[0]?.color, 'green')
    assert.equal(painted.marks[0]?.note, '')

    const noted = await writeMark(vault, {
      ref, kind: 'highlight', quote: 'attention', page: 1, rects, pageSize, color: 'green', comment: 'see figure 2',
    })
    assert.equal(noted.ok, true)
    const withNote = await readMarks(vault, ref)
    assert.equal(withNote.ok, true)
    if (!withNote.ok) return
    assert.equal(withNote.marks.length, 1)
    assert.equal(withNote.marks[0]?.note, 'see figure 2')

    const removed = await deleteMark(vault, ref, withNote.marks[0]?.id ?? '')
    assert.equal(removed.ok, true)
    const empty = await readMarks(vault, ref)
    assert.equal(empty.ok, true)
    if (empty.ok) assert.equal(empty.marks.length, 0)

    const file = await readFile(path.join(vault, 'papers/group/paper/marks/annotations.json'), 'utf8')
    assert.equal(JSON.parse(file).length, 0)
  })
})

test('a nearby highlight on another line is kept', async () => {
  await withPaper(async (vault, ref) => {
    await writeMark(vault, { ref, kind: 'highlight', quote: 'first', page: 1, rects, pageSize, color: 'yellow' })
    await writeMark(vault, {
      ref,
      kind: 'highlight',
      quote: 'second',
      page: 1,
      rects: [{ x: 72, y: 180, w: 180, h: 14 }],
      pageSize,
      color: 'pink',
    })
    const marks = await readMarks(vault, ref)
    assert.equal(marks.ok, true)
    if (marks.ok) assert.equal(marks.marks.length, 2)
  })
})
