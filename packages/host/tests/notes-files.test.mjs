import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { readVaultFile, writeVaultNote } from '../src/notes-files.ts'

test('writes and reads NOTES.md nested under papers/', async () => {
  const vault = await mkdtemp(path.join(tmpdir(), 'agentero-notes-'))
  try {
    await mkdir(path.join(vault, 'papers', '3d-vision', 'paper'), { recursive: true })
    const relative = 'papers/3d-vision/paper/NOTES.md'
    const written = await writeVaultNote(vault, relative, '# Notes\n')
    assert.equal(written.status, 200)
    assert.equal(written.path, relative)
    const read = await readVaultFile(vault, relative)
    assert.equal(read.status, 200)
    if (read.status === 200) assert.equal(read.text, '# Notes\n')

    await mkdir(path.join(vault, 'papers', 'only'), { recursive: true })
    const shallow = await writeVaultNote(vault, 'papers/only/NOTES.md', 'flat\n')
    assert.equal(shallow.status, 200)
    const missing = await writeVaultNote(vault, 'papers/missing/NOTES.md', 'no dir')
    assert.equal(missing.status, 404)

    for (const refused of ['papers/NOTES.md', 'papers/../NOTES.md', 'papers/group/../../NOTES.md', 'notes/../papers/a/NOTES.md']) {
      const result = await writeVaultNote(vault, refused, 'no')
      assert.equal(result.status, 400, refused)
    }
  } finally {
    await rm(vault, { recursive: true, force: true })
  }
})
