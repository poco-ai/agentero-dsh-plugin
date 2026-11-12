/** A paper note's YAML header, kept separate from the markdown body. */
export interface NoteFrontmatter {
  /** Original fenced block, including the newline after the closing fence. */
  raw: string
  aliases: string[]
  body: string
}

/** Split a `---` YAML header so the editor never treats aliases as markdown. */
export function splitNoteFrontmatter(markdown: string): NoteFrontmatter {
  const source = markdown.replace(/^\uFEFF/, '')
  const newline = source.includes('\r\n') ? '\r\n' : '\n'
  const lines = source.split(/\r?\n/)
  if (lines[0]?.trim() !== '---') return { raw: '', aliases: [], body: markdown }
  let end = -1
  for (let index = 1; index < lines.length; index += 1) {
    if (lines[index]?.trim() === '---') {
      end = index
      break
    }
  }
  if (end === -1) return { raw: '', aliases: [], body: markdown }
  return {
    raw: `${lines.slice(0, end + 1).join(newline)}${newline}`,
    aliases: aliasesOf(lines.slice(1, end)),
    body: lines.slice(end + 1).join(newline),
  }
}

/** Put the original header back in front of an edited body. */
export function joinNoteFrontmatter(raw: string, body: string): string {
  if (raw === '') return body
  const fence = raw.endsWith('\n') ? raw : `${raw}\n`
  return `${fence}${body.replace(/^\n+/, '')}`
}

function aliasesOf(lines: readonly string[]): string[] {
  const aliases: string[] = []
  let reading = false
  for (const line of lines) {
    if (!/^\s/.test(line)) {
      const key = /^aliases\s*:(.*)$/.exec(line)
      reading = key !== null
      if (key === null) continue
      const rest = key[1]?.trim() ?? ''
      if (rest.startsWith('[')) aliases.push(...flowList(rest))
      else if (rest !== '' && rest !== '~' && rest !== 'null') aliases.push(unquote(rest))
      continue
    }
    if (!reading) continue
    const item = /^\s*-\s+(.*)$/.exec(line)
    if (item !== null) aliases.push(unquote(item[1] ?? ''))
  }
  return aliases.filter(alias => alias !== '')
}

function flowList(value: string): string[] {
  const inner = value.trim().replace(/^\[/, '').replace(/\]$/, '')
  return inner.split(',').map(part => unquote(part)).filter(alias => alias !== '')
}

function unquote(value: string): string {
  const text = value.trim()
  if (text.length >= 2 && text.startsWith('"') && text.endsWith('"')) {
    return text.slice(1, -1).replace(/\\n/g, '\n').replace(/\\"/g, '"').replace(/\\\\/g, '\\')
  }
  if (text.length >= 2 && text.startsWith("'") && text.endsWith("'")) {
    return text.slice(1, -1).replace(/''/g, "'")
  }
  return text
}
