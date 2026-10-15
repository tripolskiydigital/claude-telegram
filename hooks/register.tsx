import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Lang, TgLink, TgMessage, TgPending } from '../types'
import { langOf, sizeOf, t } from './i18n'
import {
  chunks,
  extensionOf,
  linkCodeOf,
  linkKeyFor,
  makeCode,
  merge,
  messageOf,
  pictureSvg,
  projectName,
  projectOfGitDir,
  promptTextOf,
  safeName,
  telegramPieces,
  timeOf,
} from './lib'
import type { TgChat, TgPiece, TgUpdate } from './lib'

type Engine = EngineInterface

const PANE = 'tg-bridge'
const TITLE = 'Telegram'
/** How often a session asks the bot for news, and how long a poller's lease holds. */
const POLL_MS = 3000
const LEASE_MS = 12000
/** Link codes older than this are dropped. */
const CODE_TTL_MS = 30 * 60 * 1000
/** Messages the pane draws, newest first. */
const SHOWN = 60
/** Pictures of the newest messages the pane shows a preview of. */
const PREVIEWS = 20
/** A preview larger than this (base64 characters) is left out: an Svg holds 131072 at most. */
const PREVIEW_MAX = 120_000

const messages = atom({ plugin: 'tg-bridge', key: 'messages' } as const, [])
const link = atom({ plugin: 'tg-bridge', key: 'link' } as const, null)
const pending = atom({ plugin: 'tg-bridge', key: 'pending' } as const, null)
const lastAnswer = atom({ plugin: 'tg-bridge', key: 'lastAnswer' } as const, '')
const status = atom({ plugin: 'tg-bridge', key: 'status' } as const, '')
const composeRev = atom({ plugin: 'tg-bridge', key: 'composeRev' } as const, 0)
const bot = atom({ plugin: 'tg-bridge', key: 'bot' } as const, '')
const editingToken = atom({ plugin: 'tg-bridge', key: 'editingToken' } as const, false)
const thumbs = atom({ plugin: 'tg-bridge', key: 'thumbs' } as const, {})
const lang = atom({ plugin: 'tg-bridge', key: 'lang' } as const, 'en')

/** What every session of this machine shares through `$.store`. */
type Links = Record<string, TgLink>
type PendingCodes = Record<string, { cwd: string; at: number }>
type Lease = { owner: string; until: number }
type BotInfo = { id: number; username: string }
type ApiAnswer<T> = { ok: boolean; result?: T; description?: string; error_code?: number }

/** The module's own run: the bot token, this session's folder and its poller tag. */
/**
 * The module's own run: the bot token, this session's project folder (the main
 * checkout's for a worktree), whether its pane opens by itself, and its poller tag.
 */
type Ctx = {
  token: string
  botId: string
  project: string
  home: string
  owner: string
  busy: boolean
  isPolling: boolean
  autoOpen: boolean
  didAutoOpen: boolean
  /** The interface language, as Claude Desktop's own. */
  lang: Lang
}

/** Store keys are per bot: another token starts its own links, offset and messages. */
const keyOf = (ctx: Ctx, name: string) => `${ctx.botId}:${name}`
const msgsKey = (ctx: Ctx, chatId: number) => keyOf(ctx, `msgs:${chatId}`)

/** The token every session of this machine uses, kept apart from any bot's data. */
const TOKEN_KEY = 'token'
const TOKEN_SHAPE = /^\d+:[\w-]{20,}$/

function useToken(ctx: Ctx, token: string): void {
  ctx.token = token
  ctx.botId = token.split(':')[0] ?? ''
}

async function api<T>($: Engine, ctx: Ctx, method: string, body: Record<string, unknown>): Promise<ApiAnswer<T>> {
  try {
    const res = await $.http.fetch(`https://api.telegram.org/bot${ctx.token}/${method}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
    return JSON.parse(res.text) as ApiAnswer<T>
  } catch (error) {
    return { ok: false, description: error instanceof Error ? error.message : String(error) }
  }
}

async function setStatus($: Engine, text: string): Promise<void> {
  if ((await read($, status)) !== text) await update($, status, () => text)
}

async function botInfo($: Engine, ctx: Ctx): Promise<BotInfo | undefined> {
  const kept = (await $.store.get(keyOf(ctx, 'bot'))) as BotInfo | undefined
  if (kept?.username) {
    if ((await read($, bot)) !== kept.username) await update($, bot, () => kept.username)
    return kept
  }
  const me = await api<BotInfo>($, ctx, 'getMe', {})
  if (!me.ok || !me.result) {
    await setStatus($, t(ctx.lang, 'botSilent', { error: me.description ?? t(ctx.lang, 'noAnswer') }))
    return undefined
  }
  const info = { id: me.result.id, username: me.result.username }
  await $.store.set(keyOf(ctx, 'bot'), info)
  if ((await read($, bot)) !== info.username) await update($, bot, () => info.username)
  return info
}

async function linksOf($: Engine, ctx: Ctx): Promise<Links> {
  return ((await $.store.get(keyOf(ctx, 'links'))) as Links | undefined) ?? {}
}

async function storedMessages($: Engine, ctx: Ctx, chatId: number): Promise<TgMessage[]> {
  return ((await $.store.get(msgsKey(ctx, chatId))) as TgMessage[] | undefined) ?? []
}

async function keepMessages($: Engine, ctx: Ctx, chatId: number, add: TgMessage[]): Promise<void> {
  await $.store.set(msgsKey(ctx, chatId), merge(await storedMessages($, ctx, chatId), add))
}

/** A group answered a link code: tie it to the folder that asked for the code. */
async function bindCode($: Engine, ctx: Ctx, code: string, chat: TgChat): Promise<void> {
  const codes = ((await $.store.get(keyOf(ctx, 'pending'))) as PendingCodes | undefined) ?? {}
  const asked = codes[code]
  if (!asked) {
    await api($, ctx, 'sendMessage', { chat_id: chat.id, text: t(ctx.lang, 'codeUnknown', { code }) })
    return
  }
  delete codes[code]
  await $.store.set(keyOf(ctx, 'pending'), codes)
  const links = await linksOf($, ctx)
  links[asked.cwd] = { chatId: chat.id, title: chat.title ?? String(chat.id) }
  await $.store.set(keyOf(ctx, 'links'), links)
  await api($, ctx, 'sendMessage', { chat_id: chat.id, text: t(ctx.lang, 'linkedGroupSays', { project: projectName(asked.cwd) }) })
}

/** One getUpdates round: link codes bound, every group's messages kept. */
async function poll($: Engine, ctx: Ctx): Promise<void> {
  const offset = Number((await $.store.get(keyOf(ctx, 'offset'))) ?? 0)
  const res = await api<TgUpdate[]>($, ctx, 'getUpdates', {
    offset,
    timeout: 0,
    allowed_updates: ['message', 'edited_message'],
  })
  if (!res.ok) {
    await setStatus(
      $,
      res.error_code === 409
        ? t(ctx.lang, 'webhook')
        : `Telegram: ${res.description ?? t(ctx.lang, 'error')}`,
    )
    return
  }
  const updates = res.result ?? []
  if (updates.length === 0) return
  const bot = await botInfo($, ctx)
  const byChat = new Map<number, TgMessage[]>()
  for (const one of updates) {
    const msg = one.message ?? one.edited_message
    if (!msg || msg.chat.type === 'private' || msg.chat.type === 'channel') continue
    const code = linkCodeOf(msg.text)
    if (code) {
      await bindCode($, ctx, code, msg.chat)
      continue
    }
    byChat.set(msg.chat.id, [...(byChat.get(msg.chat.id) ?? []), messageOf(msg, bot?.id)])
  }
  for (const [chatId, add] of byChat) await keepMessages($, ctx, chatId, add)
  const last = updates[updates.length - 1]
  if (last) await $.store.set(keyOf(ctx, 'offset'), last.update_id + 1)
}

/** This session's view of the store: its folder's link and that group's messages. */
async function refresh($: Engine, ctx: Ctx): Promise<void> {
  const links = await linksOf($, ctx)
  const key = linkKeyFor(Object.keys(links), ctx.project)
  const mine = key ? (links[key] ?? null) : null
  // A linked project's pane opens by itself, once a session, in each of its sessions.
  if (mine && ctx.autoOpen && !ctx.didAutoOpen) {
    ctx.didAutoOpen = true
    void openPane($)
  }
  const shown = await read($, link)
  if (JSON.stringify(mine) !== JSON.stringify(shown)) {
    await update($, link, () => mine)
    if (mine && (await read($, pending))) {
      await update($, pending, () => null)
      $.ui.toast(t(ctx.lang, 'linkedToast', { title: mine.title }))
    }
  }
  const list = mine ? await storedMessages($, ctx, mine.chatId) : []
  if (JSON.stringify(list) !== JSON.stringify(await read($, messages))) await update($, messages, () => list)
}

/**
 * One tick of the timer: the session holding the lease (or finding it lapsed)
 * polls the bot for every session of this machine; each then reads its own.
 */
async function tick($: Engine, ctx: Ctx): Promise<void> {
  if (ctx.busy) return
  ctx.busy = true
  try {
    const shared = await $.store.get(TOKEN_KEY)
    if (typeof shared === 'string' && shared !== ctx.token) useToken(ctx, shared)
    // The pane names the bot: known once its token answered, in this session or another.
    await botInfo($, ctx)
    const now = await $.clock.now()
    const lease = (await $.store.get(keyOf(ctx, 'lease'))) as Lease | undefined
    if (!lease || lease.until < now || lease.owner === ctx.owner) {
      await $.store.set(keyOf(ctx, 'lease'), { owner: ctx.owner, until: now + LEASE_MS })
      await poll($, ctx)
    }
    await refresh($, ctx)
    await loadPreviews($, ctx)
  } finally {
    ctx.busy = false
  }
}

const previewKey = (chatId: number, msg: TgMessage) => `${chatId}:${msg.id}`

/** Where this bot's pictures of a group are kept: under ~/.claude, never in the project. */
function folderOf(ctx: Ctx, chatId: number): string {
  return `${ctx.home}/.claude/tg-bridge/files/${ctx.botId}/${chatId}`
}

/**
 * Downloads a Telegram file to `${base}-<name>`, or `${base}.<ext>` with no name,
 * unless it is there already; its path, or undefined. Bots may download files up to 20 MB.
 */
async function download($: Engine, ctx: Ctx, fileId: string, base: string, name?: string): Promise<string | undefined> {
  const file = await api<{ file_path?: string }>($, ctx, 'getFile', { file_id: fileId })
  const remote = file.result?.file_path
  if (!file.ok || !remote) return undefined
  const path = name ? `${base}-${safeName(name)}` : `${base}.${extensionOf(remote)}`
  if (await $.fs.exists(path)) return path
  const { exitCode } = await $.process.run([
    'curl', '-sSfL', '--create-dirs', '-o', path, `https://api.telegram.org/file/bot${ctx.token}/${remote}`,
  ])
  return exitCode === 0 ? path : undefined
}

/** Fetches the previews the pane lacks for the newest pictures of the linked group. */
async function loadPreviews($: Engine, ctx: Ctx): Promise<void> {
  const to = await read($, link)
  if (!to || !ctx.home) return
  const have = await read($, thumbs)
  const missing = (await read($, messages))
    .filter(msg => msg.photo?.thumbId)
    .slice(-PREVIEWS)
    .filter(msg => have[previewKey(to.chatId, msg)] === undefined)
  if (missing.length === 0) return
  const add: Record<string, string> = {}
  for (const msg of missing) {
    const path = await download($, ctx, msg.photo!.thumbId!, `${folderOf(ctx, to.chatId)}/${msg.id}-preview`)
    // An empty entry marks a preview that could not be made, so it is not asked for again.
    let uri = ''
    if (path) {
      const { base64 } = await $.fs.read(path, { as: 'bytes' })
      const mime = path.endsWith('.png') ? 'image/png' : path.endsWith('.webp') ? 'image/webp' : 'image/jpeg'
      if (base64.length <= PREVIEW_MAX) uri = `data:${mime};base64,${base64}`
    }
    add[previewKey(to.chatId, msg)] = uri
  }
  await update($, thumbs, was => ({ ...was, ...add }))
}

function startPolling($: Engine, ctx: Ctx): void {
  if (ctx.isPolling) return
  ctx.isPolling = true
  $.clock.every(POLL_MS, () => void tick($, ctx))
  void tick($, ctx)
}

/** A token typed into the pane: asked of Telegram first, then kept for every session. */
async function saveToken($: Engine, ctx: Ctx, typed: string): Promise<void> {
  const token = typed.trim()
  if (!TOKEN_SHAPE.test(token)) {
    $.ui.toast(t(ctx.lang, 'notToken'))
    return
  }
  const trial: Ctx = { ...ctx }
  useToken(trial, token)
  const info = await botInfo($, trial)
  if (!info) {
    $.ui.toast(t(ctx.lang, 'tokenRefused', { error: await read($, status) }))
    return
  }
  await $.store.set(TOKEN_KEY, token)
  useToken(ctx, token)
  await setStatus($, '')
  await update($, editingToken, () => false)
  await update($, pending, () => null)
  startPolling($, ctx)
  await refresh($, ctx)
  $.ui.toast(t(ctx.lang, 'botConnected', { bot: info.username }))
}

async function startLink($: Engine, ctx: Ctx): Promise<TgPending | string> {
  if (!ctx.token) return t(ctx.lang, 'noToken')
  const bot = await botInfo($, ctx)
  if (!bot) return await read($, status)
  const now = await $.clock.now()
  const codes = ((await $.store.get(keyOf(ctx, 'pending'))) as PendingCodes | undefined) ?? {}
  for (const [code, one] of Object.entries(codes)) if (now - one.at > CODE_TTL_MS) delete codes[code]
  const code = makeCode(Math.random)
  codes[code] = { cwd: ctx.project, at: now }
  await $.store.set(keyOf(ctx, 'pending'), codes)
  const asked: TgPending = {
    code,
    url: `https://t.me/${bot.username}?startgroup=${code}`,
    command: `/link@${bot.username} ${code}`,
  }
  await update($, pending, () => asked)
  return asked
}

async function unlink($: Engine, ctx: Ctx): Promise<string> {
  const links = await linksOf($, ctx)
  const key = linkKeyFor(Object.keys(links), ctx.project)
  const was = key ? links[key] : undefined
  if (!key || !was) return t(ctx.lang, 'notLinked')
  delete links[key]
  await $.store.set(keyOf(ctx, 'links'), links)
  await refresh($, ctx)
  return t(ctx.lang, 'unlinked', { title: was.title })
}

type Sent = { message_id: number; date: number }

/** One piece to the group: as HTML where it has some, as plain text where Telegram refuses that HTML. */
async function sendPiece($: Engine, ctx: Ctx, chatId: number, piece: TgPiece | { plain: string }): Promise<ApiAnswer<Sent>> {
  if ('html' in piece) {
    const res = await api<Sent>($, ctx, 'sendMessage', { chat_id: chatId, text: piece.html, parse_mode: 'HTML' })
    if (res.ok || res.error_code !== 400) return res
  }
  return api<Sent>($, ctx, 'sendMessage', { chat_id: chatId, text: piece.plain })
}

/**
 * Sends `text` to the linked group in pieces Telegram takes, `isMarkdown` text
 * (Claude's replies) formatted, the rest as typed; the error, if any.
 */
async function send($: Engine, ctx: Ctx, text: string, isMarkdown = false): Promise<string | undefined> {
  const to = await read($, link)
  if (!to) return t(ctx.lang, 'notLinkedSend')
  if (!text.trim()) return t(ctx.lang, 'nothingToSend')
  const bot = await botInfo($, ctx)
  const sent: TgMessage[] = []
  const pieces = isMarkdown ? telegramPieces(text) : chunks(text).map(plain => ({ plain }))
  for (const piece of pieces) {
    const res = await sendPiece($, ctx, to.chatId, piece)
    if (!res.ok || !res.result) return t(ctx.lang, 'notSent', { error: res.description ?? t(ctx.lang, 'error') })
    sent.push({
      id: res.result.message_id,
      from: bot?.username ? `@${bot.username}` : t(ctx.lang, 'bot'),
      text: piece.plain,
      date: res.result.date,
      isOwn: true,
    })
  }
  await keepMessages($, ctx, to.chatId, sent)
  await refresh($, ctx)
  return undefined
}

async function sendDraft($: Engine, ctx: Ctx, text: string): Promise<void> {
  const error = await send($, ctx, text)
  if (error) {
    $.ui.toast(error)
    return
  }
  await update($, composeRev, n => n + 1)
}

/** Claude's last reply: the last turn's answer, else the session's last assistant text (a resumed session). */
async function latestAnswer($: Engine): Promise<string> {
  const kept = await read($, lastAnswer)
  if (kept.trim()) return kept
  const rows = await $.session.messages()
  for (let i = rows.length - 1; i >= 0; i--) {
    const row = rows[i]
    if (row?.role === 'assistant' && row.text.trim()) return row.text
  }
  return ''
}

async function sendAnswer($: Engine, ctx: Ctx): Promise<void> {
  const answer = await latestAnswer($)
  if (!answer) {
    $.ui.toast(t(ctx.lang, 'noReplyYet'))
    return
  }
  const error = await send($, ctx, answer, true)
  $.ui.toast(error ?? t(ctx.lang, 'replySent'))
}

/** Puts a message in the prompt: its text, and its picture downloaded as an `@` mention Claude opens. */
async function quote($: Engine, ctx: Ctx, msg: TgMessage): Promise<void> {
  const to = await read($, link)
  let attached: string | undefined
  const fileId = msg.photo?.fileId ?? msg.file?.fileId
  if (fileId && to && ctx.home) {
    attached = await download($, ctx, fileId, `${folderOf(ctx, to.chatId)}/${msg.id}`, msg.file?.name)
    if (!attached) $.ui.toast(t(ctx.lang, 'downloadFailed'))
  }
  const text = promptTextOf(msg, attached)
  if (text) await $.prompt.fill({ text, mode: 'insert' })
}

/** The desktop's settings file: its `locale` is the interface language. */
async function loadLang($: Engine): Promise<Lang> {
  let found: Lang = 'en'
  try {
    const path = `${(await $.env.get('HOME')) ?? ''}/Library/Application Support/Claude/config.json`
    // The file holds other things (encrypted tokens among them): grep hands back
    // the one `"locale": "…"` pair and nothing else reaches the mod.
    const grep = await $.process.run(['grep', '-o', '-m', '1', '"locale"[[:space:]]*:[[:space:]]*"[^"]*"', path])
    const locale = /"locale"\s*:\s*"([^"]*)"/.exec(grep.stdout)?.[1]
    if (locale !== undefined) found = langOf(locale)
  } catch {
    // No desktop app: English.
  }
  if (found !== (await read($, lang))) await update($, lang, () => found)
  return found
}

/** The folder a session's link is kept under: the main checkout for a git worktree, else the folder itself. */
async function projectOf($: Engine, cwd: string): Promise<string> {
  try {
    const { exitCode, stdout } = await $.process.run(['git', '-C', cwd, 'rev-parse', '--path-format=absolute', '--git-common-dir'])
    return (exitCode === 0 && projectOfGitDir(stdout)) || cwd
  } catch {
    return cwd
  }
}

async function openPane($: Engine): Promise<void> {
  await $.ui.open({ id: PANE, title: TITLE })
}

export const register: Register = (on, options) => {
  const ctx: Ctx = {
    token: '',
    botId: '',
    project: '',
    home: '',
    owner: makeCode(Math.random),
    busy: false,
    isPolling: false,
    autoOpen: options.autoOpen !== false,
    didAutoOpen: false,
    lang: 'en',
  }
  const configured = typeof options.botToken === 'string' ? options.botToken.trim() : ''

  on('session.start', async ($, e, next) => {
    ctx.project = await projectOf($, e.cwd)
    ctx.home = (await $.env.get('HOME')) ?? ''
    ctx.lang = await loadLang($)
    const l = ctx.lang
    await $.command.register({ name: 'tg', description: t(l, 'cmdPane') })
    await $.command.register({ name: 'tg-link', description: t(l, 'cmdLink') })
    await $.command.register({ name: 'tg-unlink', description: t(l, 'cmdUnlink') })
    await $.command.register({
      name: 'tg-send',
      description: t(l, 'cmdSend'),
      argumentHint: t(l, 'cmdSendHint'),
    })
    const kept = await $.store.get(TOKEN_KEY)
    const token = typeof kept === 'string' && kept ? kept : configured
    if (token) {
      useToken(ctx, token)
      startPolling($, ctx)
    }
    return next(e)
  })

  on('command.run', { command: 'tg' }, async $ => {
    await openPane($)
    return { text: t(ctx.lang, 'paneOpened') }
  })

  on('command.run', { command: 'tg-link' }, async $ => {
    const asked = await startLink($, ctx)
    if (typeof asked === 'string') return { text: asked }
    await openPane($)
    return {
      text: [
        t(ctx.lang, 'linkCode', { code: asked.code }),
        t(ctx.lang, 'linkByUrl', { url: asked.url }),
        t(ctx.lang, 'linkByCommand', { command: asked.command }),
      ].join('\n'),
    }
  })

  on('command.run', { command: 'tg-unlink' }, async $ => ({ text: await unlink($, ctx) }))

  on('command.run', { command: 'tg-send' }, async ($, e) => {
    // Typed text goes as typed; with none, Claude's last reply goes formatted.
    const typed = e.args.trim()
    const error = await send($, ctx, typed || (await latestAnswer($)), !typed)
    return { text: error ?? t(ctx.lang, 'sent') }
  })

  on('turn.complete', async ($, e, next) => {
    if (!e.agentId && e.answer.trim()) await update($, lastAnswer, () => e.answer)
    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const els = $.ui.resolve(e)
    const { Box, Text, Button, Link } = els
    // Every surface but the phone has a text field; the terminal draws no Svg.
    const Input = 'Input' in els ? els.Input : undefined
    const Svg = e.surface !== 'terminal' && 'Svg' in els ? els.Svg : undefined
    const previews = await read($, thumbs)
    const to = await read($, link)
    const asked = await read($, pending)
    const list = await read($, messages)
    const note = await read($, status)
    const rev = await read($, composeRev)
    const botName = await read($, bot)
    const isEditing = await read($, editingToken)
    const l = await read($, lang)

    if (botName === '' || isEditing) {
      return (
        <Box flexDirection="column" gap={1}>
          <Text bold>{t(l, isEditing ? 'otherBot' : 'connectBot')}</Text>
          <Text>{t(l, 'tokenHelp')}</Text>
          {Input ? (
            <Input key="token" placeholder="123456789:AA…" submitLabel={t(l, 'tokenSubmit')} onSubmit={text => void saveToken($, ctx, text)} />
          ) : (
            <Text dimColor>{t(l, 'tokenElsewhere')}</Text>
          )}
          <Text dimColor>{t(l, 'privacyHelp')}</Text>
          {isEditing && (
            <Button key="token-cancel" label={t(l, 'cancel')} onPress={() => void update($, editingToken, () => false)} />
          )}
          {note !== '' && <Text dimColor>{note}</Text>}
        </Box>
      )
    }

    const changeBot = (
      <Button
        key="change-bot"
        label={t(l, 'changeBot', { bot: botName })}
        plain
        dimColor
        onPress={() => void update($, editingToken, () => true)}
      />
    )

    if (!to) {
      return (
        <Box flexDirection="column" gap={1}>
          <Text bold>{t(l, 'groupNotLinked', { project: projectName(ctx.project) })}</Text>
          {asked ? (
            <Box flexDirection="column">
              <Text>{t(l, 'addByLink')}</Text>
              <Link href={asked.url} label={asked.url} />
              <Text dimColor>{t(l, 'orSendThere')}</Text>
              <Text bold>{asked.command}</Text>
            </Box>
          ) : (
            <Button key="link" variant="primary" label={t(l, 'linkGroup')} onPress={() => void startLink($, ctx)} />
          )}
          {note !== '' && <Text dimColor>{note}</Text>}
          {changeBot}
        </Box>
      )
    }

    return (
      <Box flexDirection="column" gap={1}>
        <Box flexDirection="row" justifyContent="space-between">
          <Text bold>{to.title}</Text>
          {changeBot}
        </Box>
        {note !== '' && <Text dimColor>{note}</Text>}
        {Input && (
          <Input
            key={`compose-${rev}`}
            placeholder={t(l, 'messagePlaceholder')}
            submitLabel={t(l, 'send')}
            onSubmit={text => void sendDraft($, ctx, text)}
          />
        )}
        <Button key="send-answer" label={t(l, 'sendReply')} onPress={() => void sendAnswer($, ctx)} />
        {list.length === 0 && <Text dimColor>{t(l, 'noMessages')}</Text>}
        {list
          .slice(-SHOWN)
          .reverse()
          .map(msg => (
            <Box key={`m${msg.id}`} flexDirection="column">
              <Box flexDirection="row" justifyContent="space-between">
                <Text bold color={msg.isOwn ? 'cyan' : undefined}>
                  {msg.from} <Text dimColor>{timeOf(msg.date)}</Text>
                </Text>
                <Button key={`q${msg.id}`} label={t(l, 'toPrompt')} plain dimColor onPress={() => void quote($, ctx, msg)} />
              </Box>
              {msg.photo &&
                (Svg && previews[previewKey(to.chatId, msg)] ? (
                  <Svg
                    source={pictureSvg(previews[previewKey(to.chatId, msg)]!, msg.photo.width, msg.photo.height)}
                    alt={msg.text || t(l, 'picture')}
                  />
                ) : (
                  <Text dimColor>[{t(l, 'picture')}]</Text>
                ))}
              {msg.file && (
                <Text>
                  📎 {msg.file.name}
                  {msg.file.size !== undefined && <Text dimColor> {sizeOf(msg.file.size, l)}</Text>}
                </Text>
              )}
              {msg.text !== '' && <Text wrap="wrap">{msg.text}</Text>}
            </Box>
          ))}
      </Box>
    )
  })
}
