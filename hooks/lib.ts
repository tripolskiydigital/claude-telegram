import type { TgFile, TgMessage, TgPhoto } from '../types'

/** The parts of a Telegram User this mod reads. */
export type TgUser = { id: number; is_bot?: boolean; first_name?: string; last_name?: string; username?: string }

/** The parts of a Telegram Chat this mod reads. */
export type TgChat = { id: number; type: string; title?: string; first_name?: string; username?: string }

/** The parts of a Telegram Message this mod reads. */
export type TgRawMessage = {
  message_id: number
  date: number
  chat: TgChat
  from?: TgUser
  sender_chat?: TgChat
  text?: string
  caption?: string
  photo?: TgPhotoSize[]
  document?: { file_id: string; file_name?: string; mime_type?: string; file_size?: number; thumbnail?: TgPhotoSize }
  sticker?: { emoji?: string }
  voice?: unknown
  video?: unknown
  video_note?: unknown
  audio?: unknown
  new_chat_members?: TgUser[]
  left_chat_member?: TgUser
}

export type TgPhotoSize = { file_id: string; width: number; height: number; file_size?: number }

export type TgUpdate = { update_id: number; message?: TgRawMessage; edited_message?: TgRawMessage }

/** Messages kept per group, newest last. */
export const KEEP = 200

/** Telegram's limit is 4096 characters a message; this leaves room to spare. */
export const CHUNK = 4000

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

/** A six-character link code from `random`, a source of numbers in [0, 1). */
export function makeCode(random: () => number): string {
  let code = ''
  for (let i = 0; i < 6; i++) code += CODE_ALPHABET[Math.floor(random() * CODE_ALPHABET.length)]
  return code
}

/**
 * The link code a group message carries: `/start CODE` (what Telegram sends
 * when the bot is added through a `startgroup` link) or `/link CODE`, either
 * with the bot's `@username` after the command.
 */
export function linkCodeOf(text: string | undefined): string | undefined {
  const match = /^\/(?:start|link)(?:@\w+)?\s+([A-Za-z0-9]{6})\s*$/.exec(text?.trim() ?? '')
  return match?.[1]?.toUpperCase()
}

export function nameOf(user: TgUser | undefined, chat?: TgChat): string {
  if (chat?.title) return chat.title
  if (!user) return '—'
  const full = [user.first_name, user.last_name].filter(Boolean).join(' ')
  return full || (user.username ? `@${user.username}` : String(user.id))
}

const isImageDocument = (msg: TgRawMessage) => msg.document?.mime_type?.startsWith('image/') === true

/** The picture a message carries: a photo, or an image sent as a file. */
export function photoOf(msg: TgRawMessage): TgPhoto | undefined {
  const sizes = msg.photo
  if (sizes && sizes.length > 0) {
    const full = sizes[sizes.length - 1]!
    const thumb = sizes.find(size => size.width >= 300) ?? full
    return { fileId: full.file_id, thumbId: thumb.file_id, width: full.width, height: full.height }
  }
  if (msg.document && isImageDocument(msg)) {
    const thumb = msg.document.thumbnail
    return { fileId: msg.document.file_id, thumbId: thumb?.file_id, width: thumb?.width ?? 0, height: thumb?.height ?? 0 }
  }
  return undefined
}

/** The file a message carries that is no picture: a document sent as a file. */
export function fileOf(msg: TgRawMessage): TgFile | undefined {
  const doc = msg.document
  if (!doc || isImageDocument(msg)) return undefined
  return { fileId: doc.file_id, name: doc.file_name || 'file', ...(doc.file_size ? { size: doc.file_size } : {}) }
}

/** A file name safe to keep on disk and to name in an `@` mention: no folders, control characters or spaces. */
export function safeName(name: string): string {
  return name.replace(/[\/\\\u0000-\u001f\s]/g, '_').replace(/^\.+/, '_').slice(0, 120) || 'file'
}

/** What a message says: its text, its caption, or a sign for what it holds (in no language). A picture or a file alone says nothing. */
export function textOf(msg: TgRawMessage): string {
  const caption = msg.caption ? ` ${msg.caption}` : ''
  if (msg.text) return msg.text
  if (msg.photo || isImageDocument(msg)) return msg.caption ?? ''
  if (msg.document) return msg.caption ?? ''
  if (msg.sticker) return msg.sticker.emoji ?? '🏷'
  if (msg.voice) return '🎤'
  if (msg.video_note) return '⏺'
  if (msg.video) return `🎬${caption}`
  if (msg.audio) return `🎵${caption}`
  if (msg.new_chat_members) return `➕ ${msg.new_chat_members.map(u => nameOf(u)).join(', ')}`
  if (msg.left_chat_member) return `➖ ${nameOf(msg.left_chat_member)}`
  return '…'
}

export function messageOf(msg: TgRawMessage, botId: number | undefined): TgMessage {
  const photo = photoOf(msg)
  const file = fileOf(msg)
  return {
    id: msg.message_id,
    from: nameOf(msg.from, msg.sender_chat),
    text: textOf(msg),
    date: msg.date,
    isOwn: botId !== undefined && msg.from?.id === botId,
    ...(photo ? { photo } : {}),
    ...(file ? { file } : {}),
  }
}

/** `list` with `add` merged in: one entry per id (a later one wins), by id, the last `KEEP`. */
export function merge(list: readonly TgMessage[], add: readonly TgMessage[]): TgMessage[] {
  const byId = new Map<number, TgMessage>()
  for (const one of list) byId.set(one.id, one)
  for (const one of add) byId.set(one.id, one)
  return [...byId.values()].sort((a, b) => a.id - b.id).slice(-KEEP)
}

/** `text` cut into pieces Telegram takes, at a line break where one is near. */
export function chunks(text: string, size = CHUNK): string[] {
  const out: string[] = []
  let rest = text.trim()
  while (rest.length > size) {
    const cut = rest.lastIndexOf('\n', size)
    const at = cut > size / 2 ? cut : size
    out.push(rest.slice(0, at).trimEnd())
    rest = rest.slice(at).trimStart()
  }
  if (rest) out.push(rest)
  return out
}

/** `HH:MM` of a Telegram date, in the machine's time zone. */
export function timeOf(date: number): string {
  const d = new Date(date * 1000)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

/** What a message puts in the prompt: its text alone, and its picture or file as an `@` mention of the downloaded copy. */
export function promptTextOf(msg: TgMessage, attached?: string): string {
  return [msg.text, attached ? `@${attached}` : ''].filter(Boolean).join('\n')
}

/** The extension Telegram's file path ends in, `jpg` when it names none. */
export function extensionOf(filePath: string): string {
  return /\.([A-Za-z0-9]{1,5})$/.exec(filePath)?.[1]?.toLowerCase() ?? 'jpg'
}

/** An SVG that shows a picture at `width` CSS pixels, its height to scale. */
export function pictureSvg(dataUri: string, width: number, height: number): string {
  const w = 240
  const h = width > 0 && height > 0 ? Math.round((w * height) / width) : 180
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><image href="${dataUri}" width="${w}" height="${h}" preserveAspectRatio="xMidYMid meet"/></svg>`
}

/**
 * The link a folder falls under: its own, or the nearest folder above it that
 * has one, so a subfolder or a worktree inside the project shares the group.
 */
export function linkKeyFor(keys: readonly string[], folder: string): string | undefined {
  return keys
    .filter(key => folder === key || folder.startsWith(`${key}/`))
    .sort((a, b) => b.length - a.length)[0]
}

/** The project a git common dir (`/p/app/.git`) belongs to: the folder holding it. */
export function projectOfGitDir(gitDir: string): string | undefined {
  const dir = gitDir.trim().replace(/\/+$/, '')
  return dir.endsWith('/.git') ? dir.slice(0, -'/.git'.length) : undefined
}

/** The tail of a folder path: what the bot names the project by. */
export function projectName(cwd: string): string {
  return cwd.split('/').filter(Boolean).pop() ?? cwd
}

/** One message for Telegram: its HTML (`parse_mode: HTML`) and the same as plain text, sent if the HTML is refused. */
export type TgPiece = { html: string; plain: string }

/** Telegram counts a message's length after its tags are read: 4096. This leaves room. */
const PIECE = 3800

const escapeHtml = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/** Markdown's inline marks as Telegram's HTML: code, links, bold, italic, strikethrough. */
export function inlineHtml(text: string): string {
  const kept: string[] = []
  const keep = (html: string) => `\u0000${kept.push(html) - 1}\u0000`
  let out = text.replace(/`([^`\n]+)`/g, (_, code: string) => keep(`<code>${escapeHtml(code)}</code>`))
  out = out.replace(/\[([^\]\n]+)\]\((https?:\/\/[^)\s]+)\)/g, (_, label: string, href: string) =>
    keep(`<a href="${escapeHtml(href).replace(/"/g, '&quot;')}">${escapeHtml(label)}</a>`),
  )
  out = escapeHtml(out)
  out = out.replace(/\*\*(?=\S)([^*\n]*?\S)\*\*/g, '<b>$1</b>').replace(/__(?=\S)([^_\n]*?\S)__/g, '<b>$1</b>')
  out = out.replace(/(^|[^*\w])\*(?=\S)([^*\n]*?\S)\*(?![*\w])/g, '$1<i>$2</i>')
  out = out.replace(/(^|[^_\w])_(?=\S)([^_\n]*?\S)_(?![_\w])/g, '$1<i>$2</i>')
  out = out.replace(/~~(?=\S)([^~\n]*?\S)~~/g, '<s>$1</s>')
  return out.replace(/\u0000(\d+)\u0000/g, (_, i: string) => kept[Number(i)] ?? '')
}

/** Markdown's inline marks taken off, for plain text: `**a**` reads `a`, a link `label (url)`. */
export function inlinePlain(text: string): string {
  return text
    .replace(/\[([^\]\n]+)\]\((https?:\/\/[^)\s]+)\)/g, '$1 ($2)')
    .replace(/\*\*(?=\S)([^*\n]*?\S)\*\*/g, '$1')
    .replace(/__(?=\S)([^_\n]*?\S)__/g, '$1')
    .replace(/(^|[^*\w])\*(?=\S)([^*\n]*?\S)\*(?![*\w])/g, '$1$2')
    .replace(/~~(?=\S)([^~\n]*?\S)~~/g, '$1')
    .replace(/`([^`\n]+)`/g, '$1')
}

/** A Markdown table as columns padded to line up in a monospace block. */
function tableText(rows: string[]): string {
  const cells = rows
    .filter(row => !/^\s*\|?\s*:?-{2,}/.test(row))
    .map(row => row.trim().replace(/^\||\|$/g, '').split('|').map(cell => cell.trim().replace(/\*\*|`/g, '')))
  const widths: number[] = []
  for (const row of cells) row.forEach((cell, i) => (widths[i] = Math.max(widths[i] ?? 0, cell.length)))
  return cells.map(row => row.map((cell, i) => cell.padEnd(widths[i] ?? 0)).join('  ').trimEnd()).join('\n')
}

type Block = { html: string; plain: string; isCode?: boolean }

/** Markdown cut into blocks, each Telegram HTML and its plain text. */
function blocksOf(markdown: string): Block[] {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n')
  const blocks: Block[] = []
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? ''
    const fence = /^\s*```\s*([\w+-]*)/.exec(line)
    if (fence) {
      const body: string[] = []
      for (i++; i < lines.length && !/^\s*```/.test(lines[i] ?? ''); i++) body.push(lines[i] ?? '')
      const lang = fence[1] ? ` class="language-${fence[1]}"` : ''
      blocks.push({ html: `<pre><code${lang}>${escapeHtml(body.join('\n'))}</code></pre>`, plain: body.join('\n'), isCode: true })
      continue
    }
    if (/^\s*\|.*\|\s*$/.test(line)) {
      const rows = [line]
      while (i + 1 < lines.length && /^\s*\|.*\|\s*$/.test(lines[i + 1] ?? '')) rows.push(lines[++i] ?? '')
      const text = tableText(rows)
      blocks.push({ html: `<pre>${escapeHtml(text)}</pre>`, plain: text, isCode: true })
      continue
    }
    const heading = /^\s*#{1,6}\s+(.*)$/.exec(line)
    if (heading) {
      blocks.push({ html: `<b>${inlineHtml(heading[1] ?? '')}</b>`, plain: inlinePlain(heading[1] ?? '') })
      continue
    }
    if (/^\s*>/.test(line)) {
      const quoted = [line.replace(/^\s*>\s?/, '')]
      while (i + 1 < lines.length && /^\s*>/.test(lines[i + 1] ?? '')) quoted.push((lines[++i] ?? '').replace(/^\s*>\s?/, ''))
      blocks.push({ html: `<blockquote>${quoted.map(inlineHtml).join('\n')}</blockquote>`, plain: quoted.map(inlinePlain).join('\n') })
      continue
    }
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
      blocks.push({ html: '———', plain: '———' })
      continue
    }
    const bullet = /^(\s*)[-*+]\s+(.*)$/.exec(line)
    if (bullet) {
      const indent = ' '.repeat(Math.floor((bullet[1] ?? '').length / 2) * 3)
      blocks.push({ html: `${indent}• ${inlineHtml(bullet[2] ?? '')}`, plain: `${indent}• ${inlinePlain(bullet[2] ?? '')}` })
      continue
    }
    blocks.push({ html: inlineHtml(line), plain: inlinePlain(line) })
  }
  return blocks
}

/** What a reader sees of `html`: its length with the tags read and the entities as one character each. */
const shownLength = (html: string) => html.replace(/<[^>]+>/g, '').replace(/&\w+;/g, '_').length

/**
 * Claude's Markdown as Telegram messages: HTML Telegram draws (bold, italic,
 * code, links, quotes; headings bold, lists with bullets, tables lined up in a
 * monospace block), in pieces under its length limit, each with a plain twin.
 */
export function telegramPieces(markdown: string, size = PIECE): TgPiece[] {
  const pieces: TgPiece[] = []
  let html: string[] = []
  let plain: string[] = []
  let length = 0
  const flush = () => {
    const text = plain.join('\n').trim()
    if (text) pieces.push({ html: html.join('\n').trim(), plain: text })
    html = []
    plain = []
    length = 0
  }
  for (const block of blocksOf(markdown.trim())) {
    const shown = shownLength(block.html) + 1
    if (shown > size) {
      // A block longer than a message: its plain text cut to size, each cut drawn the same way.
      flush()
      for (const part of chunks(block.plain, size - 50)) {
        pieces.push({ html: block.isCode ? `<pre>${escapeHtml(part)}</pre>` : inlineHtml(part), plain: part })
      }
      continue
    }
    if (length + shown > size) flush()
    html.push(block.html)
    plain.push(block.plain)
    length += shown
  }
  flush()
  return pieces
}
