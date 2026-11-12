import assert from 'node:assert/strict'
import { test } from 'node:test'
import { joinNoteFrontmatter, splitNoteFrontmatter } from '../src/client/frontmatter.ts'

const note = `---
aliases:
  - "A Survey on Rubric-Guided Reinforcement Learning for Language Models"
  - "SRGRLLM"
---
# A Survey on Rubric-Guided Reinforcement Learning for Language Models

> abstract
`

test('aliases are separate titles and stay out of the markdown body', () => {
  const split = splitNoteFrontmatter(note)
  assert.deepEqual(split.aliases, [
    'A Survey on Rubric-Guided Reinforcement Learning for Language Models',
    'SRGRLLM',
  ])
  assert.equal(split.body.startsWith('# A Survey'), true)
  assert.equal(split.body.includes('aliases:'), false)
  assert.equal(split.raw.includes('SRGRLLM'), true)
})

test('saving an edited body keeps the original alias header', () => {
  const split = splitNoteFrontmatter(note)
  const saved = joinNoteFrontmatter(split.raw, '# A Survey\n\nrevised\n')
  assert.equal(saved.startsWith(split.raw), true)
  assert.equal(saved.endsWith('revised\n'), true)
  assert.deepEqual(splitNoteFrontmatter(saved).aliases, split.aliases)
})

test('a note without a header is left unchanged', () => {
  const plain = '# Title\n\nbody\n'
  const split = splitNoteFrontmatter(plain)
  assert.deepEqual(split, { raw: '', aliases: [], body: plain })
  assert.equal(joinNoteFrontmatter(split.raw, plain), plain)
})
